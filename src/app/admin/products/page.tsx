"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import PageHeader from "@/components/admin/PageHeader";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { getBrowserClient } from "@/lib/supabase/browser";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

import ProductFormFields, { type LocationOption } from "./ProductFormFields";
import { CRITICALITIES, EMPTY_PRODUCT_FORM, formToRow, type ProductFormState } from "./product-form";
import {
  DEFAULT_PRODUCT_FILTERS,
  distinctCategories,
  filterProducts,
  type ProductListFilters,
  type ProductListRow,
} from "./product-list";

const INPUT = "min-h-11 rounded-lg border border-neutral-700 px-3 text-sm";

/**
 * The catalog, as the reviewers and procurement see it: what exists, how
 * critical it is, how many are in the store and out, and whether anything
 * about it is still waiting in the review queue. Everything goes through the
 * anon browser client -- RLS (is_admin / is_staff) is the only boundary.
 */
export default function AdminProductsPage() {
  const supabase = useMemo(() => getBrowserClient(), []);

  const [rows, setRows] = useState<ProductListRow[]>([]);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ProductListFilters>(DEFAULT_PRODUCT_FILTERS);

  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  async function loadAll() {
    setLoading(true);
    setLoadError(null);
    try {
      const [products, summaries, reviews, locationsRes] = await Promise.all([
        fetchAllRows((from, to) => supabase.from("products").select("*").order("name").order("id").range(from, to)),
        fetchAllRows((from, to) =>
          supabase.from("stock_summary").select("product_id, qty_in_store, qty_out").order("product_id").range(from, to),
        ),
        fetchAllRows((from, to) =>
          supabase
            .from("review_items")
            .select("id, product_id")
            .eq("status", "open")
            .not("product_id", "is", null)
            .order("id")
            .range(from, to),
        ),
        supabase.from("locations").select("id, name").order("name"),
      ]);
      if (locationsRes.error) throw new Error(locationsRes.error.message);

      const stock = new Map(summaries.map((s) => [s.product_id, s]));
      const openReviews = new Map<string, number>();
      for (const review of reviews) {
        if (review.product_id) openReviews.set(review.product_id, (openReviews.get(review.product_id) ?? 0) + 1);
      }
      setRows(
        products.map((product) => ({
          ...product,
          qtyInStore: stock.get(product.id)?.qty_in_store ?? null,
          qtyOut: stock.get(product.id)?.qty_out ?? null,
          openReviews: openReviews.get(product.id) ?? 0,
        })),
      );
      setLocations(locationsRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadAll();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const categories = useMemo(() => distinctCategories(rows), [rows]);
  const visible = useMemo(() => filterProducts(rows, filters), [rows, filters]);
  const locationName = (id: string | null) => (id ? (locations.find((l) => l.id === id)?.name ?? "—") : "—");
  const needsReviewCount = rows.filter((r) => r.openReviews > 0).length;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const result = formToRow(form);
    if (!result.ok) {
      setToast({ variant: "error", message: result.error });
      return;
    }
    setCreating(true);
    const { data, error } = await supabase.from("products").insert(result.row).select("id, name").single();
    setCreating(false);
    if (error) {
      setToast({ variant: "error", message: error.message });
      return;
    }
    setForm(EMPTY_PRODUCT_FORM);
    setFormOpen(false);
    setToast({
      variant: "success",
      message: `Created "${data.name}". It starts with no stock: receive it on the Restock page.`,
    });
    await loadAll();
  }

  const columns: Column<ProductListRow>[] = [
    {
      key: "name",
      header: "Name",
      render: (row) => (
        <Link href={`/admin/products/${row.id}`} className="block min-w-48 hover:text-red-300">
          <span className="font-medium text-neutral-100">{row.name}</span>
          <span className="block text-xs text-neutral-400">
            {[row.part_number, locationName(row.location_id)].filter((v) => v && v !== "—").join(" · ") || " "}
          </span>
        </Link>
      ),
    },
    { key: "category", header: "Category", render: (row) => row.category ?? "—" },
    {
      key: "criticality",
      header: "Criticality",
      render: (row) =>
        row.criticality === "critical" ? <StatusPill tone="danger">critical</StatusPill> : row.criticality,
    },
    {
      key: "ownership",
      header: "Owner",
      render: (row) =>
        row.ownership === "owned" ? (
          "club"
        ) : (
          <StatusPill tone="warning">{row.ownership === "on_loan" ? "on loan" : "some on loan"}</StatusPill>
        ),
    },
    {
      key: "store",
      header: "In store",
      className: "text-right tabular-nums",
      render: (row) =>
        row.qtyInStore === null ? (
          "—"
        ) : row.qtyInStore < 0 ? (
          <StatusPill tone="danger">{row.qtyInStore}</StatusPill>
        ) : row.tier === "loose" && row.qtyInStore === 0 ? (
          "level"
        ) : (
          row.qtyInStore
        ),
    },
    { key: "out", header: "Out", className: "text-right tabular-nums", render: (row) => row.qtyOut ?? "—" },
    {
      key: "review",
      header: "Review",
      render: (row) => (row.openReviews > 0 ? <StatusPill tone="warning">{row.openReviews} open</StatusPill> : "—"),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => <StatusPill tone={row.active ? "active" : "inactive"}>{row.active ? "active" : "inactive"}</StatusPill>,
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Products"
        description="The catalog. Open a product to fix its details, see where every unit is, and work through its review items. Quantities are corrected in Stocktake, never typed over."
        actions={
          <Button onClick={() => setFormOpen((open) => !open)} variant={formOpen ? "ghost" : undefined}>
            {formOpen ? "Close" : "New product"}
          </Button>
        }
      />

      {toast ? <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} /> : null}

      {formOpen ? (
        <Card title="New product">
          <form onSubmit={handleCreate} className="flex flex-col gap-4">
            <ProductFormFields
              form={form}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
              locations={locations}
              onLocationCreated={(loc) =>
                setLocations((prev) => [...prev, loc].sort((a, b) => a.name.localeCompare(b.name)))
              }
              categories={categories}
            />
            <div>
              <Button type="submit" disabled={creating}>
                {creating ? "Creating…" : "Create product"}
              </Button>
            </div>
          </form>
        </Card>
      ) : null}

      <Card>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="search"
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            placeholder="Search name, part number, supplier…"
            className={`${INPUT} sm:col-span-2`}
          />
          <select
            value={filters.category}
            onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
            className={INPUT}
            aria-label="Category"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filters.criticality}
            onChange={(e) => setFilters((f) => ({ ...f, criticality: e.target.value as ProductListFilters["criticality"] }))}
            className={INPUT}
            aria-label="Criticality"
          >
            <option value="all">Any criticality</option>
            {CRITICALITIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as ProductListFilters["status"] }))}
            className={INPUT}
            aria-label="Status"
          >
            <option value="all">Active and inactive</option>
            <option value="active">Active only</option>
            <option value="inactive">Inactive only</option>
          </select>
          <label className="flex min-h-11 items-center gap-2 text-sm text-neutral-200">
            <input
              type="checkbox"
              checked={filters.onlyNeedsReview}
              onChange={(e) => setFilters((f) => ({ ...f, onlyNeedsReview: e.target.checked }))}
            />
            Needs review ({needsReviewCount})
          </label>
        </div>
      </Card>

      <Card title={`Showing ${visible.length} of ${rows.length}`} padded={false}>
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          loading={loading}
          error={loadError}
          emptyMessage={rows.length === 0 ? "No products yet." : "Nothing matches these filters."}
        />
      </Card>
    </div>
  );
}
