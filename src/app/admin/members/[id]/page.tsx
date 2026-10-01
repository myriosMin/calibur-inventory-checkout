"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import useSWR from "swr";

import Card from "@/components/admin/Card";
import Drawer from "@/components/admin/Drawer";
import { CAPTION, FIELD, HELP, LABEL } from "@/components/admin/form";
import PageHeader from "@/components/admin/PageHeader";
import Skeleton from "@/components/admin/Skeleton";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { KEYS, upsertCached, useHolders, useHoldings, useMembers, useProducts } from "@/lib/admin/queries";
import { MEMBER_ROLES, type MemberRole } from "@/lib/csv/member-roster";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";
import { normalizeTelegramHandle } from "@/lib/utils/normalize";

import {
  buildOffboardPatch,
  buildUnbindPatch,
  todayIsoDate,
} from "../memberLifecycle";

type Member = Database["public"]["Tables"]["members"]["Row"];
type Role = MemberRole;

// All three roles. This list used to be ["member", "admin"], which made a
// procurement member impossible to save from this page.
const ROLES: readonly Role[] = MEMBER_ROLES;

type LifecycleAction = "unbind" | "offboard";

type FormState = {
  full_name: string;
  display_name: string;
  nus_email: string;
  telegram_username: string;
  role: Role;
  joined_at: string;
  left_at: string;
  active: boolean;
};

function memberToForm(member: Member): FormState {
  return {
    full_name: member.full_name,
    display_name: member.display_name ?? "",
    nus_email: member.nus_email ?? "",
    telegram_username: member.telegram_username ?? "",
    role: (member.role as Role) ?? "member",
    joined_at: member.joined_at ?? "",
    left_at: member.left_at ?? "",
    active: member.active,
  };
}

/**
 * Admin member edit page. Same shape as the create form on
 * src/app/admin/members/page.tsx, pre-populated and wired to `.update()`
 * instead of `.insert()` (mirrors src/app/admin/products/[id]/page.tsx).
 * `telegram_user_id` / `telegram_bound_at` are shown read-only -- they're
 * set only by the /admin/bind-queue flow, never edited here.
 */
export default function AdminMemberEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = getBrowserClient();
  const membersQ = useMembers();
  const cached = membersQ.data?.find((m) => m.id === id);
  const directQ = useSWR(cached ? null : ["admin/member", id], async () => {
    const { data, error } = await supabase.from("members").select("*").eq("id", id).single();
    if (error) throw new Error(error.message);
    return data;
  });
  const member: Member | undefined = cached ?? directQ.data;

  // What they hold right now, from the shared holdings cache.
  const holdingsQ = useHoldings();
  const holdersQ = useHolders();
  const productsQ = useProducts();
  const holding = useMemo(() => {
    const holder = holdersQ.data?.find((h) => h.member_id === id);
    if (!holder) return [];
    const names = new Map((productsQ.data ?? []).map((p) => [p.id, p]));
    return (holdingsQ.data ?? [])
      .filter((h) => h.holder_id === holder.id && Number(h.qty) !== 0 && h.product_id)
      .map((h) => ({ productId: h.product_id!, name: names.get(h.product_id!)?.name ?? "Unknown product", unit: names.get(h.product_id!)?.unit ?? "", qty: Number(h.qty) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [holdersQ.data, holdingsQ.data, productsQ.data, id]);

  /** Non-null while the edit drawer is open. */
  const [form, setForm] = useState<FormState | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  // Both lifecycle actions are destructive and not obviously reversible to
  // whoever is clicking, so neither fires on the first click: the button
  // swaps for an explicit "yes, do it" / "cancel" pair naming the exact
  // consequence. (An inline confirm rather than window.confirm -- nothing
  // else in this dashboard uses a browser dialog, and they can be
  // suppressed by the browser.)
  const [pendingAction, setPendingAction] = useState<LifecycleAction | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);

  async function store(updated: Member) {
    await upsertCached(KEYS.members, updated);
    if (!cached) await directQ.mutate(updated, { revalidate: false });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaveError(null);
    setSavedMessage(null);

    const fullName = form.full_name.trim();
    if (!fullName) {
      setSaveError("Full name is required.");
      return;
    }
    // Mirror the DB's `members_role_check` CHECK client-side.
    if (!ROLES.includes(form.role)) {
      setSaveError(`Role must be one of: ${ROLES.join(", ")}.`);
      return;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("members")
        .update({
          full_name: fullName,
          display_name: form.display_name.trim() || null,
          nus_email: form.nus_email.trim() || null,
          // Normalised the same way the bulk importer and the bind-queue
          // lookup do, so a handle re-typed here as "@Alex" still matches
          // the "alex" the bot reports on /start.
          telegram_username:
            normalizeTelegramHandle(form.telegram_username) || null,
          role: form.role,
          joined_at: form.joined_at || null,
          left_at: form.left_at || null,
          active: form.active,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      await store(data);
      setForm(null);
      setSavedMessage("Saved.");
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save member.",
      );
    } finally {
      setSaving(false);
    }
  }

  /**
   * The PDPA actions. `docs/tele-qr/pdpa.md` commits to: "On leaving the
   * club, or on request: clear `telegram_user_id`, set `active = false`,
   * unlink the Telegram binding." Its retention table is equally explicit
   * that the member row and the borrowing history STAY -- so this writes an
   * update, never a delete. No `stock_movements` row is touched.
   *
   * pdpa.md design rule 5 ("Deactivation is immediate and effective")
   * is satisfied by requireMember() (src/lib/server/member-auth.ts), which
   * re-reads the members row on every single /api/store/* request and
   * returns 403 `inactive` for `active = false` -- there is no cached
   * session or token to expire, so the lockout lands on the member's very
   * next request, not the next deploy.
   */
  async function runLifecycleAction(action: LifecycleAction) {
    if (!member) return;
    setSaveError(null);
    setSavedMessage(null);
    setLifecycleBusy(true);
    try {
      const patch =
        action === "unbind"
          ? buildUnbindPatch()
          : buildOffboardPatch(todayIsoDate(), member.left_at);

      const { data, error } = await supabase
        .from("members")
        .update(patch)
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      await store(data);
      setPendingAction(null);
      setSavedMessage(
        action === "unbind"
          ? "Telegram binding cleared. The member stays active and can re-bind by messaging the bot again."
          : "Member offboarded: Telegram unlinked and account deactivated. Their borrowing history is kept.",
      );
    } catch (err) {
      setSaveError(
        err instanceof Error
          ? err.message
          : `Failed to ${action === "unbind" ? "unbind" : "offboard"} this member.`,
      );
    } finally {
      setLifecycleBusy(false);
    }
  }

  if (!member) {
    const error = (directQ.error ?? membersQ.error) as Error | undefined;
    if (error || (!directQ.isLoading && !membersQ.isLoading)) {
      return (
        <div className="space-y-4">
          <Toast variant="error" message={error?.message ?? "Member not found."} />
          <Link href="/admin/members" className="text-sm text-neutral-400 hover:text-neutral-100">
            ← Back to members
          </Link>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const linked = member.telegram_user_id != null;
  const profile: [string, React.ReactNode][] = [
    ["Full name", member.full_name],
    ["Display name", member.display_name],
    ["NUS email", member.nus_email],
    ["Role", member.role],
    ["Joined", member.joined_at],
    ["Left", member.left_at],
  ];
  const update = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => (p ? { ...p, [key]: e.target.value } : p));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/members" className="text-sm text-neutral-500 hover:text-neutral-200">
          ← Members
        </Link>
        <PageHeader
          className="mt-2"
          title={member.display_name ?? member.full_name}
          description={member.nus_email ?? "No NUS email"}
          actions={
            <>
              {member.role !== "member" ? <StatusPill tone="warning">{member.role}</StatusPill> : null}
              {!member.active ? <StatusPill tone="inactive">inactive</StatusPill> : null}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setSaveError(null);
                  setForm(memberToForm(member));
                }}
              >
                Edit details
              </Button>
            </>
          }
        />
      </div>

      {savedMessage ? <Toast variant="success" message={savedMessage} onDismiss={() => setSavedMessage(null)} /> : null}
      {saveError && !form ? <Toast variant="error" message={saveError} onDismiss={() => setSaveError(null)} /> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card title="Holding now" subtitle="From the ledger: what is out with them">
            {holdingsQ.isLoading || holdersQ.isLoading ? (
              <Skeleton className="h-16 w-full" />
            ) : holding.length === 0 ? (
              <p className="text-sm text-neutral-500">Nothing out with this member.</p>
            ) : (
              <ul className="divide-y divide-neutral-800/70">
                {holding.map((line) => (
                  <li key={line.productId}>
                    <Link
                      href={`/admin/products/${line.productId}`}
                      className="flex items-center justify-between gap-3 py-2 text-sm transition-colors hover:text-neutral-100"
                    >
                      <span className="truncate text-neutral-200">{line.name}</span>
                      <span className="tabular-nums text-neutral-400">
                        {line.qty} <span className="text-neutral-500">{line.unit}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card title="Profile">
            <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
              {profile
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-neutral-500">{label}</dt>
                    <dd className="min-w-0 wrap-break-word text-neutral-200">{value}</dd>
                  </div>
                ))}
            </dl>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card
            title="Telegram"
            info="Linked only by the member themselves (a join code, or messaging the bot and being matched in the bind queue). Never typed in here."
          >
            <div className="flex flex-col gap-3 text-sm">
              <p className="flex items-center gap-2">
                <span aria-hidden className={`size-2 rounded-full ${linked ? "bg-status-good" : "bg-neutral-600"}`} />
                <span className="text-neutral-200">{linked ? "Linked" : "Not linked"}</span>
                {member.telegram_username ? <span className="text-neutral-500">@{member.telegram_username}</span> : null}
              </p>
              {member.telegram_bound_at ? (
                <p className="text-xs text-neutral-500">Since {new Date(member.telegram_bound_at).toLocaleString()}</p>
              ) : null}
              {linked ? (
                pendingAction === "unbind" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-amber-400">Clear the binding? They stay active and can re-link.</span>
                    <Button variant="danger" size="sm" disabled={lifecycleBusy} onClick={() => runLifecycleAction("unbind")}>
                      {lifecycleBusy ? "Unbinding…" : "Yes, unbind"}
                    </Button>
                    <Button variant="ghost" size="sm" disabled={lifecycleBusy} onClick={() => setPendingAction(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={lifecycleBusy}
                    onClick={() => setPendingAction("unbind")}
                    className="self-start cursor-pointer text-sm text-neutral-400 underline-offset-4 hover:text-neutral-100 hover:underline"
                  >
                    Unbind (changed handle or account)
                  </button>
                )
              ) : null}
            </div>
          </Card>

          {/*
            Offboarding sits apart from Edit on purpose: it is a one-click
            state change with consequences the Active checkbox doesn't have
            (it clears the binding), and burying it behind "Save" would make
            it far too easy to trigger by accident.
          */}
          <section className="rounded-xl border border-amber-500/25 p-4">
            <h2 className="flex items-center gap-1 text-base font-semibold text-neutral-100">Offboard</h2>
            <p className="mt-1 text-sm text-neutral-400">
              Unlinks Telegram and deactivates them, effective on their next request. Their borrowing history is kept
              (docs/tele-qr/pdpa.md).
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {pendingAction === "offboard" ? (
                <>
                  <span className="text-xs text-amber-400">
                    Offboard {member.display_name ?? member.full_name}?
                  </span>
                  <Button variant="danger" size="sm" disabled={lifecycleBusy} onClick={() => runLifecycleAction("offboard")}>
                    {lifecycleBusy ? "Offboarding…" : "Yes, offboard"}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={lifecycleBusy} onClick={() => setPendingAction(null)}>
                    Cancel
                  </Button>
                </>
              ) : member.active ? (
                <Button variant="secondary" size="sm" disabled={lifecycleBusy} onClick={() => setPendingAction("offboard")}>
                  Offboard member
                </Button>
              ) : (
                <span className="text-sm text-neutral-500">
                  Already inactive{member.left_at ? ` since ${member.left_at}` : ""}.
                </span>
              )}
            </div>
          </section>
        </div>
      </div>

      <Drawer
        open={form !== null}
        onClose={() => setForm(null)}
        title="Edit member"
        description={member.full_name}
        footer={
          <>
            <Button type="submit" form="edit-member" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
              Cancel
            </Button>
            {saveError ? <p className="text-sm text-red-400">{saveError}</p> : null}
          </>
        }
      >
        {form ? (
          <form id="edit-member" onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className={LABEL}>
              <span className={CAPTION}>Full name *</span>
              <input required value={form.full_name} onChange={update("full_name")} className={FIELD} />
            </label>
            <label className={LABEL}>
              <span className={CAPTION}>Display name</span>
              <input value={form.display_name} onChange={update("display_name")} className={FIELD} />
            </label>
            <label className={LABEL}>
              <span className={CAPTION}>NUS email</span>
              <input type="email" value={form.nus_email} onChange={update("nus_email")} className={FIELD} />
              <span className={HELP}>For staff, must exactly match their sign-in email.</span>
            </label>
            <label className={LABEL}>
              <span className={CAPTION}>Telegram username</span>
              <input value={form.telegram_username} onChange={update("telegram_username")} placeholder="without @" className={FIELD} />
            </label>
            <div className="grid grid-cols-2 gap-4">
              <label className={LABEL}>
                <span className={CAPTION}>Role</span>
                <select value={form.role} onChange={update("role")} className={FIELD}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2 self-end pb-2.5 text-sm text-neutral-300">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((p) => (p ? { ...p, active: e.target.checked } : p))}
                />
                Active
              </label>
              <label className={LABEL}>
                <span className={CAPTION}>Joined</span>
                <input type="date" value={form.joined_at} onChange={update("joined_at")} className={FIELD} />
              </label>
              <label className={LABEL}>
                <span className={CAPTION}>Left</span>
                <input type="date" value={form.left_at} onChange={update("left_at")} className={FIELD} />
              </label>
            </div>
          </form>
        ) : null}
      </Drawer>
    </div>
  );
}
