"use client";

import { useEffect, useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import EmptyState from "@/components/admin/EmptyState";
import PageHeader from "@/components/admin/PageHeader";
import ReviewItemList, { type ReviewItem } from "@/components/admin/ReviewItemList";
import StatusPill from "@/components/admin/StatusPill";
import { getBrowserClient } from "@/lib/supabase/browser";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

import { DEFAULT_REVIEW_FILTERS, filterReviewItems, openCountsBySeverity, type ReviewFilters } from "./review-filters";

const INPUT = "min-h-11 rounded-lg border border-neutral-700 px-3 text-sm";

/**
 * The review queue: everything the catalog clean-up could not decide on its
 * own (docs/data-cleaning.md). The job is to fix the product -- or count it
 * in Stocktake -- and then close the item with a note saying what was found.
 */
export default function AdminReviewPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [productNames, setProductNames] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ReviewFilters>(DEFAULT_REVIEW_FILTERS);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getBrowserClient();
      try {
        const [reviewRows, products] = await Promise.all([
          fetchAllRows((from, to) => supabase.from("review_items").select("*").order("id").range(from, to)),
          fetchAllRows((from, to) => supabase.from("products").select("id, name").order("id").range(from, to)),
        ]);
        if (cancelled) return;
        setItems(reviewRows);
        setProductNames(new Map(products.map((p) => [p.id, p.name])));
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "Failed to load.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const counts = useMemo(() => openCountsBySeverity(items), [items]);
  const entities = useMemo(() => [...new Set(items.map((i) => i.entity))].sort(), [items]);
  const visible = useMemo(() => filterReviewItems(items, filters), [items, filters]);
  const openTotal = counts.blocker + counts.check + counts.info;

  function handleUpdated(updated: ReviewItem) {
    setItems((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Review"
        description="Everything the catalog clean-up couldn't decide on its own. Fix the product (or count it in Stocktake), then resolve the item with a note saying what you found. Dismiss only when the item is simply wrong."
      />

      <Card>
        <div className="flex flex-wrap items-center gap-2 text-sm text-neutral-300">
          <span>{openTotal} open:</span>
          <StatusPill tone="danger">{counts.blocker} blocker</StatusPill>
          <StatusPill tone="warning">{counts.check} check</StatusPill>
          <StatusPill tone="inactive">{counts.info} info</StatusPill>
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <input
            type="search"
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            placeholder="Search…"
            className={INPUT}
          />
          <select
            value={filters.status}
            onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as ReviewFilters["status"] }))}
            className={INPUT}
            aria-label="Status"
          >
            <option value="open">Open</option>
            <option value="closed">Resolved or dismissed</option>
            <option value="all">All</option>
          </select>
          <select
            value={filters.severity}
            onChange={(e) => setFilters((f) => ({ ...f, severity: e.target.value as ReviewFilters["severity"] }))}
            className={INPUT}
            aria-label="Severity"
          >
            <option value="all">Any severity</option>
            <option value="blocker">Blocker</option>
            <option value="check">Check</option>
            <option value="info">Info</option>
          </select>
          <select
            value={filters.entity}
            onChange={(e) => setFilters((f) => ({ ...f, entity: e.target.value }))}
            className={INPUT}
            aria-label="About"
          >
            <option value="all">About anything</option>
            {entities.map((entity) => (
              <option key={entity} value={entity}>
                {entity}
              </option>
            ))}
          </select>
        </div>
      </Card>

      <Card title={`${visible.length} item${visible.length === 1 ? "" : "s"}`} padded={false}>
        {loading ? (
          <p className="p-4 text-sm text-neutral-400">Loading…</p>
        ) : loadError ? (
          <p className="p-4 text-sm text-red-400">{loadError}</p>
        ) : visible.length === 0 ? (
          <EmptyState message={items.length === 0 ? "The review queue is empty." : "Nothing matches these filters."} />
        ) : (
          <ReviewItemList items={visible} onUpdated={handleUpdated} productNames={productNames} />
        )}
      </Card>
    </div>
  );
}
