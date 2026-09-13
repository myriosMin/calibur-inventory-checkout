"use client";

import { useEffect, useState } from "react";

import DataTable, { type Column } from "@/components/admin/DataTable";
import StatusPill, { type StatusTone } from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { getBrowserClient } from "@/lib/supabase/browser";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { Database } from "@/lib/types/database";

import {
  CONDITIONS,
  EMPTY_UNIT_FORM,
  UNIT_OWNERSHIPS,
  unitFormToRow,
  unitToForm,
  type Condition,
  type UnitFormState,
  type UnitOwnership,
} from "./unit-form";

type AssetUnit = Database["public"]["Tables"]["asset_units"]["Row"];

const CONDITION_TONE: Record<string, StatusTone> = {
  ok: "active",
  faulty: "danger",
  unknown: "warning",
  missing: "inactive",
  disposed: "inactive",
};

const INPUT = "min-h-11 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm";

/**
 * The per-unit register for one product: component IDs, serials, condition,
 * and which individual units are on loan to the club. Identity only -- where
 * the units are is the ledger's job (HoldingsPanel), which is why there is no
 * holder field here.
 */
export default function UnitsPanel({ productId }: { productId: string }) {
  const [units, setUnits] = useState<AssetUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  /** null = no editor open; "new" = adding; otherwise the unit id being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<UnitFormState>(EMPTY_UNIT_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function load() {
    const supabase = getBrowserClient();
    try {
      const rows = await fetchAllRows((from, to) =>
        supabase.from("asset_units").select("*").eq("product_id", productId).order("unit_code").range(from, to),
      );
      setUnits(rows);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load units.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  function openEditor(unit: AssetUnit | null) {
    setSaveError(null);
    setEditing(unit ? unit.id : "new");
    setForm(unit ? unitToForm(unit) : EMPTY_UNIT_FORM);
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const result = unitFormToRow(form);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const supabase = getBrowserClient();
    const { error } =
      editing === "new"
        ? await supabase.from("asset_units").insert({ ...result.row, product_id: productId })
        : await supabase.from("asset_units").update(result.row).eq("id", editing!);
    setSaving(false);
    if (error) {
      setSaveError(error.code === "23505" ? `Component ID ${result.row.unit_code} is already used.` : error.message);
      return;
    }
    setEditing(null);
    await load();
  }

  const counts = CONDITIONS.map((c) => [c, units.filter((u) => u.condition === c).length] as const).filter(([, n]) => n > 0);

  const columns: Column<AssetUnit>[] = [
    {
      key: "code",
      header: "Component ID",
      render: (u) => (
        <span className="font-medium text-neutral-100">
          {u.unit_code}
          {!u.active ? <span className="ml-2 text-xs text-neutral-500">inactive</span> : null}
        </span>
      ),
    },
    { key: "serial", header: "Serial", render: (u) => u.serial_number ?? "—" },
    {
      key: "condition",
      header: "Condition",
      render: (u) => <StatusPill tone={CONDITION_TONE[u.condition] ?? "inactive"}>{u.condition}</StatusPill>,
    },
    {
      key: "owner",
      header: "Owner",
      render: (u) => (u.ownership === "on_loan" ? <StatusPill tone="warning">on loan · {u.loaned_from}</StatusPill> : "club"),
    },
    { key: "seen", header: "Last seen", render: (u) => u.last_seen_location ?? "—" },
    { key: "checked", header: "Checked", render: (u) => u.last_checked_on ?? "—" },
    {
      key: "notes",
      header: "Notes",
      render: (u) => <span className="block max-w-64 truncate text-neutral-400" title={u.notes ?? ""}>{u.notes ?? "—"}</span>,
    },
    {
      key: "edit",
      header: "",
      className: "text-right",
      render: (u) => (
        <Button variant="ghost" onClick={() => openEditor(u)} className="min-h-0 px-2 py-1 text-xs">
          Edit
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="text-xs text-neutral-400">
          {units.length === 0
            ? "No individual units recorded. Add them if each one carries its own sticker or serial."
            : counts.map(([c, n]) => `${n} ${c}`).join(" · ")}
        </p>
        {editing === null ? (
          <Button variant="secondary" onClick={() => openEditor(null)} className="min-h-0 px-3 py-1.5 text-xs">
            + Add unit
          </Button>
        ) : null}
      </div>

      {editing !== null ? (
        <form onSubmit={handleSave} className="grid grid-cols-1 gap-3 border-y border-neutral-800 bg-neutral-950/50 p-4 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            Component ID *
            <input value={form.unit_code} onChange={(e) => setForm((f) => ({ ...f, unit_code: e.target.value }))} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            Serial number
            <input value={form.serial_number} onChange={(e) => setForm((f) => ({ ...f, serial_number: e.target.value }))} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            Condition
            <select value={form.condition} onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value as Condition }))} className={INPUT}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            Owner
            <select value={form.ownership} onChange={(e) => setForm((f) => ({ ...f, ownership: e.target.value as UnitOwnership }))} className={INPUT}>
              {UNIT_OWNERSHIPS.map((o) => (
                <option key={o} value={o}>
                  {o === "owned" ? "Club" : "On loan to the club"}
                </option>
              ))}
            </select>
          </label>
          {form.ownership === "on_loan" ? (
            <>
              <label className="flex flex-col gap-1 text-xs text-neutral-300">
                On loan from *
                <input value={form.loaned_from} onChange={(e) => setForm((f) => ({ ...f, loaned_from: e.target.value }))} className={INPUT} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-neutral-300">
                Due back
                <input type="date" value={form.loan_due} onChange={(e) => setForm((f) => ({ ...f, loan_due: e.target.value }))} className={INPUT} />
              </label>
            </>
          ) : null}
          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            Labelled
            <select value={form.labelled} onChange={(e) => setForm((f) => ({ ...f, labelled: e.target.value as UnitFormState["labelled"] }))} className={INPUT}>
              <option value="">Unknown</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            Last seen
            <input value={form.last_seen_location} onChange={(e) => setForm((f) => ({ ...f, last_seen_location: e.target.value }))} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-300">
            Last checked
            <input type="date" value={form.last_checked_on} onChange={(e) => setForm((f) => ({ ...f, last_checked_on: e.target.value }))} className={INPUT} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-neutral-300 sm:col-span-3">
            Notes
            <input value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} className={INPUT} />
          </label>
          <label className="flex items-center gap-2 text-xs text-neutral-300">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            Active
          </label>
          <div className="flex items-center gap-2 sm:col-span-2 sm:justify-end">
            {saveError ? <span className="text-xs text-red-400">{saveError}</span> : null}
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing === "new" ? "Add unit" : "Save unit"}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      {units.length > 0 || loading || loadError ? (
        <DataTable columns={columns} rows={units} rowKey={(u) => u.id} loading={loading} error={loadError} />
      ) : null}
    </div>
  );
}
