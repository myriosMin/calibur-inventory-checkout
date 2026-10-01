"use client";

import { useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import Drawer from "@/components/admin/Drawer";
import { CAPTION, FIELD, HELP, LABEL } from "@/components/admin/form";
import PageHeader from "@/components/admin/PageHeader";
import Segmented from "@/components/admin/Segmented";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { IconPlus } from "@/components/ui/icons";
import Toast from "@/components/ui/Toast";
import { KEYS, revalidate, useHolders, useMembers, type HolderRow, type MemberRow } from "@/lib/admin/queries";
import { getBrowserClient } from "@/lib/supabase/browser";

type Holder = HolderRow;

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

type KindFilter = "all" | "store" | "robot" | "member" | "pseudo";

function kindGroup(kind: string): Exclude<KindFilter, "all"> {
  return kind === "consumed" || kind === "adjustment" ? "pseudo" : (kind as Exclude<KindFilter, "all">);
}

function memberLabel(member: Pick<MemberRow, "full_name" | "display_name">): string {
  return member.display_name ?? member.full_name;
}

/**
 * Everywhere stock can be. Mostly read-only: the store and the pseudo-holders
 * are seeded once, member holders are created by a trigger. This page exists
 * for the one thing that does need a hand: adding a robot.
 */
export default function AdminHoldersPage() {
  const holdersQ = useHolders();
  const membersQ = useMembers();
  const holders = useMemo(() => holdersQ.data ?? [], [holdersQ.data]);
  const members = useMemo(() => membersQ.data ?? [], [membersQ.data]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);

  const [filter, setFilter] = useState<KindFilter>("robot");
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<CreatableKind>("robot");
  const [name, setName] = useState("");
  const [memberId, setMemberId] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  const counts = useMemo(() => {
    const result: Record<KindFilter, number> = { all: holders.length, store: 0, robot: 0, member: 0, pseudo: 0 };
    for (const holder of holders) result[kindGroup(holder.kind)] += 1;
    return result;
  }, [holders]);

  const visible = useMemo(
    () => holders.filter((holder) => filter === "all" || kindGroup(holder.kind) === filter),
    [holders, filter],
  );

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
      setFormError(error.message);
      return;
    }

    setToast({ variant: "success", message: `Holder "${trimmedName}" created.` });
    setName("");
    setMemberId("");
    setFormOpen(false);
    await revalidate(KEYS.holders);
  };

  const columns: Column<Holder>[] = [
    { key: "name", header: "Name", render: (h) => <span className="font-medium text-neutral-100">{h.name}</span> },
    { key: "kind", header: "Kind", render: (h) => <span className="text-neutral-400">{h.kind}</span> },
    {
      key: "member",
      header: "Member",
      render: (h) => {
        if (h.kind !== "member" || !h.member_id) return <span className="text-neutral-600">—</span>;
        const member = memberById.get(h.member_id);
        return member ? memberLabel(member) : h.member_id;
      },
    },
    {
      key: "status",
      header: "",
      className: "text-right",
      render: (h) => (h.active ? null : <StatusPill tone="inactive">inactive</StatusPill>),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Holders"
        description="Everywhere stock can be: the store, robots and members."
        info="The store and the consumed / adjustment bookkeeping holders are seeded once. A member's holder is created automatically with the member. Add robots here as the club builds them."
        actions={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <IconPlus size={16} />
            Add robot
          </Button>
        }
      />

      {toast ? <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} /> : null}

      <Segmented
        ariaLabel="Holder kind"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "robot", label: "Robots", count: counts.robot },
          { value: "member", label: "Members", count: counts.member },
          { value: "store", label: "Store", count: counts.store },
          { value: "pseudo", label: "Bookkeeping", count: counts.pseudo },
          { value: "all", label: "All", count: counts.all },
        ]}
      />

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(h) => h.id}
          loading={holdersQ.isLoading}
          error={(holdersQ.error as Error | undefined)?.message ?? null}
          emptyMessage="No holders of this kind."
        />
      </Card>

      <Drawer
        open={formOpen}
        onClose={() => {
          setFormOpen(false);
          setFormError(null);
        }}
        title={kind === "member" ? "Add member holder" : "Add robot"}
        footer={
          <>
            <Button type="submit" form="new-holder" size="sm" disabled={submitting}>
              {submitting ? "Adding…" : "Add holder"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
            {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
          </>
        }
      >
        <form id="new-holder" onSubmit={handleSubmit} className="flex flex-col gap-4">
          <label className={LABEL}>
            <span className={CAPTION}>Name *</span>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Hero 2027" className={FIELD} />
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>Kind</span>
            <select value={kind} onChange={(e) => handleKindChange(e.target.value as CreatableKind)} className={FIELD}>
              {CREATABLE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
            <span className={HELP}>
              Member holders are created automatically. Pick &ldquo;member&rdquo; only to recreate one that was removed.
            </span>
          </label>
          {kind === "member" ? (
            <label className={LABEL}>
              <span className={CAPTION}>Member *</span>
              <select value={memberId} onChange={(e) => setMemberId(e.target.value)} className={FIELD}>
                <option value="">Choose a member…</option>
                {members.map((m) => (
                  <option key={m.id} value={m.id}>
                    {memberLabel(m)}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </form>
      </Drawer>
    </div>
  );
}
