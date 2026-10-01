"use client";

import { useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import EmptyState from "@/components/admin/EmptyState";
import FilterMenu from "@/components/admin/FilterMenu";
import { CAPTION, FILTER, LABEL } from "@/components/admin/form";
import PageHeader from "@/components/admin/PageHeader";
import ReviewItemList, { type ReviewItem } from "@/components/admin/ReviewItemList";
import Segmented from "@/components/admin/Segmented";
import Skeleton, { TableSkeleton } from "@/components/admin/Skeleton";
import { IconSearch } from "@/components/ui/icons";
import { KEYS, revalidate, upsertCached, useProducts, useReviewItems } from "@/lib/admin/queries";

import { DEFAULT_REVIEW_FILTERS, filterReviewItems, openCountsBySeverity, type ReviewFilters } from "./review-filters";

/**
 * The review queue: everything the catalog clean-up could not decide on its
 * own (docs/data-cleaning.md). The job is to fix the product -- or count it
 * in Stocktake -- and then close the item with a note saying what was found.
 */
export default function AdminReviewPage() {
  const reviewsQ = useReviewItems();
  const productsQ = useProducts();
  const [filters, setFilters] = useState<ReviewFilters>(DEFAULT_REVIEW_FILTERS);

  const items = useMemo(() => reviewsQ.data ?? [], [reviewsQ.data]);
  const productNames = useMemo(() => new Map((productsQ.data ?? []).map((p) => [p.id, p.name])), [productsQ.data]);
  const counts = useMemo(() => openCountsBySeverity(items), [items]);
  const entities = useMemo(() => [...new Set(items.map((i) => i.entity))].sort(), [items]);
  const visible = useMemo(() => filterReviewItems(items, filters), [items, filters]);
  const openTotal = counts.blocker + counts.check + counts.info;
  const closedTotal = items.length - openTotal;
  const loadError = (reviewsQ.error as Error | undefined)?.message;

  function handleUpdated(updated: ReviewItem) {
    void upsertCached(KEYS.reviewItems, updated);
    void revalidate(KEYS.badges);
  }

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Review"
        description={reviewsQ.isLoading ? "Questions from the catalog clean-up." : `${openTotal} open questions from the catalog clean-up.`}
        info={
          <>
            <p>Everything the catalog clean-up couldn&apos;t decide on its own.</p>
            <p>
              Fix the product (or count it in Stocktake), then resolve the item with a note saying what you found.
              Dismiss only when the item is simply wrong.
            </p>
          </>
        }
      />

      <Card>
        {reviewsQ.isLoading ? (
          <Skeleton className="h-10 w-full" />
        ) : (
          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-neutral-400">
                <span className="font-display text-2xl font-semibold tabular-nums text-neutral-100">{closedTotal}</span>
                <span className="text-neutral-500"> of {items.length} closed</span>
              </span>
              {openTotal === 0 && items.length > 0 ? <span className="text-green-400">Queue cleared</span> : null}
            </div>
            <div
              className="h-2 w-full overflow-hidden rounded-full bg-neutral-800"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={items.length}
              aria-valuenow={closedTotal}
              aria-label="Review items closed"
            >
              <div
                className="h-full rounded-full bg-status-good transition-[width] duration-300"
                style={{ width: `${items.length ? (closedTotal / items.length) * 100 : 0}%` }}
              />
            </div>
          </div>
        )}
      </Card>

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            ariaLabel="Severity"
            value={filters.severity}
            onChange={(severity) => setFilters((f) => ({ ...f, severity }))}
            options={[
              { value: "all", label: "All" },
              { value: "blocker", label: "Blocker", count: counts.blocker, tone: "danger" },
              { value: "check", label: "Check", count: counts.check, tone: "warning" },
              { value: "info", label: "Info", count: counts.info },
            ]}
          />
          <span aria-hidden className="hidden h-5 w-px bg-neutral-800 sm:block" />
          <Segmented
            ariaLabel="Status"
            value={filters.status}
            onChange={(status) => setFilters((f) => ({ ...f, status }))}
            options={[
              { value: "open", label: "Open" },
              { value: "closed", label: "Closed" },
              { value: "all", label: "Everything" },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="relative block">
            <span className="sr-only">Search review items</span>
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="search"
              value={filters.query}
              onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
              placeholder="Search…"
              className={`${FILTER} w-56 pl-9`}
            />
          </label>
          <FilterMenu activeCount={filters.entity !== "all" ? 1 : 0} onReset={() => setFilters((f) => ({ ...f, entity: "all" }))}>
            <label className={LABEL}>
              <span className={CAPTION}>About</span>
              <select
                value={filters.entity}
                onChange={(e) => setFilters((f) => ({ ...f, entity: e.target.value }))}
                className={FILTER}
              >
                <option value="all">Anything</option>
                {entities.map((entity) => (
                  <option key={entity} value={entity}>
                    {entity}
                  </option>
                ))}
              </select>
            </label>
          </FilterMenu>
        </div>
      </div>

      <Card padded={false}>
        {reviewsQ.isLoading ? (
          <TableSkeleton />
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
