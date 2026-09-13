"use client";

import Link from "next/link";
import { use, useEffect, useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import PageHeader from "@/components/admin/PageHeader";
import ReviewItemList, { type ReviewItem } from "@/components/admin/ReviewItemList";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { getBrowserClient } from "@/lib/supabase/browser";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import type { Database } from "@/lib/types/database";

import ProductFormFields, { type LocationOption } from "../ProductFormFields";
import { formToRow, productToForm, type ProductFormState } from "../product-form";
import { distinctCategories } from "../product-list";

import HoldingsPanel from "./HoldingsPanel";
import UnitsPanel from "./UnitsPanel";

type Product = Database["public"]["Tables"]["products"]["Row"];

/**
 * One product, laid out for a reviewer: what is still open about it, where
 * it is, its details, and its individual units. Every write goes through the
 * anon browser client; RLS (is_admin / is_staff) decides.
 */
export default function AdminProductEditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const supabase = useMemo(() => getBrowserClient(), []);

  const [product, setProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormState | null>(null);
  const [locations, setLocations] = useState<LocationOption[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [reviews, setReviews] = useState<ReviewItem[]>([]);
  const [showClosedReviews, setShowClosedReviews] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ variant: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [productRes, locationsRes, allCategories, reviewRows] = await Promise.all([
          supabase.from("products").select("*").eq("id", id).single(),
          supabase.from("locations").select("id, name").order("name"),
          fetchAllRows((from, to) => supabase.from("products").select("category").order("id").range(from, to)),
          fetchAllRows((from, to) =>
            supabase.from("review_items").select("*").eq("product_id", id).order("id").range(from, to),
          ),
        ]);
        if (productRes.error) throw new Error(productRes.error.message);
        if (locationsRes.error) throw new Error(locationsRes.error.message);
        if (cancelled) return;
        setProduct(productRes.data);
        setForm(productToForm(productRes.data));
        setLocations(locationsRes.data ?? []);
        setCategories(distinctCategories(allCategories));
        setReviews(reviewRows);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const result = formToRow(form);
    if (!result.ok) {
      setToast({ variant: "error", message: result.error });
      return;
    }
    setSaving(true);
    const { data, error } = await supabase.from("products").update(result.row).eq("id", id).select().single();
    setSaving(false);
    if (error) {
      setToast({ variant: "error", message: error.message });
      return;
    }
    setProduct(data);
    setForm(productToForm(data));
    setToast({ variant: "success", message: "Saved." });
  }

  if (loading) return <p className="text-sm text-neutral-400">Loading…</p>;

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

  const openReviews = reviews.filter((r) => r.status === "open");
  const shownReviews = showClosedReviews ? reviews : openReviews;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/products" className="text-sm font-medium text-red-400">
          &larr; Back to products
        </Link>
        <PageHeader
          className="mt-1"
          title={product.name}
          description={[product.category ?? "Uncategorised", product.part_number].filter(Boolean).join(" · ")}
          actions={
            <div className="flex flex-wrap gap-2">
              {product.criticality === "critical" ? <StatusPill tone="danger">critical</StatusPill> : null}
              {product.ownership !== "owned" ? (
                <StatusPill tone="warning">on loan{product.loaned_from ? ` · ${product.loaned_from}` : ""}</StatusPill>
              ) : null}
              <StatusPill tone={product.active ? "active" : "inactive"}>{product.active ? "active" : "inactive"}</StatusPill>
            </div>
          }
        />
      </div>

      {toast ? <Toast variant={toast.variant} message={toast.message} onDismiss={() => setToast(null)} /> : null}

      {reviews.length > 0 ? (
        <Card
          title={openReviews.length > 0 ? `Needs review (${openReviews.length} open)` : "Review items (all closed)"}
          actions={
            reviews.length > openReviews.length ? (
              <Button
                variant="ghost"
                onClick={() => setShowClosedReviews((v) => !v)}
                className="min-h-0 px-2 py-1 text-xs"
              >
                {showClosedReviews ? "Hide closed" : `Show ${reviews.length - openReviews.length} closed`}
              </Button>
            ) : undefined
          }
          padded={false}
        >
          {shownReviews.length > 0 ? (
            <ReviewItemList
              items={shownReviews}
              onUpdated={(updated) => setReviews((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))}
            />
          ) : (
            <p className="p-4 text-sm text-neutral-400">All review items for this product are closed.</p>
          )}
        </Card>
      ) : null}

      <Card title="Where it is" padded={false}>
        <HoldingsPanel productId={product.id} unit={product.unit} />
      </Card>

      <Card title="Details">
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <ProductFormFields
            form={form}
            onChange={(patch) => setForm((prev) => (prev ? { ...prev, ...patch } : prev))}
            locations={locations}
            onLocationCreated={(loc) => setLocations((prev) => [...prev, loc].sort((a, b) => a.name.localeCompare(b.name)))}
            categories={categories}
          />
          <div>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save changes"}
            </Button>
          </div>
        </form>
      </Card>

      <Card title="Individual units" padded={false}>
        <UnitsPanel productId={product.id} />
      </Card>
    </div>
  );
}
