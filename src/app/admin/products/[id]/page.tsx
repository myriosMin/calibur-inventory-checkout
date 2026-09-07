"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";

import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";

type Product = Database["public"]["Tables"]["products"]["Row"];
type Location = Database["public"]["Tables"]["locations"]["Row"];
type Tier = Product["tier"];

const TIERS: Tier[] = ["asset", "bulk", "loose"];

type FormState = {
  name: string;
  tier: Tier;
  category: string;
  location_id: string;
  returnable: boolean;
  unit: string;
  part_number: string;
  spec: string;
  min_stock: string;
  notes: string;
  active: boolean;
};

function productToForm(product: Product): FormState {
  return {
    name: product.name,
    tier: product.tier as Tier,
    category: product.category ?? "",
    location_id: product.location_id ?? "",
    returnable: product.returnable,
    unit: product.unit,
    part_number: product.part_number ?? "",
    spec: product.spec != null ? JSON.stringify(product.spec, null, 2) : "",
    min_stock: product.min_stock != null ? String(product.min_stock) : "",
    notes: product.notes ?? "",
    active: product.active,
  };
}

/**
 * Admin product edit page. Same shape as the create form on
 * src/app/admin/products/page.tsx, pre-populated and wired to `.update()`
 * instead of `.insert()`. Relies on the same RLS admin policy -- a session
 * that expires mid-edit surfaces the update error rather than silently
 * no-opping.
 */
export default function AdminProductEditPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const supabase = useMemo(() => getBrowserClient(), []);

  const [product, setProduct] = useState<Product | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  const [newLocationName, setNewLocationName] = useState("");
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [productResult, locationsResult] = await Promise.all([
          supabase.from("products").select("*").eq("id", id).single(),
          supabase.from("locations").select("*").order("name", { ascending: true }),
        ]);
        if (productResult.error) throw productResult.error;
        if (locationsResult.error) throw locationsResult.error;
        if (cancelled) return;
        setProduct(productResult.data);
        setForm(productToForm(productResult.data));
        setLocations(locationsResult.data ?? []);
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

  async function handleCreateLocation() {
    const name = newLocationName.trim();
    if (!name) return;
    setCreatingLocation(true);
    setLocationError(null);
    try {
      const { data, error } = await supabase
        .from("locations")
        .insert({ name })
        .select()
        .single();
      if (error) throw error;
      setLocations((prev) =>
        [...prev, data].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setForm((prev) => (prev ? { ...prev, location_id: data.id } : prev));
      setNewLocationName("");
    } catch (err) {
      setLocationError(
        err instanceof Error ? err.message : "Failed to create location.",
      );
    } finally {
      setCreatingLocation(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    setSaveError(null);
    setSavedMessage(null);

    const name = form.name.trim();
    if (!name) {
      setSaveError("Name is required.");
      return;
    }

    let spec: unknown = null;
    const trimmedSpec = form.spec.trim();
    if (trimmedSpec) {
      try {
        spec = JSON.parse(trimmedSpec);
      } catch {
        setSaveError("Spec must be valid JSON (or left empty).");
        return;
      }
    }

    let minStock: number | null = null;
    if (form.min_stock.trim()) {
      const parsed = Number(form.min_stock);
      if (!Number.isFinite(parsed)) {
        setSaveError("Min stock must be a number.");
        return;
      }
      minStock = parsed;
    }

    setSaving(true);
    try {
      const { data, error } = await supabase
        .from("products")
        .update({
          name,
          tier: form.tier,
          category: form.category.trim() || null,
          location_id: form.location_id || null,
          returnable: form.returnable,
          unit: form.unit.trim() || "pcs",
          part_number: form.part_number.trim() || null,
          spec: spec as never,
          min_stock: minStock,
          notes: form.notes.trim() || null,
          active: form.active,
        })
        .eq("id", id)
        .select()
        .single();

      if (error) throw error;

      setProduct(data);
      setForm(productToForm(data));
      setSavedMessage("Saved.");
    } catch (err) {
      setSaveError(
        err instanceof Error ? err.message : "Failed to save product.",
      );
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-neutral-400">Loading…</p>;
  }

  if (loadError || !product || !form) {
    return (
      <div className="space-y-4">
        <Toast variant="error" message={loadError ?? "Product not found."} />
        <Link href="/admin/products" className="text-sm font-medium text-red-400">
          &larr; Back to products
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <Link href="/admin/products" className="text-sm font-medium text-red-400">
          &larr; Back to products
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-neutral-100">
          Edit product: {product.name}
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
            <span className="font-medium text-neutral-200">Name *</span>
            <input
              required
              value={form.name}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, name: e.target.value } : p))
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Tier *</span>
            <select
              value={form.tier}
              onChange={(e) =>
                setForm((p) =>
                  p ? { ...p, tier: e.target.value as Tier } : p,
                )
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            >
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Category</span>
            <input
              value={form.category}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, category: e.target.value } : p))
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Location</span>
            <select
              value={form.location_id}
              onChange={(e) =>
                setForm((p) =>
                  p ? { ...p, location_id: e.target.value } : p,
                )
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            >
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
                className="min-w-0 flex-1 rounded-lg border border-neutral-700 px-3 py-1.5 text-xs"
              />
              <Button
                type="button"
                variant="secondary"
                disabled={creatingLocation || !newLocationName.trim()}
                onClick={handleCreateLocation}
                className="min-h-0 px-3 py-1.5 text-xs"
              >
                + New location
              </Button>
            </div>
            {locationError ? (
              <span className="text-xs text-red-400">{locationError}</span>
            ) : null}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Unit</span>
            <input
              value={form.unit}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, unit: e.target.value } : p))
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Part number</span>
            <input
              value={form.part_number}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, part_number: e.target.value } : p))
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-neutral-200">Min stock</span>
            <input
              type="number"
              value={form.min_stock}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, min_stock: e.target.value } : p))
              }
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
          </label>

          <div className="flex items-center gap-4 pt-6">
            <label className="flex items-center gap-2 text-sm text-neutral-200">
              <input
                type="checkbox"
                checked={form.returnable}
                onChange={(e) =>
                  setForm((p) =>
                    p ? { ...p, returnable: e.target.checked } : p,
                  )
                }
              />
              Returnable
            </label>
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

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-neutral-200">
              Spec (JSON, optional)
            </span>
            <textarea
              value={form.spec}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, spec: e.target.value } : p))
              }
              rows={3}
              placeholder='{"value": "10k", "package": "0805"}'
              className="rounded-lg border border-neutral-700 px-3 py-2 font-mono text-xs"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-neutral-200">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) =>
                setForm((p) => (p ? { ...p, notes: e.target.value } : p))
              }
              rows={2}
              className="rounded-lg border border-neutral-700 px-3 py-2 text-sm"
            />
          </label>

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
