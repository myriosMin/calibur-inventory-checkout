"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import Drawer from "@/components/admin/Drawer";
import FilterMenu from "@/components/admin/FilterMenu";
import { FILTER, CAPTION, LABEL } from "@/components/admin/form";
import PageHeader from "@/components/admin/PageHeader";
import Segmented from "@/components/admin/Segmented";
import { TableSkeleton } from "@/components/admin/Skeleton";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { IconPlus, IconSearch } from "@/components/ui/icons";
import Toast from "@/components/ui/Toast";
import {
  KEYS,
  revalidate,
  upsertCached,
  useLocations,
  useProducts,
  useReviewItems,
  useStockLevels,
} from "@/lib/admin/queries";
import { EXPENSIVE_RULE_TEXT } from "@/lib/expensive";
import { getBrowserClient } from "@/lib/supabase/browser";

import ProductFormFields from "./ProductFormFields";
import { CRITICALITIES, EMPTY_PRODUCT_FORM, formToRow, type ProductFormState } from "./product-form";
import {
  DEFAULT_PRODUCT_FILTERS,
  distinctCategories,
  filterProducts,
  rowNeedsPrice,
  stockBucket,
  type ExpenseFilter,
  type ProductListFilters,
  type ProductListRow,
  type StockFilter,
} from "./product-list";

/**
 * The catalog, as the reviewers and procurement see it: what exists, how
 * much is in the store and out, and whether anything about it is still
 * waiting in the review queue. Everything goes through the anon browser
 * client -- RLS (is_admin / is_staff) is the only boundary.
 */
export default function AdminProductsPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <Products />
    </Suspense>
  );
}

const STOCK_PARAM: Record<string, StockFilter> = { low: "low", empty: "empty", negative: "negative" };
const EXPENSE_PARAM: Record<string, ExpenseFilter> = { expensive: "expensive", needs_price: "needs_price" };

function Products() {
  const params = useSearchParams();
  const productsQ = useProducts();
  const levelsQ = useStockLevels();
  const reviewsQ = useReviewItems();
  const locationsQ = useLocations();

  const [filters, setFilters] = useState<ProductListFilters>(() => ({
    ...DEFAULT_PRODUCT_FILTERS,
    // The dashboard's "Low stock" tile links here as ?stock=low.
    stock: STOCK_PARAM[params.get("stock") ?? ""] ?? "all",
    // ...and the expensive-item tiles as ?expense=expensive / needs_price.
    expense: EXPENSE_PARAM[params.get("expense") ?? ""] ?? "all",
  }));
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<ProductFormState>(EMPTY_PRODUCT_FORM);
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  const loading = productsQ.isLoading || levelsQ.isLoading;
  const loadError = ((productsQ.error ?? levelsQ.error ?? reviewsQ.error ?? locationsQ.error) as Error | undefined)?.message;
  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);

  const rows = useMemo<ProductListRow[]>(() => {
    const stock = new Map((levelsQ.data ?? []).map((level) => [level.productId, level]));
    const openReviews = new Map<string, number>();
    for (const review of reviewsQ.data ?? []) {
      if (review.status === "open" && review.product_id) {
        openReviews.set(review.product_id, (openReviews.get(review.product_id) ?? 0) + 1);
      }
    }
    return (productsQ.data ?? []).map((product) => ({
      ...product,
      qtyInStore: stock.get(product.id)?.qtyInStore ?? null,
      qtyOut: stock.get(product.id)?.qtyOut ?? null,
      openReviews: openReviews.get(product.id) ?? 0,
    }));
  }, [productsQ.data, levelsQ.data, reviewsQ.data]);

  const locationName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations]);
  const categories = useMemo(() => distinctCategories(rows), [rows]);
  const visible = useMemo(() => filterProducts(rows, filters), [rows, filters]);

  const bucketCounts = useMemo(() => {
    const counts = { low: 0, empty: 0, negative: 0, review: 0, expensive: 0, needsPrice: 0 };
    for (const row of rows) {
      const bucket = stockBucket(row);
      if (bucket !== "ok") counts[bucket] += 1;
      if (row.openReviews > 0) counts.review += 1;
      if (row.expensive === true) counts.expensive += 1;
      if (rowNeedsPrice(row)) counts.needsPrice += 1;
    }
    return counts;
  }, [rows]);

  // The chips combine the stock buckets, "needs review" and the expensive
  // filters (0028) into one control: one chip at a time.
  type Chip = StockFilter | "review" | "expensive" | "needs_price";
  const chip: Chip = filters.onlyNeedsReview
    ? "review"
    : filters.expense === "expensive" || filters.expense === "needs_price"
      ? filters.expense
      : filters.stock;
  const setChip = (value: Chip) =>
    setFilters((f) => ({
      ...f,
      onlyNeedsReview: value === "review",
      expense: value === "expensive" || value === "needs_price" ? value : "all",
      stock: value === "review" || value === "expensive" || value === "needs_price" ? "all" : value,
    }));

  const moreFilters =
    (filters.category ? 1 : 0) + (filters.criticality !== "all" ? 1 : 0) + (filters.status !== "all" ? 1 : 0);

  function closeForm() {
    setFormOpen(false);
    setFormError(null);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const result = formToRow(form);
    if (!result.ok) {
      setFormError(result.error);
      return;
    }
    setCreating(true);
    setFormError(null);
    const { data, error } = await getBrowserClient().from("products").insert(result.row).select("id, name").single();
    setCreating(false);
    if (error) {
      setFormError(error.message);
      return;
    }
    setForm(EMPTY_PRODUCT_FORM);
    closeForm();
    setToast({
      variant: "success",
      message: `Created "${data.name}". It starts with no stock: receive it on Restock.`,
    });
    await revalidate(KEYS.products);
  }

  const columns: Column<ProductListRow>[] = [
    {
      key: "name",
      header: "Product",
      render: (row) => (
        <span className="block min-w-48">
          <span className="font-medium text-neutral-100">{row.name}</span>
          <span className="block text-xs text-neutral-500">
            {[row.part_number, row.location_id ? locationName.get(row.location_id) : null].filter(Boolean).join(" · ") ||
              " "}
          </span>
        </span>
      ),
    },
    { key: "category", header: "Category", render: (row) => <span className="text-neutral-400">{row.category ?? "—"}</span> },
    {
      key: "store",
      header: "In store",
      className: "text-right tabular-nums",
      render: (row) => {
        const bucket = stockBucket(row);
        if (row.qtyInStore === null) return <span className="text-neutral-600">—</span>;
        if (bucket === "negative") return <StatusPill tone="danger">{row.qtyInStore}</StatusPill>;
        if (row.tier === "loose" && row.qtyInStore === 0) return <span className="text-neutral-500">level</span>;
        return (
          <span className={bucket === "low" ? "text-amber-400" : bucket === "empty" ? "text-neutral-500" : "text-neutral-100"}>
            {row.qtyInStore}
            {row.min_stock !== null ? <span className="text-xs text-neutral-500"> / {row.min_stock}</span> : null}
          </span>
        );
      },
    },
    {
      key: "cost",
      header: "Unit cost",
      className: "text-right tabular-nums whitespace-nowrap",
      render: (row) =>
        row.unit_cost_sgd !== null ? (
          <span className={row.expensive === true ? "text-amber-300" : "text-neutral-400"}>S${row.unit_cost_sgd.toFixed(2)}</span>
        ) : (
          <span className="text-neutral-600">—</span>
        ),
    },
    {
      key: "out",
      header: "Out",
      className: "text-right tabular-nums",
      render: (row) => (row.qtyOut ? row.qtyOut : <span className="text-neutral-600">—</span>),
    },
    {
      key: "flags",
      header: "",
      className: "text-right",
      render: (row) => (
        <span className="flex flex-wrap justify-end gap-1">
          {row.openReviews > 0 ? <StatusPill tone="warning">{row.openReviews} to review</StatusPill> : null}
          {row.expensive === true ? <StatusPill tone="warning">expensive</StatusPill> : null}
          {row.criticality === "critical" ? <StatusPill tone="danger">critical</StatusPill> : null}
          {row.ownership !== "owned" ? (
            <StatusPill tone="warning">{row.ownership === "on_loan" ? "on loan" : "part on loan"}</StatusPill>
          ) : null}
          {!row.active ? <StatusPill tone="inactive">inactive</StatusPill> : null}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Products"
        description={loading ? "The catalog." : `${rows.length} products in the catalog.`}
        info={
          <>
            <p>
              Open a product to fix its details, see where every unit is, and work through its review items. Quantities
              are corrected by counting in Stocktake, never typed over.
            </p>
            <p>Expensive: {EXPENSIVE_RULE_TEXT} &quot;Needs a price&quot; is reusable kit with no price yet.</p>
          </>
        }
        actions={
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <IconPlus size={16} />
            New product
          </Button>
        }
      />

      {toast ? <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} /> : null}

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented<Chip>
          ariaLabel="Stock health"
          value={chip}
          onChange={setChip}
          options={[
            { value: "all", label: "All", count: rows.length },
            { value: "low", label: "Low", count: bucketCounts.low, tone: "warning" },
            { value: "empty", label: "Empty", count: bucketCounts.empty },
            { value: "negative", label: "Negative", count: bucketCounts.negative, tone: "danger" },
            { value: "review", label: "Needs review", count: bucketCounts.review, tone: "warning" },
            { value: "expensive", label: "Expensive", count: bucketCounts.expensive },
            { value: "needs_price", label: "Needs a price", count: bucketCounts.needsPrice, tone: "warning" },
          ]}
        />
        <div className="flex items-center gap-2">
          <label className="relative block">
            <span className="sr-only">Search products</span>
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="search"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              placeholder="Name, part number, supplier…"
              className={`${FILTER} w-full pl-9 sm:w-64`}
            />
          </label>
          <FilterMenu
            activeCount={moreFilters}
            onReset={() => setFilters((f) => ({ ...f, category: "", criticality: "all", status: "all" }))}
          >
            <label className={LABEL}>
              <span className={CAPTION}>Category</span>
              <select
                value={filters.category}
                onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
                className={FILTER}
              >
                <option value="">All categories</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              <span className={CAPTION}>Criticality</span>
              <select
                value={filters.criticality}
                onChange={(e) =>
                  setFilters((f) => ({ ...f, criticality: e.target.value as ProductListFilters["criticality"] }))
                }
                className={FILTER}
              >
                <option value="all">Any</option>
                {CRITICALITIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className={LABEL}>
              <span className={CAPTION}>Status</span>
              <select
                value={filters.status}
                onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as ProductListFilters["status"] }))}
                className={FILTER}
              >
                <option value="all">Active and inactive</option>
                <option value="active">Active only</option>
                <option value="inactive">Inactive only</option>
              </select>
            </label>
          </FilterMenu>
        </div>
      </div>

      <Card padded={false}>
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(row) => row.id}
          rowHref={(row) => `/admin/products/${row.id}`}
          loading={loading}
          error={loadError}
          emptyMessage={rows.length === 0 ? "No products yet." : "Nothing matches these filters."}
        />
      </Card>

      <Drawer
        open={formOpen}
        onClose={closeForm}
        title="New product"
        description="It starts with no stock. Receive it on Restock afterwards."
        size="lg"
        footer={
          <>
            <Button type="submit" form="new-product" size="sm" disabled={creating}>
              {creating ? "Creating…" : "Create product"}
            </Button>
            <Button variant="ghost" size="sm" onClick={closeForm}>
              Cancel
            </Button>
            {formError ? <p className="text-sm text-red-400">{formError}</p> : null}
          </>
        }
      >
        <form id="new-product" onSubmit={handleCreate}>
          <ProductFormFields
            form={form}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            locations={locations}
            onLocationCreated={(location) => void upsertCached(KEYS.locations, location)}
            categories={categories}
          />
        </form>
      </Drawer>
    </div>
  );
}
