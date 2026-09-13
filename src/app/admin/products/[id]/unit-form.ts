import type { Database } from "@/lib/types/database";

/** The per-unit register form (asset_units). Pure, so the CHECK mirrors are tested. */

type AssetUnit = Database["public"]["Tables"]["asset_units"]["Row"];

export const CONDITIONS = ["ok", "faulty", "unknown", "missing", "disposed"] as const;
export const UNIT_OWNERSHIPS = ["owned", "on_loan"] as const;

export type Condition = (typeof CONDITIONS)[number];
export type UnitOwnership = (typeof UNIT_OWNERSHIPS)[number];

export interface UnitFormState {
  unit_code: string;
  serial_number: string;
  condition: Condition;
  ownership: UnitOwnership;
  loaned_from: string;
  loan_due: string;
  labelled: "" | "true" | "false";
  last_seen_location: string;
  last_checked_on: string;
  notes: string;
  active: boolean;
}

export const EMPTY_UNIT_FORM: UnitFormState = {
  unit_code: "",
  serial_number: "",
  condition: "ok",
  ownership: "owned",
  loaned_from: "",
  loan_due: "",
  labelled: "",
  last_seen_location: "",
  last_checked_on: "",
  notes: "",
  active: true,
};

export function unitToForm(unit: AssetUnit): UnitFormState {
  return {
    unit_code: unit.unit_code,
    serial_number: unit.serial_number ?? "",
    condition: (CONDITIONS as readonly string[]).includes(unit.condition) ? (unit.condition as Condition) : "unknown",
    ownership: unit.ownership === "on_loan" ? "on_loan" : "owned",
    loaned_from: unit.loaned_from ?? "",
    loan_due: unit.loan_due ?? "",
    labelled: unit.labelled === null ? "" : unit.labelled ? "true" : "false",
    last_seen_location: unit.last_seen_location ?? "",
    last_checked_on: unit.last_checked_on ?? "",
    notes: unit.notes ?? "",
    active: unit.active,
  };
}

export type UnitWrite = Omit<
  Database["public"]["Tables"]["asset_units"]["Insert"],
  "id" | "product_id" | "created_at" | "updated_at" | "legacy_ref"
>;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Component IDs are uppercased: the unique index is case-sensitive, and
 * "am02-01" next to "AM02-01" is two stickers claiming one unit. Switching a
 * unit back to "owned" clears its lender (asset_units_owned_has_no_lender).
 */
export function unitFormToRow(form: UnitFormState): { ok: true; row: UnitWrite } | { ok: false; error: string } {
  const code = form.unit_code.trim().toUpperCase();
  if (!code) return { ok: false, error: "Component ID is required." };
  const lender = form.loaned_from.trim();
  if (form.ownership === "on_loan" && !lender) return { ok: false, error: "Say who this unit is on loan from." };
  if (form.loan_due && !DATE.test(form.loan_due)) return { ok: false, error: "Due back must be a date." };
  if (form.last_checked_on && !DATE.test(form.last_checked_on)) return { ok: false, error: "Last checked must be a date." };

  const owned = form.ownership === "owned";
  return {
    ok: true,
    row: {
      unit_code: code,
      serial_number: form.serial_number.trim() || null,
      condition: form.condition,
      ownership: form.ownership,
      loaned_from: owned ? null : lender,
      loan_due: owned ? null : form.loan_due || null,
      labelled: form.labelled === "" ? null : form.labelled === "true",
      last_seen_location: form.last_seen_location.trim() || null,
      last_checked_on: form.last_checked_on || null,
      notes: form.notes.trim() || null,
      active: form.active,
    },
  };
}
