"use client";

import { useEffect, useState } from "react";

import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";

type Holder = Database["public"]["Tables"]["holders"]["Row"];
type Member = Pick<
  Database["public"]["Tables"]["members"]["Row"],
  "id" | "full_name" | "display_name"
>;

// Kinds an admin can create *here*. `store`, `consumed`, and `adjustment`
// are system-seeded singletons (inserted once by the 0003_holders.sql
// migration) -- there is exactly one of each, forever, and the unique index
// on (kind, name) where active would reject a duplicate anyway. `member`
// holders are normally auto-created by the create_member_holder trigger the
// instant a members row is inserted, so admins never need to hand-create
// one in the ordinary flow -- but the option is kept here (rather than
// hidden) as an escape hatch for the rare case a member's auto-created
// holder was deleted/deactivated and needs to be recreated by hand, per the
// data-model doc's "members are provisioned by admins" note. `robot` is the
// kind this page actually exists for: the club adds a handful of new robots
// roughly annually, and this is the only way to do it without a migration.
const CREATABLE_KINDS = ["robot", "member"] as const;
type CreatableKind = (typeof CREATABLE_KINDS)[number] | "";

function memberLabel(member: Member): string {
  return member.display_name ?? member.full_name;
}

function holderMemberLabel(holder: Holder, members: Member[]): string | null {
  if (holder.kind !== "member" || !holder.member_id) return null;
  const member = members.find((m) => m.id === holder.member_id);
  return member ? memberLabel(member) : holder.member_id;
}

export default function AdminHoldersPage() {
  const [holders, setHolders] = useState<Holder[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [kind, setKind] = useState<CreatableKind>("robot");
  const [name, setName] = useState("");
  const [memberId, setMemberId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = getBrowserClient();

    const [holdersRes, membersRes] = await Promise.all([
      supabase
        .from("holders")
        .select("*")
        .order("kind")
        .order("name"),
      supabase
        .from("members")
        .select("id, full_name, display_name")
        .order("full_name"),
    ]);

    if (holdersRes.error) {
      setLoadError(holdersRes.error.message);
    } else {
      setHolders(holdersRes.data ?? []);
    }
    if (membersRes.error) {
      setLoadError((prev) => prev ?? membersRes.error!.message);
    } else {
      setMembers(membersRes.data ?? []);
    }
    setLoading(false);
  };

  useEffect(() => {
    // Mount-only fetch; `cancelled` guards against setting state after
    // unmount if the request is still in flight (matches the pattern in
    // src/app/admin/products/page.tsx).
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadData();
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleKindChange = (next: CreatableKind) => {
    setKind(next);
    // A holder can't be both a non-member kind and have member_id set (the
    // DB's holder_member_link CHECK enforces this) -- clear the picker the
    // moment it stops applying so a stale selection can't sneak through.
    if (next !== "member") {
      setMemberId("");
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const trimmedName = name.trim();
    if (!kind) {
      setFormError("Kind is required.");
      return;
    }
    if (!trimmedName) {
      setFormError("Name is required.");
      return;
    }
    // Mirror the DB's `holder_member_link` CHECK ((kind = 'member') =
    // (member_id is not null)) client-side, before it ever reaches Supabase.
    if (kind === "member" && !memberId) {
      setFormError("Member holders require a linked member.");
      return;
    }
    if (kind !== "member" && memberId) {
      setFormError(`A '${kind}' holder cannot be linked to a member.`);
      return;
    }

    setSubmitting(true);
    const supabase = getBrowserClient();
    const { error } = await supabase.from("holders").insert({
      kind,
      name: trimmedName,
      member_id: kind === "member" ? memberId : null,
    });
    setSubmitting(false);

    if (error) {
      setToast({ variant: "error", message: error.message });
      return;
    }

    setToast({ variant: "success", message: `Holder "${trimmedName}" created.` });
    setName("");
    setMemberId("");
    await loadData();
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">Holders</h1>
        <p className="mt-1 text-sm text-slate-600">
          Store, robot, member, and pseudo-holders that stock can be moved
          between. Use this form mainly to add new <strong>robots</strong> as
          the club acquires them.{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">store</code>,{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">consumed</code>,
          and{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">adjustment</code>{" "}
          are system-seeded singletons that already exist and shouldn&apos;t be
          duplicated, so they aren&apos;t offered below.{" "}
          <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">member</code>{" "}
          holders are normally created automatically when a member is added;
          only use it here to recreate one that was removed by hand.
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
        <h2 className="text-sm font-semibold text-slate-900">New holder</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Kind
            <select
              value={kind}
              onChange={(e) => handleKindChange(e.target.value as CreatableKind)}
              className="min-h-11 rounded-lg border border-slate-300 px-3 text-base"
            >
              {CREATABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm text-slate-700">
            Name
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={kind === "robot" ? "e.g. Sentry 2" : "Holder name"}
              className="min-h-11 rounded-lg border border-slate-300 px-3 text-base"
            />
          </label>
          {kind === "member" ? (
            <label className="flex flex-col gap-1 text-sm text-slate-700 sm:col-span-2">
              Linked member
              <select
                value={memberId}
                onChange={(e) => setMemberId(e.target.value)}
                required
                className="min-h-11 rounded-lg border border-slate-300 px-3 text-base"
              >
                <option value="">Select a member…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
        {formError ? <p className="text-sm text-red-600">{formError}</p> : null}
        <div>
          <Button type="submit" disabled={submitting}>
            {submitting ? "Creating…" : "Create holder"}
          </Button>
        </div>
      </form>

      <div className="rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-900">
          All holders
        </h2>
        {loading ? (
          <p className="p-4 text-sm text-slate-500">Loading…</p>
        ) : loadError ? (
          <p className="p-4 text-sm text-red-600">{loadError}</p>
        ) : holders.length === 0 ? (
          <p className="p-4 text-sm text-slate-500">No holders yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Kind</th>
                  <th className="px-4 py-2 font-medium">Linked member</th>
                  <th className="px-4 py-2 font-medium">Active</th>
                </tr>
              </thead>
              <tbody>
                {holders.map((holder) => (
                  <tr key={holder.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-2 text-slate-900">{holder.name}</td>
                    <td className="px-4 py-2 text-slate-600">{holder.kind}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {holderMemberLabel(holder, members) ?? "—"}
                    </td>
                    <td className="px-4 py-2">
                      {holder.active ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
                          Active
                        </span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Inactive
                        </span>
                      )}
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
