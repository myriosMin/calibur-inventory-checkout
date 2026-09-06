"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";

type Product = Database["public"]["Tables"]["products"]["Row"];
type Location = Database["public"]["Tables"]["locations"]["Row"];
type Tier = Database["public"]["Tables"]["products"]["Row"]["tier"];

const TIERS: Tier[] = ["asset", "bulk", "loose"];

const EMPTY_FORM = {
  name: "",
  tier: "loose" as Tier,
  category: "",
  location_id: "",
  returnable: false,
  unit: "pcs",
  part_number: "",
  spec: "",
  min_stock: "",
  notes: "",
  active: true,
};

type FormState = typeof EMPTY_FORM;

/**
 * Admin product list + create form. Everything here goes through the anon
 * `getBrowserClient()` -- Postgres RLS's `is_admin()` policy is the only
 * thing standing between an unauthenticated visitor and these mutations, so
 * every insert/update below surfaces its error rather than assuming success.
 */
export default function AdminProductsPage() {
  const supabase = useMemo(() => getBrowserClient(), []);

  const [products, setProducts] = useState<Product[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [newLocationName, setNewLocationName] = useState("");
  const [creatingLocation, setCreatingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);

  async function loadProducts() {
    const { data, error } = await supabase
      .from("products")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    setProducts(data ?? []);
  }

  async function loadLocations() {
    const { data, error } = await supabase
      .from("locations")
      .select("*")
      .order("name", { ascending: true });
    if (error) throw error;
    setLocations(data ?? []);
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        await Promise.all([loadProducts(), loadLocations()]);
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
  }, []);

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
      setForm((prev) => ({ ...prev, location_id: data.id }));
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
    setFormError(null);
    setSuccessMessage(null);

    const name = form.name.trim();
    if (!name) {
      setFormError("Name is required.");
      return;
    }

    let spec: unknown = null;
    const trimmedSpec = form.spec.trim();
    if (trimmedSpec) {
      try {
        spec = JSON.parse(trimmedSpec);
      } catch {
        setFormError("Spec must be valid JSON (or left empty).");
        return;
      }
    }

    let minStock: number | null = null;
    if (form.min_stock.trim()) {
      const parsed = Number(form.min_stock);
      if (!Number.isFinite(parsed)) {
        setFormError("Min stock must be a number.");
        return;
      }
      minStock = parsed;
    }

    setSubmitting(true);
    try {
      const { data, error } = await supabase
        .from("products")
        .insert({
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
        .select()
        .single();

      if (error) throw error;

      setProducts((prev) => [data, ...prev]);
      setForm(EMPTY_FORM);
      setSuccessMessage(`Created "${data.name}".`);
    } catch (err) {
      setFormError(
        err instanceof Error ? err.message : "Failed to create product.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  const locationName = (id: string | null) =>
    id ? (locations.find((l) => l.id === id)?.name ?? id) : "—";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Products</h1>
        <p className="text-sm text-gray-500">
          Create and manage the catalog. Changes take effect immediately for
          the Mini App.
        </p>
      </div>

      <section className="rounded-xl border border-gray-200 bg-white p-4">
        <h2 className="mb-4 text-sm font-semibold text-gray-900">
          New product
        </h2>

        {formError ? (
          <div className="mb-4">
            <Toast variant="error" message={formError} onDismiss={() => setFormError(null)} />
          </div>
        ) : null}
        {successMessage ? (
          <div className="mb-4">
            <Toast
              variant="success"
              message={successMessage}
              onDismiss={() => setSuccessMessage(null)}
            />
          </div>
        ) : null}

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Name *</span>
            <input
              required
              value={form.name}
              onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Tier *</span>
            <select
              value={form.tier}
              onChange={(e) =>
                setForm((p) => ({ ...p, tier: e.target.value as Tier }))
              }
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {TIERS.map((tier) => (
                <option key={tier} value={tier}>
                  {tier}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Category</span>
            <input
              value={form.category}
              onChange={(e) =>
                setForm((p) => ({ ...p, category: e.target.value }))
              }
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Location</span>
            <select
              value={form.location_id}
              onChange={(e) =>
                setForm((p) => ({ ...p, location_id: e.target.value }))
              }
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
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
                className="min-w-0 flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs"
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
              <span className="text-xs text-red-600">{locationError}</span>
            ) : null}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Unit</span>
            <input
              value={form.unit}
              onChange={(e) => setForm((p) => ({ ...p, unit: e.target.value }))}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Part number</span>
            <input
              value={form.part_number}
              onChange={(e) =>
                setForm((p) => ({ ...p, part_number: e.target.value }))
              }
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-gray-700">Min stock</span>
            <input
              type="number"
              value={form.min_stock}
              onChange={(e) =>
                setForm((p) => ({ ...p, min_stock: e.target.value }))
              }
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="flex items-center gap-4 pt-6">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.returnable}
                onChange={(e) =>
                  setForm((p) => ({ ...p, returnable: e.target.checked }))
                }
              />
              Returnable
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.active}
                onChange={(e) =>
                  setForm((p) => ({ ...p, active: e.target.checked }))
                }
              />
              Active
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-gray-700">
              Spec (JSON, optional)
            </span>
            <textarea
              value={form.spec}
              onChange={(e) => setForm((p) => ({ ...p, spec: e.target.value }))}
              rows={3}
              placeholder='{"value": "10k", "package": "0805"}'
              className="rounded-lg border border-gray-300 px-3 py-2 font-mono text-xs"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-gray-700">Notes</span>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))}
              rows={2}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="sm:col-span-2">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Creating…" : "Create product"}
            </Button>
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-200 px-4 py-3">
          <h2 className="text-sm font-semibold text-gray-900">
            All products ({products.length})
          </h2>
        </div>

        {loading ? (
          <p className="p-4 text-sm text-gray-500">Loading…</p>
        ) : loadError ? (
          <div className="p-4">
            <Toast variant="error" message={loadError} />
          </div>
        ) : products.length === 0 ? (
          <p className="p-4 text-sm text-gray-500">No products yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Name</th>
                  <th className="px-4 py-2 font-medium">Tier</th>
                  <th className="px-4 py-2 font-medium">Category</th>
                  <th className="px-4 py-2 font-medium">Location</th>
                  <th className="px-4 py-2 font-medium">Active</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {products.map((product) => (
                  <tr key={product.id}>
                    <td className="px-4 py-2 font-medium text-gray-900">
                      {product.name}
                    </td>
                    <td className="px-4 py-2 text-gray-600">{product.tier}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {product.category ?? "—"}
                    </td>
                    <td className="px-4 py-2 text-gray-600">
                      {locationName(product.location_id)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          product.active
                            ? "bg-green-100 text-green-800"
                            : "bg-gray-100 text-gray-500"
                        }`}
                      >
                        {product.active ? "active" : "inactive"}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Link
                        href={`/admin/products/${product.id}`}
                        className="text-sm font-medium text-blue-700 hover:text-blue-900"
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
      </section>
    </div>
  );
}
