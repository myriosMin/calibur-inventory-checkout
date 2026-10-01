"use client";

import { useState } from "react";
import useSWR from "swr";

import DataTable, { type Column } from "@/components/admin/DataTable";
import Drawer from "@/components/admin/Drawer";
import { CAPTION, FIELD, LABEL } from "@/components/admin/form";
import StatusPill, { type StatusTone } from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { IconPlus } from "@/components/ui/icons";
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

/**
 * The per-unit register for one product: component IDs, serials, condition,
 * and which individual units are on loan to the club. Identity only -- where
 * the units are is the ledger's job (HoldingsPanel), which is why there is no
 * holder field here.
 */
export default function UnitsPanel({ productId }: { productId: string }) {
  const unitsQ = useSWR(["admin/asset-units", productId], () =>
    fetchAllRows<AssetUnit>((from, to) =>
      getBrowserClient().from("asset_units").select("*").eq("product_id", productId).order("unit_code").order("id").range(from, to),
    ),
  );
  const units = unitsQ.data ?? [];
  /** null = no editor open; "new" = adding; otherwise the unit id being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  const [form, setForm] = useState<UnitFormState>(EMPTY_UNIT_FORM);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

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
    await unitsQ.mutate();
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
  ];

  const field = <K extends keyof UnitFormState>(key: K) => ({
    value: form[key] as string,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [key]: e.target.value })),
  });

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3">
        <p className="text-sm text-neutral-500">
          {units.length === 0
            ? "None recorded. Add units if each carries its own sticker or serial."
            : counts.map(([c, n]) => `${n} ${c}`).join(" · ")}
        </p>
        <Button variant="secondary" size="sm" onClick={() => openEditor(null)}>
          <IconPlus size={15} />
          Add unit
        </Button>
      </div>

      {units.length > 0 || unitsQ.isLoading || unitsQ.error ? (
        <DataTable
          columns={columns}
          rows={units}
          rowKey={(u) => u.id}
          onRowClick={(u) => openEditor(u)}
          loading={unitsQ.isLoading}
          error={(unitsQ.error as Error | undefined)?.message ?? null}
        />
      ) : null}

      <Drawer
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === "new" ? "Add unit" : `Unit ${form.unit_code}`}
        description="Identity only. Where the unit is comes from the ledger."
        footer={
          <>
            <Button type="submit" form="unit-form" size="sm" disabled={saving}>
              {saving ? "Saving…" : editing === "new" ? "Add unit" : "Save unit"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(null)} disabled={saving}>
              Cancel
            </Button>
            {saveError ? <span className="text-sm text-red-400">{saveError}</span> : null}
          </>
        }
      >
        <form id="unit-form" onSubmit={handleSave} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className={LABEL}>
            <span className={CAPTION}>Component ID *</span>
            <input {...field("unit_code")} className={FIELD} />
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>Serial number</span>
            <input {...field("serial_number")} className={FIELD} />
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>Condition</span>
            <select value={form.condition} onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value as Condition }))} className={FIELD}>
              {CONDITIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>Owner</span>
            <select value={form.ownership} onChange={(e) => setForm((f) => ({ ...f, ownership: e.target.value as UnitOwnership }))} className={FIELD}>
              {UNIT_OWNERSHIPS.map((o) => (
                <option key={o} value={o}>
                  {o === "owned" ? "Club" : "On loan to the club"}
                </option>
              ))}
            </select>
          </label>
          {form.ownership === "on_loan" ? (
            <>
              <label className={LABEL}>
                <span className={CAPTION}>On loan from *</span>
                <input {...field("loaned_from")} className={FIELD} />
              </label>
              <label className={LABEL}>
                <span className={CAPTION}>Due back</span>
                <input type="date" {...field("loan_due")} className={FIELD} />
              </label>
            </>
          ) : null}
          <label className={LABEL}>
            <span className={CAPTION}>Labelled</span>
            <select value={form.labelled} onChange={(e) => setForm((f) => ({ ...f, labelled: e.target.value as UnitFormState["labelled"] }))} className={FIELD}>
              <option value="">Unknown</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </select>
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>Last seen</span>
            <input {...field("last_seen_location")} className={FIELD} />
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>Last checked</span>
            <input type="date" {...field("last_checked_on")} className={FIELD} />
          </label>
          <label className={`${LABEL} sm:col-span-2`}>
            <span className={CAPTION}>Notes</span>
            <input {...field("notes")} className={FIELD} />
          </label>
          <label className="flex items-center gap-2 text-sm text-neutral-300">
            <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
            Active
          </label>
        </form>
      </Drawer>
    </div>
  );
}
