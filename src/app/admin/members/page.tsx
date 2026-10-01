"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import Drawer from "@/components/admin/Drawer";
import { CAPTION, FIELD, FILTER, HELP, LABEL } from "@/components/admin/form";
import PageHeader from "@/components/admin/PageHeader";
import Segmented from "@/components/admin/Segmented";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { IconPlus, IconSearch } from "@/components/ui/icons";
import Toast from "@/components/ui/Toast";
import { KEYS, revalidate, upsertCached, useMembers, type MemberRow } from "@/lib/admin/queries";
import { MEMBER_ROLES, type MemberRole } from "@/lib/csv/member-roster";
import { getBrowserClient } from "@/lib/supabase/browser";
import { normalizeTelegramHandle } from "@/lib/utils/normalize";

import MemberImport from "./MemberImport";

type Role = MemberRole;

const ROLES: readonly Role[] = MEMBER_ROLES;

const EMPTY_FORM = {
  full_name: "",
  display_name: "",
  nus_email: "",
  telegram_username: "",
  role: "member" as Role,
  joined_at: "",
};

type FormState = typeof EMPTY_FORM;

type StatusFilter = "active" | "unlinked" | "staff" | "inactive" | "all";

function matchesStatus(member: MemberRow, filter: StatusFilter): boolean {
  switch (filter) {
    case "active":
      return member.active;
    case "unlinked":
      return member.active && member.telegram_user_id === null;
    case "staff":
      return member.role !== "member";
    case "inactive":
      return !member.active;
    default:
      return true;
  }
}

/**
 * The roster. `telegram_user_id` and `telegram_bound_at` are intentionally
 * not create-form inputs -- they're bot-managed and only ever set via the
 * join-code or bind-queue flows. Inserting a row fires the
 * `create_member_holder` trigger (0003_holders.sql), which auto-creates the
 * linked `member`-kind holder -- this page must not create that itself.
 */
export default function AdminMembersPage() {
  const membersQ = useMembers();
  const members = useMemo(() => membersQ.data ?? [], [membersQ.data]);

  const [status, setStatus] = useState<StatusFilter>("active");
  const [query, setQuery] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = { active: 0, unlinked: 0, staff: 0, inactive: 0, all: members.length };
    for (const member of members) {
      for (const key of ["active", "unlinked", "staff", "inactive"] as const) {
        if (matchesStatus(member, key)) result[key] += 1;
      }
    }
    return result;
  }, [members]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return members.filter(
      (member) =>
        matchesStatus(member, status) &&
        (!needle ||
          [member.full_name, member.display_name, member.nus_email, member.telegram_username].some((field) =>
            field?.toLowerCase().includes(needle),
          )),
    );
  }, [members, status, query]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);

    const fullName = form.full_name.trim();
    if (!fullName) {
      setFormError("Full name is required.");
      return;
    }
    // Mirror the DB's `members_role_check` CHECK client-side.
    if (!ROLES.includes(form.role)) {
      setFormError(`Role must be one of: ${ROLES.join(", ")}.`);
      return;
    }

    setSubmitting(true);
    const { data, error } = await getBrowserClient()
      .from("members")
      .insert({
        full_name: fullName,
        display_name: form.display_name.trim() || null,
        nus_email: form.nus_email.trim() || null,
        // Normalised the same way the bulk importer and the bind-queue
        // lookup do, so "@Alex" here matches the "alex" the bot reports.
        telegram_username: normalizeTelegramHandle(form.telegram_username) || null,
        role: form.role,
        joined_at: form.joined_at || null,
      })
      .select()
      .single();
    setSubmitting(false);

    if (error) {
      setFormError(error.message);
      return;
    }

    setToast({ variant: "success", message: `Added ${data.display_name ?? data.full_name}.` });
    setForm(EMPTY_FORM);
    setFormOpen(false);
    await upsertCached(KEYS.members, data);
    // The trigger created a holder too.
    void revalidate(KEYS.holders);
  }

  const columns: Column<MemberRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (m) => (
        <span className="block">
          <span className="font-medium text-neutral-100">{m.display_name ?? m.full_name}</span>
          {m.display_name && m.display_name !== m.full_name ? (
            <span className="block text-xs text-neutral-500">{m.full_name}</span>
          ) : null}
        </span>
      ),
    },
    { key: "email", header: "NUS email", render: (m) => <span className="text-neutral-400">{m.nus_email ?? "—"}</span> },
    {
      key: "telegram",
      header: "Telegram",
      render: (m) => (
        <span className="flex items-center gap-2">
          <span
            aria-hidden
            className={`size-1.5 rounded-full ${m.telegram_user_id !== null ? "bg-status-good" : "bg-neutral-600"}`}
          />
          <span className={m.telegram_user_id !== null ? "text-neutral-300" : "text-neutral-500"}>
            {m.telegram_username ? `@${m.telegram_username}` : m.telegram_user_id !== null ? "linked" : "not linked"}
          </span>
        </span>
      ),
    },
    {
      key: "role",
      header: "",
      className: "text-right",
      render: (m) => (
        <span className="flex justify-end gap-1">
          {m.role !== "member" ? <StatusPill tone="warning">{m.role}</StatusPill> : null}
          {!m.active ? <StatusPill tone="inactive">inactive</StatusPill> : null}
        </span>
      ),
    },
  ];

  const set = (key: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((p) => ({ ...p, [key]: e.target.value }));

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Members"
        description={
          membersQ.isLoading
            ? "The club roster."
            : `${counts.active} active · ${counts.unlinked} not on Telegram yet`
        }
        info={
          <>
            <p>
              Members can use the Mini App; admins and procurement can also sign in here. Adding a member creates
              their holder automatically.
            </p>
            <p>
              For staff, the NUS email must exactly match their sign-in account. Telegram is never typed in here: it
              links when they join with a{" "}
              <Link href="/admin/join-codes" className="text-red-400 hover:text-red-300">
                join code
              </Link>{" "}
              or through the{" "}
              <Link href="/admin/bind-queue" className="text-red-400 hover:text-red-300">
                bind queue
              </Link>
              .
            </p>
          </>
        }
        actions={
          <>
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              Import CSV
            </Button>
            <Button size="sm" onClick={() => setFormOpen(true)}>
              <IconPlus size={16} />
              Add member
            </Button>
          </>
        }
      />

      {toast ? <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} /> : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          ariaLabel="Member status"
          value={status}
          onChange={setStatus}
          options={[
            { value: "active", label: "Active", count: counts.active },
            { value: "unlinked", label: "Not on Telegram", count: counts.unlinked, tone: "warning" },
            { value: "staff", label: "Staff", count: counts.staff },
            { value: "inactive", label: "Inactive", count: counts.inactive },
            { value: "all", label: "All", count: counts.all },
          ]}
        />
        <label className="relative block">
          <span className="sr-only">Search members</span>
          <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, email or handle…"
            className={`${FILTER} w-full pl-9 sm:w-64`}
          />
        </label>
      </div>

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(m) => m.id}
          rowHref={(m) => `/admin/members/${m.id}`}
          loading={membersQ.isLoading}
          error={(membersQ.error as Error | undefined)?.message ?? null}
          emptyMessage={members.length === 0 ? "No members yet. Add one, or import the roster." : "Nobody matches."}
        />
      </Card>

      <Drawer
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setFormError(null);
        }}
        title="Add member"
        description="Their holder is created automatically."
        footer={
          <>
            <Button type="submit" form="new-member" size="sm" disabled={submitting}>
              {submitting ? "Adding…" : "Add member"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
          </>
        }
      >
        <form id="new-member" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className={LABEL}>
            <span className={CAPTION}>Full name *</span>
            <input type="text" required value={form.full_name} onChange={set("full_name")} className={FIELD} />
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>Display name</span>
            <input type="text" value={form.display_name} onChange={set("display_name")} className={FIELD} />
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>NUS email</span>
            <input type="email" value={form.nus_email} onChange={set("nus_email")} placeholder="e123456@u.nus.edu" className={FIELD} />
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>Telegram username</span>
            <input type="text" value={form.telegram_username} onChange={set("telegram_username")} placeholder="without @" className={FIELD} />
            <span className={HELP}>Lets the bind queue match them when they first message the bot.</span>
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className={LABEL}>
              <span className={CAPTION}>Role</span>
              <select value={form.role} onChange={set("role")} className={FIELD}>
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              <span className={CAPTION}>Joined</span>
              <input type="date" value={form.joined_at} onChange={set("joined_at")} className={FIELD} />
            </label>
          </div>
          <p className={HELP}>A staff role only grants sign-in here when the NUS email matches their account.</p>
        </form>
      </Drawer>

      <MemberImport
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImported={() => {
          void revalidate(KEYS.members);
          void revalidate(KEYS.holders);
        }}
      />
    </div>
  );
}
