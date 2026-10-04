"use client";

import { useState } from "react";

import Button from "@/components/ui/Button";
import { EXPENSIVE_THRESHOLD_SGD, type ExpenseBasis } from "@/lib/expensive";
import { getBrowserClient } from "@/lib/supabase/browser";

import {
  CRITICALITIES,
  CRITICALITY_HELP,
  OWNERSHIPS,
  OWNERSHIP_LABELS,
  TIERS,
  criticalityDefaults,
  formExpenseBasis,
  unitCostPatch,
  type Criticality,
  type Ownership,
  type ProductFormState,
  type Tier,
} from "./product-form";

export interface LocationOption {
  id: string;
  name: string;
}

interface ProductFormFieldsProps {
  form: ProductFormState;
  onChange: (patch: Partial<ProductFormState>) => void;
  locations: LocationOption[];
  onLocationCreated: (location: LocationOption) => void;
  /** Existing categories, offered as suggestions so reviewers don't invent near-duplicates. */
  categories: string[];
}

const EXPENSE_HELP: Record<ExpenseBasis, { text: string; tone: string }> = {
  priced: { text: `Expensive (S$${EXPENSIVE_THRESHOLD_SGD}+): always returnable, tracked until it comes back.`, tone: "text-amber-300" },
  assumed: { text: "No price, but critical: treated as expensive. Add a price to be sure.", tone: "text-amber-300" },
  cheap: { text: `Under S$${EXPENSIVE_THRESHOLD_SGD}: not an expensive item.`, tone: "text-neutral-500" },
  unpriced: { text: `No price: can't tell whether it is expensive (S$${EXPENSIVE_THRESHOLD_SGD}+).`, tone: "text-neutral-500" },
};

const INPUT = "min-h-10 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100";
const LABEL = "flex flex-col gap-1 text-sm";
const CAPTION = "font-medium text-neutral-300";

/** The product fields, shared by the create form and the edit page. */
export default function ProductFormFields({
  form,
  onChange,
  locations,
  onLocationCreated,
  categories,
}: ProductFormFieldsProps) {
  const [newLocationName, setNewLocationName] = useState("");
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const basis = formExpenseBasis(form);
  const expensive = basis === "priced" || basis === "assumed";

  async function handleCreateLocation() {
    const name = newLocationName.trim();
    if (!name) return;
    setCreatingLocation(true);
    setLocationError(null);
    const { data, error } = await getBrowserClient()
      .from("locations")
      .insert({ name })
      .select("id, name")
      .single();
    setCreatingLocation(false);
    if (error) {
      setLocationError(error.message);
      return;
    }
    onLocationCreated(data);
    onChange({ location_id: data.id });
    setNewLocationName("");
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <label className={`${LABEL} sm:col-span-2`}>
        <span className={CAPTION}>Name *</span>
        <input required value={form.name} onChange={(e) => onChange({ name: e.target.value })} className={INPUT} />
      </label>

      <label className={LABEL}>
        <span className={CAPTION}>Category</span>
        <input
          value={form.category}
          onChange={(e) => onChange({ category: e.target.value })}
          list="product-categories"
          className={INPUT}
        />
        <datalist id="product-categories">
          {categories.map((category) => (
            <option key={category} value={category} />
          ))}
        </datalist>
      </label>

      <div className={LABEL}>
        <span className={CAPTION}>Location</span>
        <select value={form.location_id} onChange={(e) => onChange({ location_id: e.target.value })} className={INPUT}>
          <option value="">— none —</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>
              {loc.name}
            </option>
          ))}
        </select>
        <div className="mt-1 flex gap-2">
          <input
            value={newLocationName}
            onChange={(e) => setNewLocationName(e.target.value)}
            placeholder="New location name"
            className="min-h-9 min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 placeholder:text-neutral-600"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={creatingLocation || !newLocationName.trim()}
            onClick={handleCreateLocation}
          >
            Add location
          </Button>
        </div>
        {locationError ? <span className="text-xs text-red-400">{locationError}</span> : null}
      </div>

      <label className={LABEL}>
        <span className={CAPTION}>Criticality *</span>
        <select
          value={form.criticality}
          onChange={(e) => onChange(criticalityDefaults(e.target.value as Criticality, form.tier, form.unit_cost_sgd))}
          className={INPUT}
        >
          {CRITICALITIES.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-500">{CRITICALITY_HELP[form.criticality]}</span>
      </label>

      <label className={LABEL}>
        <span className={CAPTION}>Tier *</span>
        <select value={form.tier} onChange={(e) => onChange({ tier: e.target.value as Tier })} className={INPUT}>
          {TIERS.map((tier) => (
            <option key={tier} value={tier}>
              {tier}
            </option>
          ))}
        </select>
        <span className="text-xs text-neutral-500">How it is counted: asset = one by one, bulk = a number, loose = a level only.</span>
      </label>

      <label className={LABEL}>
        <span className={CAPTION}>Ownership *</span>
        <select
          value={form.ownership}
          onChange={(e) => onChange({ ownership: e.target.value as Ownership })}
          className={INPUT}
        >
          {OWNERSHIPS.map((value) => (
            <option key={value} value={value}>
              {OWNERSHIP_LABELS[value]}
            </option>
          ))}
        </select>
      </label>

      {form.ownership !== "owned" ? (
        <>
          <label className={LABEL}>
            <span className={CAPTION}>On loan from{form.ownership === "on_loan" ? " *" : ""}</span>
            <input
              value={form.loaned_from}
              onChange={(e) => onChange({ loaned_from: e.target.value })}
              placeholder="Department, club, company or person"
              className={INPUT}
            />
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>Due back</span>
            <input type="date" value={form.loan_due} onChange={(e) => onChange({ loan_due: e.target.value })} className={INPUT} />
          </label>
        </>
      ) : (
        <div className="hidden sm:block" />
      )}

      <label className={LABEL}>
        <span className={CAPTION}>Unit</span>
        <input value={form.unit} onChange={(e) => onChange({ unit: e.target.value })} className={INPUT} />
      </label>

      <label className={LABEL}>
        <span className={CAPTION}>Part number</span>
        <input value={form.part_number} onChange={(e) => onChange({ part_number: e.target.value })} className={INPUT} />
      </label>

      <label className={LABEL}>
        <span className={CAPTION}>Supplier</span>
        <input
          value={form.supplier}
          onChange={(e) => onChange({ supplier: e.target.value })}
          placeholder="e.g. DJI, LCSC, Cytron"
          className={INPUT}
        />
      </label>

      <label className={LABEL}>
        <span className={CAPTION}>Unit cost (SGD, estimate)</span>
        <input
          type="number"
          min="0"
          step="0.01"
          value={form.unit_cost_sgd}
          onChange={(e) => onChange(unitCostPatch(e.target.value, form.criticality))}
          className={INPUT}
        />
        <span className={`text-xs ${EXPENSE_HELP[basis].tone}`}>{EXPENSE_HELP[basis].text}</span>
      </label>

      <label className={LABEL}>
        <span className={CAPTION}>Min stock (low-stock alert)</span>
        <input
          type="number"
          min="0"
          value={form.min_stock}
          onChange={(e) => onChange({ min_stock: e.target.value })}
          className={INPUT}
        />
      </label>

      <div className="flex items-center gap-4 pt-6">
        <label className="flex items-center gap-2 text-sm text-neutral-200">
          <input
            type="checkbox"
            checked={form.returnable || expensive}
            disabled={expensive}
            title={expensive ? "Expensive items are always returnable" : undefined}
            onChange={(e) => onChange({ returnable: e.target.checked })}
          />
          Returnable
        </label>
        <label className="flex items-center gap-2 text-sm text-neutral-200">
          <input type="checkbox" checked={form.active} onChange={(e) => onChange({ active: e.target.checked })} />
          Active (visible in the Mini App)
        </label>
      </div>

      <label className={`${LABEL} sm:col-span-2`}>
        <span className={CAPTION}>Spec (JSON, optional)</span>
        <textarea
          value={form.spec}
          onChange={(e) => onChange({ spec: e.target.value })}
          rows={3}
          placeholder='{"value": "10k", "package": "0805"}'
          className="rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs text-neutral-100"
        />
      </label>

      <label className={`${LABEL} sm:col-span-2`}>
        <span className={CAPTION}>Notes</span>
        <textarea value={form.notes} onChange={(e) => onChange({ notes: e.target.value })} rows={3} className={INPUT} />
      </label>
    </div>
  );
}
