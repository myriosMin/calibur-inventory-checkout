"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import PageHeader from "@/components/admin/PageHeader";
import StatusPill from "@/components/admin/StatusPill";
import { getBrowserClient } from "@/lib/supabase/browser";

import { formatVariance } from "../walk";
import {
  summariseByLocation,
  summariseByProduct,
  type LocationRef,
  type LocationVariance,
  type ProductRef,
  type ProductVariance,
  type StockCountRow,
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

/** Plenty for a club counting one shelf a month for years. */
const ROW_LIMIT = 1000;

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
  const [counts, setCounts] = useState<StockCountRow[]>([]);
  const [products, setProducts] = useState<ProductRef[]>([]);
  const [locations, setLocations] = useState<LocationRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [onlyVariance, setOnlyVariance] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setLoadError(null);
      const supabase = getBrowserClient();

      // Three flat reads joined client-side rather than one PostgREST embed:
      // stock_counts.product_id resolves to both `products` and the
      // `stock_summary` view, so an embed has to be disambiguated by FK
      // name, and the summariser is easier to test against plain rows.
      const [countsRes, productsRes, locationsRes] = await Promise.all([
        supabase
          .from("stock_counts")
          .select("id, product_id, counted_qty, expected_qty, created_at, movement_id, session_id")
          .order("created_at", { ascending: false })
          .limit(ROW_LIMIT),
        supabase.from("products").select("id, name, location_id"),
        supabase.from("locations").select("id, name"),
      ]);

      if (cancelled) return;

      if (countsRes.error) setLoadError(countsRes.error.message);
      else {
        setCounts(
          (countsRes.data ?? []).map((row) => ({
            id: row.id,
            productId: row.product_id,
            countedQty: row.counted_qty,
            expectedQty: row.expected_qty,
            createdAt: row.created_at,
            movementId: row.movement_id,
            sessionId: row.session_id,
          })),
        );
      }

      if (productsRes.error) {
        setLoadError((prev) => prev ?? productsRes.error!.message);
      } else {
        setProducts(
          (productsRes.data ?? []).map((row) => ({
            id: row.id,
            name: row.name,
            locationId: row.location_id,
          })),
        );
      }

      if (locationsRes.error) {
        setLoadError((prev) => prev ?? locationsRes.error!.message);
      } else {
        setLocations(locationsRes.data ?? []);
      }

      setLoading(false);
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

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

  const locationColumns: Column<LocationVariance>[] = [
    {
      key: "location",
      header: "Location",
      render: (row) => (
        <span className="text-neutral-100">{row.locationName}</span>
      ),
    },
    {
      key: "counted",
      header: "Products counted",
      className: "text-right tabular-nums",
      render: (row) => row.productsCounted,
    },
    {
      key: "off",
      header: "Off at last count",
      className: "text-right tabular-nums",
      render: (row) =>
        row.productsWithVariance === 0 ? (
          <span className="text-neutral-400">none</span>
        ) : (
          <StatusPill tone="warning">
            {row.productsWithVariance} of {row.productsCounted}
          </StatusPill>
        ),
    },
    {
      key: "net",
      header: "Net",
      className: "text-right tabular-nums",
      render: (row) => formatVariance(row.netVariance),
    },
    {
      key: "abs",
      header: "Total swing",
      className: "text-right tabular-nums",
      render: (row) => row.absVariance,
    },
    {
      key: "last",
      header: "Last counted",
      render: (row) => formatDate(row.lastCountedAt),
    },
  ];

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
        title="Stocktake variance"
        description="What the shelves held versus what the ledger thought, from every committed count."
        actions={
          <Link
            href="/admin/stocktake"
            className="inline-flex min-h-11 items-center rounded-lg bg-neutral-800 px-4 text-sm font-medium uppercase tracking-wide text-neutral-100 hover:bg-neutral-700"
          >
            Count a shelf
          </Link>
        }
      />

      <Card>
        <p className="text-sm text-neutral-300">
          <strong className="text-neutral-100">
            Variance is a diagnostic, not an accusation.
          </strong>{" "}
          A part that is off every time it is counted is a part people
          aren&apos;t logging — which means the flow for it is too slow. Fix the
          flow: a clearer label, a group code for the whole drawer, a lower
          friction path in the Mini App. This is an honour system, and the
          numbers below are about the system, not about anyone using it.
        </p>
        {!loading && !loadError ? (
          <p className="mt-3 text-sm text-neutral-400">
            {byProduct.length} product{byProduct.length === 1 ? "" : "s"}{" "}
            counted across {byLocation.length} location
            {byLocation.length === 1 ? "" : "s"}. {productsOff} drifted at the
            last count.
          </p>
        ) : null}
      </Card>

      <Card title="By location" padded={false}>
        <DataTable
          columns={locationColumns}
          rows={byLocation}
          rowKey={(row) => row.locationId ?? "unassigned"}
          loading={loading}
          error={loadError}
          emptyMessage="No counts committed yet. Walk a shelf and the variance shows up here."
        />
      </Card>

      <Card
        title="By product"
        padded={false}
        actions={
          <label className="flex items-center gap-2 text-xs text-neutral-400">
            <input
              type="checkbox"
              checked={onlyVariance}
              onChange={(e) => setOnlyVariance(e.target.checked)}
              className="h-4 w-4"
            />
            Only products that have drifted
          </label>
        }
      >
        <DataTable
          columns={productColumns}
          rows={visibleProducts}
          rowKey={(row) => row.productId}
          loading={loading}
          error={loadError}
          emptyMessage={
            onlyVariance
              ? "Nothing has drifted — every counted product matched the ledger."
              : "No counts committed yet. Walk a shelf and the variance shows up here."
          }
        />
      </Card>
    </div>
  );
}
