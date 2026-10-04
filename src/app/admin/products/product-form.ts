import { EXPENSIVE_THRESHOLD_SGD, expenseBasis, type ExpenseBasis, isExpensive } from "@/lib/expensive";
import type { Database } from "@/lib/types/database";

/**
 * The product form shared by the create form (products/page.tsx) and the
 * edit page (products/[id]/page.tsx): its state shape, and the one place the
 * text inputs turn into a row. Pure, so the validation that mirrors the DB's
 * CHECKs is unit-tested instead of discovered as a 23514 from a reviewer.
 */

type Product = Database["public"]["Tables"]["products"]["Row"];

export const TIERS = ["asset", "bulk", "loose"] as const;
export const CRITICALITIES = ["critical", "standard", "expendable"] as const;
export const OWNERSHIPS = ["owned", "on_loan", "mixed"] as const;

export type Tier = (typeof TIERS)[number];
export type Criticality = (typeof CRITICALITIES)[number];
export type Ownership = (typeof OWNERSHIPS)[number];

export const CRITICALITY_HELP: Record<Criticality, string> = {
  critical: "Expensive, competition-mandatory, safety-relevant or irreplaceable. Chased if not returned.",
  standard: "Reusable kit that should come back.",
  expendable: "Taken and used up. Never chased.",
};

export const OWNERSHIP_LABELS: Record<Ownership, string> = {
  owned: "Owned by the club",
  on_loan: "On loan to the club",
  mixed: "Some units on loan",
};

export interface ProductFormState {
  name: string;
  tier: Tier;
  criticality: Criticality;
  category: string;
  location_id: string;
  returnable: boolean;
  unit: string;
  part_number: string;
  spec: string;
  min_stock: string;
  notes: string;
  active: boolean;
  ownership: Ownership;
  loaned_from: string;
  loan_due: string;
  supplier: string;
  unit_cost_sgd: string;
}

export const EMPTY_PRODUCT_FORM: ProductFormState = {
  name: "",
  tier: "bulk",
  criticality: "expendable",
  category: "",
  location_id: "",
  returnable: false,
  unit: "pcs",
  part_number: "",
  spec: "",
  min_stock: "",
  notes: "",
  active: true,
  ownership: "owned",
  loaned_from: "",
  loan_due: "",
  supplier: "",
  unit_cost_sgd: "",
};

const oneOf = <T extends string>(values: readonly T[], value: string, fallback: T): T =>
  (values as readonly string[]).includes(value) ? (value as T) : fallback;

export function productToForm(product: Product): ProductFormState {
  return {
    name: product.name,
    tier: oneOf(TIERS, product.tier, "bulk"),
    criticality: oneOf(CRITICALITIES, product.criticality, "standard"),
    category: product.category ?? "",
    location_id: product.location_id ?? "",
    returnable: product.returnable,
    unit: product.unit,
    part_number: product.part_number ?? "",
    spec: product.spec != null ? JSON.stringify(product.spec, null, 2) : "",
    min_stock: product.min_stock != null ? String(product.min_stock) : "",
    notes: product.notes ?? "",
    active: product.active,
    ownership: oneOf(OWNERSHIPS, product.ownership, "owned"),
    loaned_from: product.loaned_from ?? "",
    loan_due: product.loan_due ?? "",
    supplier: product.supplier ?? "",
    unit_cost_sgd: product.unit_cost_sgd != null ? String(product.unit_cost_sgd) : "",
  };
}

/**
 * What changing criticality implies, so a reviewer doesn't have to remember
 * it: anything that has to come back is an `asset` and returnable;
 * expendables are `bulk` (or stay `loose`) and are consumed. Both remain
 * editable afterwards.
 */
export function criticalityDefaults(
  criticality: Criticality,
  tier: Tier,
  unitCostSgd = "",
): Pick<ProductFormState, "criticality" | "tier" | "returnable"> {
  if (criticality === "expendable") {
    // An expendable that costs S$20+ is still expensive (0028): it stays
    // returnable, so the checkout lends it instead of writing it off.
    const returnable = isExpensive({ unitCostSgd: parseCost(unitCostSgd), criticality });
    return { criticality, tier: tier === "loose" ? "loose" : "bulk", returnable };
  }
  return { criticality, tier: "asset", returnable: true };
}

/** The unit cost box as a number, or null when empty or not a number. */
function parseCost(raw: string): number | null {
  if (!raw.trim()) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/** What the form's current price and criticality make of the product (0028). */
export function formExpenseBasis(form: Pick<ProductFormState, "unit_cost_sgd" | "criticality">): ExpenseBasis {
  return expenseBasis({ unitCostSgd: parseCost(form.unit_cost_sgd), criticality: form.criticality });
}

/**
 * Typing a price of S$20 or more makes the product expensive, and an
 * expensive product must be returnable (products_expensive_returnable), so
 * the form switches returnable on rather than letting the save fail.
 */
export function unitCostPatch(
  raw: string,
  criticality: Criticality,
): Pick<ProductFormState, "unit_cost_sgd"> & Partial<Pick<ProductFormState, "returnable">> {
  return isExpensive({ unitCostSgd: parseCost(raw), criticality }) ? { unit_cost_sgd: raw, returnable: true } : { unit_cost_sgd: raw };
}

export type ProductWrite = Omit<
  Database["public"]["Tables"]["products"]["Insert"],
  "id" | "created_at" | "updated_at" | "legacy_ref" | "legacy_row" | "expensive"
>;

export type FormToRowResult = { ok: true; row: ProductWrite } | { ok: false; error: string };

/**
 * Validates and converts. Mirrors products_owned_has_no_lender: switching a
 * product back to "owned" clears the lender instead of failing the save.
 */
export function formToRow(form: ProductFormState): FormToRowResult {
  const name = form.name.trim();
  if (!name) return { ok: false, error: "Name is required." };

  let spec: unknown = null;
  if (form.spec.trim()) {
    try {
      spec = JSON.parse(form.spec);
    } catch {
      return { ok: false, error: "Spec must be valid JSON (or left empty)." };
    }
  }

  let minStock: number | null = null;
  if (form.min_stock.trim()) {
    const parsed = Number(form.min_stock);
    if (!Number.isInteger(parsed) || parsed < 0) {
      return { ok: false, error: "Min stock must be a whole number, 0 or more." };
    }
    minStock = parsed;
  }

  let unitCost: number | null = null;
  if (form.unit_cost_sgd.trim()) {
    const parsed = Number(form.unit_cost_sgd);
    if (!Number.isFinite(parsed) || parsed < 0) {
      return { ok: false, error: "Unit cost must be a number, 0 or more." };
    }
    unitCost = Math.round(parsed * 100) / 100;
  }

  if (!form.returnable && isExpensive({ unitCostSgd: unitCost, criticality: form.criticality })) {
    return {
      ok: false,
      error:
        unitCost !== null
          ? `At S$${unitCost.toFixed(2)} this is an expensive item (S$${EXPENSIVE_THRESHOLD_SGD}+), so it must be returnable: it is lent and tracked, never consumed at checkout.`
          : "Critical items with no price are treated as expensive, so they must be returnable.",
    };
  }

  const owned = form.ownership === "owned";
  const loanedFrom = form.loaned_from.trim();
  if (form.ownership === "on_loan" && !loanedFrom) {
    return { ok: false, error: "Say who it is on loan from." };
  }
  if (form.loan_due && !/^\d{4}-\d{2}-\d{2}$/.test(form.loan_due)) {
    return { ok: false, error: "Loan due must be a date." };
  }

  return {
    ok: true,
    row: {
      name,
      tier: form.tier,
      criticality: form.criticality,
      category: form.category.trim() || null,
      location_id: form.location_id || null,
      returnable: form.returnable,
      unit: form.unit.trim() || "pcs",
      part_number: form.part_number.trim() || null,
      spec: spec as ProductWrite["spec"],
      min_stock: minStock,
      notes: form.notes.trim() || null,
      active: form.active,
      ownership: form.ownership,
      loaned_from: owned ? null : loanedFrom || null,
      loan_due: owned ? null : form.loan_due || null,
      supplier: form.supplier.trim() || null,
      unit_cost_sgd: unitCost,
    },
  };
}
