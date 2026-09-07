"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";

type Member = Database["public"]["Tables"]["members"]["Row"];
type Role = "member" | "admin";

const ROLES: Role[] = ["member", "admin"];

const EMPTY_FORM = {
  full_name: "",
  display_name: "",
  nus_email: "",
  telegram_username: "",
  role: "member" as Role,
  joined_at: "",
};

type FormState = typeof EMPTY_FORM;

/**
 * Admin member list + create form. Mirrors the shape of
 * src/app/admin/products/page.tsx / holders/page.tsx. `telegram_user_id` and
 * `telegram_bound_at` are intentionally not create-form inputs -- they're
 * bot-managed and only ever set via the /admin/bind-queue flow. Inserting a
 * row here also fires the `create_member_holder` trigger
 * (0003_holders.sql), which auto-creates the linked `member`-kind holders
 * row -- this page must not try to create that holder itself.
 */
export default function AdminMembersPage() {
  const supabase = useMemo(() => getBrowserClient(), []);

  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);

  async function loadMembers() {
    setLoading(true);
    setLoadError(null);
    const { data, error } = await supabase
      .from("members")
      .select("*")
      .order("full_name", { ascending: true });

    if (error) {
      setLoadError(error.message);
    } else {
      setMembers(data ?? []);
    }
    setLoading(false);
  }

  useEffect(() => {
    // Mount-only fetch; `cancelled` guards against setting state after
    // unmount if the request is still in flight (matches the pattern in
    // src/app/admin/holders/page.tsx).
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadMembers();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      setFormError("Role must be 'member' or 'admin'.");
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase
      .from("members")
      .insert({
        full_name: fullName,
        display_name: form.display_name.trim() || null,
        nus_email: form.nus_email.trim() || null,
        telegram_username: form.telegram_username.trim() || null,
        role: form.role,
        joined_at: form.joined_at || null,
      })
      .select()
      .single();
    setSubmitting(false);

    if (error) {
      setToast({ variant: "error", message: error.message });
      return;
    }

    setToast({
      variant: "success",
      message: `Member "${data.display_name ?? data.full_name}" created.`,
    });
    setForm(EMPTY_FORM);
    await loadMembers();
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Members</h1>
        <p className="mt-1 text-sm text-slate-600">
          Club members who can use the Mini App and, if promoted to{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">admin</code>
          , sign in here. Creating a member automatically creates a linked{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">member</code>{" "}
          holder for them -- no need to add one on the Holders page.{" "}
          <span className="font-medium">
            NUS email
          </span>{" "}
          matters most for admins: it must exactly match the email of their
          Supabase Auth account for{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">is_admin()</code>{" "}
          to grant them access to this dashboard. Telegram binding
          (<code className="rounded bg-slate-100 px-1 py-0.5 text-xs">
            telegram_user_id
          </code>
          ) isn&apos;t set here -- it happens via the{" "}
          <Link href="/admin/bind-queue" className="text-emerald-700 hover:text-emerald-900">
            bind queue
          </Link>{" "}
          when the member first messages the bot.
        </p>
      </div>

      {toast ? (
        <Toast
          variant={toast.variant}
          message={toast.message}
          onDismiss={() => setToast(null)}
        />
      ) : null}

      <form
        onSubmit={handleSubmit}
        className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4"
      >
        <h2 className="text-sm font-semibold text-slate-900">New member</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Full name *
            <input
              type="text"
              required
              value={form.full_name}
              onChange={(e) =>
                setForm((p) => ({ ...p, full_name: e.target.value }))
              }
              className="min-h-11 rounded-lg border border-slate-300 px-3 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Display name
            <input
              type="text"
              value={form.display_name}
              onChange={(e) =>
                setForm((p) => ({ ...p, display_name: e.target.value }))
              }
              className="min-h-11 rounded-lg border border-slate-300 px-3 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            NUS email
            <input
              type="email"
              value={form.nus_email}
              onChange={(e) =>
                setForm((p) => ({ ...p, nus_email: e.target.value }))
              }
              placeholder="e123456@u.nus.edu"
              className="min-h-11 rounded-lg border border-slate-300 px-3 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Telegram username
            <input
              type="text"
              value={form.telegram_username}
              onChange={(e) =>
                setForm((p) => ({ ...p, telegram_username: e.target.value }))
              }
              placeholder="without @"
              className="min-h-11 rounded-lg border border-slate-300 px-3 text-base"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Role
            <select
              value={form.role}
              onChange={(e) =>
                setForm((p) => ({ ...p, role: e.target.value as Role }))
              }
              className="min-h-11 rounded-lg border border-slate-300 px-3 text-base"
            >
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <span className="text-xs text-slate-500">
              Only matters for /admin sign-in when combined with a matching
              NUS email above -- see the note at the top of this page.
            </span>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Joined
            <input
              type="date"
              value={form.joined_at}
              onChange={(e) =>
                setForm((p) => ({ ...p, joined_at: e.target.value }))
              }
              className="min-h-11 rounded-lg border border-slate-300 px-3 text-base"
            />
          </label>
        </div>
        {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
        <div>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create member"}
          </Button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
          All members ({members.length})
        </h2>
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : loadError ? (
          <p className="p-4 text-sm text-red-600">{loadError}</p>
        ) : members.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No members yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-4 py-2 font-medium">Full name</th>
                  <th className="px-4 py-2 font-medium">Display name</th>
                  <th className="px-4 py-2 font-medium">NUS email</th>
                  <th className="px-4 py-2 font-medium">Telegram</th>
                  <th className="px-4 py-2 font-medium">Bound</th>
                  <th className="px-4 py-2 font-medium">Role</th>
                  <th className="px-4 py-2 font-medium">Active</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {members.map((member) => (
                  <tr key={member.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 text-slate-900">{member.full_name}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {member.display_name ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {member.nus_email ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-slate-600">
                      {member.telegram_username
                        ? `@${member.telegram_username}`
                        : "—"}
                    </td>
                    <td className="px-4 py-2">
                      {member.telegram_user_id != null ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          Bound
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Unbound
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-slate-600">{member.role}</td>
                    <td className="px-4 py-2">
                      {member.active ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          Active
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Inactive
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/admin/members/${member.id}`}
                        className="text-sm font-medium text-emerald-700 hover:text-emerald-900"
                      >
                        Edit
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
