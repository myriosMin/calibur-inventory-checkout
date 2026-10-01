"use client";

import { useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import PageHeader from "@/components/admin/PageHeader";
import Segmented from "@/components/admin/Segmented";
import Skeleton from "@/components/admin/Skeleton";
import StatCard from "@/components/admin/StatCard";
import StatusPill from "@/components/admin/StatusPill";
import DivergingBarList from "@/components/admin/charts/DivergingBarList";
import { toStockCountRows, useLocations, useProducts, useStockCounts } from "@/lib/admin/queries";

import { formatVariance } from "../walk";
import {
  summariseByLocation,
  summariseByProduct,
  type ProductVariance,
} from "../variance";

// ---------------------------------------------------------------------------
// The variance report -- the roadmap's only external check on whether the
// honour system is working ("success is measured by stocktake variance, not
// by app usage").
//
// Read the framing before changing any copy here: variance is a DIAGNOSTIC,
// NOT AN ACCUSATION. A part with persistently high variance is one people
// aren't logging, which means the flow for that part is too slow -- a UX bug
// to fix, not a person to chase. Nothing on this page names a member, ranks
// people, or uses the `danger` tone; `warning` says "look at this", which is
// the strongest thing a count is entitled to say.
// ---------------------------------------------------------------------------

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function AdminStocktakeVariancePage() {
  // Shared, paged reads: stock_counts used to stop at a hard 1000 rows here.
  const countsQ = useStockCounts();
  const productsQ = useProducts();
  const locationsQ = useLocations();
  const counts = useMemo(() => toStockCountRows(countsQ.data ?? []), [countsQ.data]);
  const products = useMemo(
    () => (productsQ.data ?? []).map((row) => ({ id: row.id, name: row.name, locationId: row.location_id })),
    [productsQ.data],
  );
  const locations = useMemo(() => locationsQ.data ?? [], [locationsQ.data]);
  const loading = countsQ.isLoading || productsQ.isLoading || locationsQ.isLoading;
  const loadError = ((countsQ.error ?? productsQ.error ?? locationsQ.error) as Error | undefined)?.message ?? null;
  const [onlyVariance, setOnlyVariance] = useState(true);

  const byProduct = useMemo(
    () => summariseByProduct(counts, products, locations),
    [counts, products, locations],
  );
  const byLocation = useMemo(() => summariseByLocation(byProduct), [byProduct]);

  const visibleProducts = useMemo(
    () => (onlyVariance ? byProduct.filter((p) => p.absVariance !== 0) : byProduct),
    [byProduct, onlyVariance],
  );

  const productsOff = byProduct.filter((p) => p.absVariance !== 0).length;

  const productColumns: Column<ProductVariance>[] = [
    {
      key: "product",
      header: "Product",
      render: (row) => (
        <span className="text-neutral-100">{row.productName}</span>
      ),
    },
    {
      key: "location",
      header: "Location",
      render: (row) => row.locationName,
    },
    {
      key: "last",
      header: "Last count",
      className: "text-right tabular-nums",
      render: (row) => `${row.lastCountedQty} vs ${row.lastExpectedQty}`,
    },
    {
      key: "variance",
      header: "Variance",
      className: "text-right",
      render: (row) =>
        row.lastVariance === 0 ? (
          <span className="text-neutral-400">matched</span>
        ) : (
          <StatusPill tone="warning">
            {formatVariance(row.lastVariance)}
          </StatusPill>
        ),
    },
    {
      key: "history",
      header: "Off in",
      className: "text-right tabular-nums",
      render: (row) => `${row.timesWithVariance} of ${row.timesCounted}`,
    },
    {
      key: "when",
      header: "Last counted",
      render: (row) => formatDate(row.lastCountedAt),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Variance"
        description="What the shelves held versus what the ledger thought, from every committed count."
        info={
          <>
            <p>
              <strong className="text-neutral-100">Variance is a diagnostic, not an accusation.</strong> A part that
              is off every time it is counted is a part people aren&apos;t logging, which means the flow for it is too
              slow.
            </p>
            <p>
              Fix the flow: a clearer label, a group code for the whole drawer, a lower-friction path in the Mini App.
              This is an honour system, and these numbers are about the system, not about anyone using it.
            </p>
          </>
        }
      />

      <div className="grid grid-cols-3 gap-3">
        <StatCard label="Products counted" value={byProduct.length} loading={loading} />
        <StatCard
          label="Drifted at last count"
          value={productsOff}
          tone={productsOff > 0 ? "warning" : undefined}
          loading={loading}
        />
        <StatCard label="Locations counted" value={byLocation.length} loading={loading} />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-5">
        <Card title="By location" subtitle="Net drift at the last count" className="lg:col-span-2">
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : byLocation.length === 0 ? (
            <p className="text-sm text-neutral-500">No counts committed yet. Walk a shelf and it shows up here.</p>
          ) : (
            <DivergingBarList
              items={byLocation.map((row) => ({
                key: row.locationId ?? "unassigned",
                label: row.locationName,
                value: row.netVariance,
                display: formatVariance(row.netVariance),
              }))}
            />
          )}
        </Card>

        <Card
          title="By product"
          padded={false}
          className="lg:col-span-3"
          actions={
            <Segmented
              ariaLabel="Products shown"
              value={onlyVariance ? "drifted" : "all"}
              onChange={(value) => setOnlyVariance(value === "drifted")}
              options={[
                { value: "drifted", label: "Drifted", count: productsOff },
                { value: "all", label: "All", count: byProduct.length },
              ]}
            />
          }
        >
          <DataTable
            columns={productColumns}
            rows={visibleProducts}
            rowKey={(row) => row.productId}
            rowHref={(row) => `/admin/products/${row.productId}`}
            loading={loading}
            error={loadError}
            emptyMessage={
              onlyVariance
                ? "Nothing has drifted: every counted product matched the ledger."
                : "No counts committed yet. Walk a shelf and the variance shows up here."
            }
          />
        </Card>
      </div>
    </div>
  );
}
