"use client";

import Link from "next/link";
import { use, useMemo, useState } from "react";
import useSWR from "swr";

import Card from "@/components/admin/Card";
import Drawer from "@/components/admin/Drawer";
import PageHeader from "@/components/admin/PageHeader";
import ReviewItemList, { type ReviewItem } from "@/components/admin/ReviewItemList";
import Skeleton from "@/components/admin/Skeleton";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { KEYS, revalidate, upsertCached, useLocations, useProducts, useReviewItems } from "@/lib/admin/queries";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";

import ProductFormFields from "../ProductFormFields";
import { CRITICALITY_HELP, OWNERSHIP_LABELS, formToRow, productToForm, type Criticality, type Ownership, type ProductFormState } from "../product-form";
import { distinctCategories } from "../product-list";

import HoldingsPanel from "./HoldingsPanel";
import UnitsPanel from "./UnitsPanel";

type Product = Database["public"]["Tables"]["products"]["Row"];

/**
 * One product, laid out for a reviewer: where it is and its units on the
 * left, its details and anything still open about it on the right. Details
 * are read-only until "Edit" opens them in a drawer.
 *
 * The product comes from the shared products cache when the list was
 * visited first (no request at all), else one row by id. Every write goes
 * through the anon browser client; RLS (is_admin / is_staff) decides.
 */
export default function AdminProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const productsQ = useProducts();
  const locationsQ = useLocations();
  const reviewsQ = useReviewItems();

  const cached = productsQ.data?.find((p) => p.id === id);
  const directQ = useSWR(cached ? null : ["admin/product", id], async () => {
    const { data, error } = await getBrowserClient().from("products").select("*").eq("id", id).single();
    if (error) throw new Error(error.message);
    return data;
  });
  const product: Product | undefined = cached ?? directQ.data;

  const [form, setForm] = useState<ProductFormState | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showClosed, setShowClosed] = useState(false);
  const [toast, setToast] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  const categories = useMemo(() => distinctCategories(productsQ.data ?? []), [productsQ.data]);
  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);
  const reviews = useMemo(() => (reviewsQ.data ?? []).filter((r) => r.product_id === id), [reviewsQ.data, id]);

  if (!product) {
    const error = (directQ.error ?? productsQ.error) as Error | undefined;
    if (error || (!directQ.isLoading && !productsQ.isLoading)) {
      return (
        <div className="space-y-4">
          <Toast variant="error" message={error?.message ?? "Product not found."} />
          <Link href="/admin/products" className="text-sm text-neutral-400 hover:text-neutral-100">
            ← Back to products
          </Link>
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const result = formToRow(form);
    if (!result.ok) {
      setSaveError(result.error);
      return;
    }
    setSaving(true);
    setSaveError(null);
    const { data, error } = await getBrowserClient().from("products").update(result.row).eq("id", id).select().single();
    setSaving(false);
    if (error) {
      setSaveError(error.message);
      return;
    }
    await upsertCached(KEYS.products, data);
    if (!cached) await directQ.mutate(data, { revalidate: false });
    setForm(null);
    setToast({ variant: "success", message: "Saved." });
  }

  const openReviews = reviews.filter((r) => r.status === "open");
  const shownReviews = showClosed ? reviews : openReviews;
  const locationName = product.location_id ? locations.find((l) => l.id === product.location_id)?.name : null;

  const details: [string, React.ReactNode][] = [
    ["Category", product.category],
    ["Location", locationName],
    ["Tier", product.tier],
    [
      "Criticality",
      <span key="c" title={CRITICALITY_HELP[product.criticality as Criticality]}>
        {product.criticality}
      </span>,
    ],
    ["Ownership", OWNERSHIP_LABELS[product.ownership as Ownership] ?? product.ownership],
    ["On loan from", product.ownership !== "owned" ? product.loaned_from : null],
    ["Due back", product.ownership !== "owned" ? product.loan_due : null],
    ["Unit", product.unit],
    ["Min stock", product.min_stock],
    ["Returnable", product.returnable ? "Yes" : "No"],
    ["Part number", product.part_number],
    ["Supplier", product.supplier],
    ["Unit cost", product.unit_cost_sgd !== null ? `S$${product.unit_cost_sgd.toFixed(2)}` : null],
  ];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/products" className="text-sm text-neutral-500 hover:text-neutral-200">
          ← Products
        </Link>
        <PageHeader
          className="mt-2"
          title={product.name}
          description={[product.category ?? "Uncategorised", product.part_number].filter(Boolean).join(" · ")}
          actions={
            <>
              {product.criticality === "critical" ? <StatusPill tone="danger">critical</StatusPill> : null}
              {product.ownership !== "owned" ? <StatusPill tone="warning">on loan</StatusPill> : null}
              {!product.active ? <StatusPill tone="inactive">inactive</StatusPill> : null}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  setSaveError(null);
                  setForm(productToForm(product));
                }}
              >
                Edit details
              </Button>
            </>
          }
        />
      </div>

      {toast ? <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} /> : null}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card title="Where it is">
            <HoldingsPanel productId={product.id} unit={product.unit} />
          </Card>
          <Card title="Individual units" padded={false}>
            <UnitsPanel productId={product.id} />
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {reviews.length > 0 ? (
            <Card
              title={openReviews.length > 0 ? `To review (${openReviews.length})` : "Review items"}
              subtitle={openReviews.length === 0 ? "All closed" : undefined}
              actions={
                reviews.length > openReviews.length ? (
                  <button
                    type="button"
                    onClick={() => setShowClosed((v) => !v)}
                    className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-200"
                  >
                    {showClosed ? "Hide closed" : `Show ${reviews.length - openReviews.length} closed`}
                  </button>
                ) : undefined
              }
              padded={false}
            >
              {shownReviews.length > 0 ? (
                <ReviewItemList
                  items={shownReviews}
                  expandAll={shownReviews.length <= 2}
                  onUpdated={(updated: ReviewItem) => {
                    void upsertCached(KEYS.reviewItems, updated);
                    void revalidate(KEYS.badges);
                  }}
                />
              ) : null}
            </Card>
          ) : null}

          <Card title="Details">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              {details
                .filter(([, value]) => value !== null && value !== undefined && value !== "")
                .map(([label, value]) => (
                  <div key={label} className="contents">
                    <dt className="text-neutral-500">{label}</dt>
                    <dd className="min-w-0 wrap-break-word text-neutral-200">{value}</dd>
                  </div>
                ))}
            </dl>
            {product.notes ? (
              <p className="mt-4 whitespace-pre-line border-t border-neutral-800 pt-3 text-sm text-neutral-400">{product.notes}</p>
            ) : null}
          </Card>
        </div>
      </div>

      <Drawer
        open={form !== null}
        onClose={() => setForm(null)}
        title="Edit details"
        description={product.name}
        size="lg"
        footer={
          <>
            <Button type="submit" form="edit-product" size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setForm(null)}>
              Cancel
            </Button>
            {saveError ? <p className="text-sm text-red-400">{saveError}</p> : null}
          </>
        }
      >
        {form ? (
          <form id="edit-product" onSubmit={handleSubmit}>
            <ProductFormFields
              form={form}
              onChange={(patch) => setForm((prev) => (prev ? { ...prev, ...patch } : prev))}
              locations={locations}
              onLocationCreated={(location) => void upsertCached(KEYS.locations, location)}
              categories={categories}
            />
          </form>
        ) : null}
      </Drawer>
    </div>
  );
}
