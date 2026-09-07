"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";

import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";

type Member = Database["public"]["Tables"]["members"]["Row"];
type Role = "member" | "admin";

const ROLES: Role[] = ["member", "admin"];

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
  const supabase = useMemo(() => getBrowserClient(), []);

  const [member, setMember] = useState<Member | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const { data, error } = await supabase
          .from("members")
          .select("*")
          .eq("id", id)
          .single();
        if (error) throw error;
        if (cancelled) return;
        setMember(data);
        setForm(memberToForm(data));
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "Failed to load.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

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
      setSaveError("Role must be 'member' or 'admin'.");
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
          telegram_username: form.telegram_username.trim() || null,
          role: form.role,
          joined_at: form.joined_at || null,
          left_at: form.left_at || null,
          active: form.active,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      setMember(data);
      setForm(memberToForm(data));
      setSavedMessage("Saved.");
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save member.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-neutral-400">Loading…</p>;
  }

  if (loadError || !member || !form) {
    return (
      <div className="space-y-4">
        <Toast variant="error" message={loadError ?? "Member not found."} />
        <Link href="/admin/members" className="text-sm font-medium text-red-400">
          &larr; Back to members
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/members" className="text-sm font-medium text-red-400">
          &larr; Back to members
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-neutral-100">
          Edit member: {member.display_name ?? member.full_name}
        </h1>
      </div>

      <section className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
        {saveError ? (
          <div className="mb-4">
            <Toast variant="error" message={saveError} onDismiss={() => setSaveError(null)} />
          </div>
        ) : null}
        {savedMessage ? (
          <div className="mb-4">
            <Toast
              variant="success"
              message={savedMessage}
              onDismiss={() => setSavedMessage(null)}
            />
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Full name *</span>
            <input
              required
              value={form.full_name}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, full_name: e.target.value } : p))
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Display name</span>
            <input
              value={form.display_name}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, display_name: e.target.value } : p))
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">NUS email</span>
            <input
              type="email"
              value={form.nus_email}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, nus_email: e.target.value } : p))
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
            <span className="text-xs text-neutral-400">
              Must exactly match this member&apos;s Supabase Auth email for
              them to sign into /admin, if their role is admin.
            </span>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Telegram username</span>
            <input
              value={form.telegram_username}
              onChange={(e) =>
                setForm((p) =>
                  p ? { ...p, telegram_username: e.target.value } : p,
                )
              }
              placeholder="without @"
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Role</span>
            <select
              value={form.role}
              onChange={(e) =>
                setForm((p) =>
                  p ? { ...p, role: e.target.value as Role } : p,
                )
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <div className="flex items-center gap-4 pt-6">
            <label className="flex items-center gap-2 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) =>
                  setForm((p) => (p ? { ...p, active: e.target.checked } : p))
                }
              />
              Active
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Joined</span>
            <input
              type="date"
              value={form.joined_at}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, joined_at: e.target.value } : p))
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Left</span>
            <input
              type="date"
              value={form.left_at}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, left_at: e.target.value } : p))
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
          </label>

          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-neutral-200">
              Telegram binding (read-only)
            </span>
            <p className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-300">
              telegram_user_id: {member.telegram_user_id ?? "—"}
              <br />
              telegram_bound_at:{" "}
              {member.telegram_bound_at
                ? new Date(member.telegram_bound_at).toLocaleString()
                : "—"}
            </p>
            <span className="text-xs text-neutral-400">
              Set only via the{" "}
              <Link href="/admin/bind-queue" className="text-red-400 hover:text-red-300">
                bind queue
              </Link>{" "}
              when the member first messages the bot -- not editable here.
            </span>
          </div>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
