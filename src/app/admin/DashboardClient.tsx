"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import EmptyState from "@/components/admin/EmptyState";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { IconDownload } from "@/components/ui/icons";
import Toast from "@/components/ui/Toast";
import {
  entryMethodBreakdown,
  formatRatio,
  modesPresent,
  sessionsPerDay,
  summariseScanMisses,
  type DailySessionCount,
  type ScanMissGroup,
} from "@/lib/reports/activity";
import {
  buildCatalogCsv,
  buildHoldingsCsv,
  buildMovementsCsv,
  exportFilename,
  type CatalogExportRow,
  type HoldingsExportRow,
  type MovementsExportRow,
} from "@/lib/reports/export";
import {
  computeLabelHealth,
  needsAttention,
  type LabelHealthRow,
} from "@/lib/reports/label-health";
import {
  fetchBindQueueDepth,
  fetchEntriesSince,
  fetchProducts,
  fetchScanCodes,
  fetchScanMissesSince,
  fetchSessionsSince,
  fetchStockLevels,
  REPORT_ROW_LIMIT,
  type EntryRow,
  type ProductRef as ReportProductRef,
  type ScanCodeRef,
} from "@/lib/reports/queries";
import { dateInZone } from "@/lib/reports/schedule";
import { classifyStockLevels, type StockLevelRow } from "@/lib/reports/stock";
import { getBrowserClient } from "@/lib/supabase/browser";

import {
  summariseByLocation,
  summariseByProduct,
  type LocationRef,
  type LocationVariance,
  type ProductRef as VarianceProductRef,
  type StockCountRow,
} from "./stocktake/variance";
import { formatVariance } from "./stocktake/walk";

// ---------------------------------------------------------------------------
// The /admin dashboard -- architecture.md §Observability's "minimum useful
// set", plus the label-health list qr-labels.md and operations.md both ask
// for, plus the CSV export architecture.md's open questions call "cheap, and
// makes the committee more comfortable about depending on a hosted service".
//
// Every number here comes from src/lib/reports/*, the same modules the
// nightly cron uses. That is deliberate: if the dashboard and the bot
// computed "low stock" separately they would eventually disagree, and the
// first casualty would be trust in both.
//
// Reads go through the anon browser client and RLS's is_admin(), like every
// other /admin page -- there is no /api/admin/* layer in this codebase.
// ---------------------------------------------------------------------------

/** Activity window for the sessions chart. Two weeks fits on one screen. */
const ACTIVITY_DAYS = 14;

/**
 * Window for scan-vs-search and label health. Longer than the activity
 * chart on purpose: a label's health is a slow signal, and a fortnight of a
 * quiet club is not enough entries to accuse a sticker of anything.
 */
const LABEL_WINDOW_DAYS = 90;

const DAY_MS = 86_400_000;

interface FeedbackState {
  variant: "success" | "error" | "info";
  message: string;
}

interface HoldingRow {
  product_id: string | null;
  holder_id: string | null;
  qty: number | null;
}

interface HolderRef {
  id: string;
  name: string;
  kind: string;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * DAY_MS).toISOString();
}

function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortDate(iso: string): string {
  // `iso` here is already a YYYY-MM-DD bucket key, not a timestamp.
  const [, month, day] = iso.split("-");
  return `${day}/${month}`;
}

/**
 * Browser-side file download. The export data is assembled from rows this
 * page already has RLS-authorised access to, so there is nothing to add a
 * route handler for -- a Blob and an object URL is the whole mechanism.
 */
function downloadCsv(filename: string, csv: string): void {
  // The BOM is for Excel: without it, Excel on Windows reads UTF-8 as the
  // local codepage and mangles the Ω in half the resistor names.
  const blob = new Blob(["﻿", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: "warning" | "danger";
}) {
  const valueClass =
    tone === "danger" ? "text-red-400" : tone === "warning" ? "text-amber-400" : "text-neutral-100";
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-400">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${valueClass}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-neutral-500">{hint}</p> : null}
    </div>
  );
}

export default function DashboardClient() {
  const supabase = useMemo(() => getBrowserClient(), []);

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<FeedbackState | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  const [sessions, setSessions] = useState<{ mode: string; startedAt: string }[]>([]);
  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [misses, setMisses] = useState<{ code: string; outcome: string; createdAt: string }[]>([]);
  const [bindQueue, setBindQueue] = useState(0);
  const [levels, setLevels] = useState<StockLevelRow[]>([]);
  const [products, setProducts] = useState<ReportProductRef[]>([]);
  const [codes, setCodes] = useState<ScanCodeRef[]>([]);
  const [counts, setCounts] = useState<StockCountRow[]>([]);
  const [locations, setLocations] = useState<LocationRef[]>([]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const activitySince = isoDaysAgo(ACTIVITY_DAYS);
        const labelSince = isoDaysAgo(LABEL_WINDOW_DAYS);

        const [
          sessionRows,
          entryRows,
          missRows,
          queueDepth,
          levelRows,
          productRows,
          codeRows,
          countsRes,
          locationsRes,
        ] = await Promise.all([
          fetchSessionsSince(supabase, activitySince),
          fetchEntriesSince(supabase, labelSince),
          fetchScanMissesSince(supabase, labelSince),
          fetchBindQueueDepth(supabase),
          fetchStockLevels(supabase),
          fetchProducts(supabase),
          fetchScanCodes(supabase),
          supabase
            .from("stock_counts")
            .select("id, product_id, counted_qty, expected_qty, created_at, movement_id, session_id")
            .order("created_at", { ascending: false })
            .limit(REPORT_ROW_LIMIT),
          supabase.from("locations").select("id, name"),
        ]);

        if (cancelled) return;
        if (countsRes.error) throw new Error(countsRes.error.message);
        if (locationsRes.error) throw new Error(locationsRes.error.message);

        setSessions(sessionRows.map((row) => ({ mode: row.mode, startedAt: row.startedAt })));
        setEntries(entryRows);
        setMisses(missRows);
        setBindQueue(queueDepth);
        setLevels(levelRows);
        setProducts(productRows);
        setCodes(codeRows);
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
        setLocations(locationsRes.data ?? []);
      } catch (error) {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : String(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supabase]);

  // -------------------------------------------------------------------------
  // Derived views. All pure, all from src/lib/reports/*.
  // -------------------------------------------------------------------------
  const daily = useMemo<DailySessionCount[]>(
    () => sessionsPerDay(sessions, { days: ACTIVITY_DAYS, now: new Date() }),
    [sessions],
  );
  const modes = useMemo(() => modesPresent(daily), [daily]);
  const breakdown = useMemo(() => entryMethodBreakdown(entries), [entries]);
  const missGroups = useMemo<ScanMissGroup[]>(() => summariseScanMisses(misses), [misses]);
  const stock = useMemo(() => classifyStockLevels(levels), [levels]);

  const labelRows = useMemo<LabelHealthRow[]>(
    () =>
      computeLabelHealth(
        entries.map((entry) => ({ productId: entry.productId, entryMethod: entry.entryMethod })),
        products.map((product) => ({
          id: product.id,
          name: product.name,
          tier: product.tier,
          active: product.active,
        })),
        codes,
      ),
    [entries, products, codes],
  );
  const labelProblems = useMemo(() => needsAttention(labelRows), [labelRows]);

  const locationVariance = useMemo<LocationVariance[]>(() => {
    const productRefs: VarianceProductRef[] = products.map((product) => ({
      id: product.id,
      name: product.name,
      locationId: product.locationId,
    }));
    return summariseByLocation(summariseByProduct(counts, productRefs, locations));
  }, [counts, products, locations]);

  const sessionTotal = daily.reduce((sum, row) => sum + row.total, 0);

  // -------------------------------------------------------------------------
  // Exports
  // -------------------------------------------------------------------------
  const runExport = async (kind: "catalog" | "holdings" | "movements") => {
    setExporting(kind);
    setFeedback(null);
    try {
      const today = dateInZone(new Date());
      const filename = exportFilename(kind, today);

      if (kind === "catalog") {
        const locationById = new Map(locations.map((location) => [location.id, location.name]));
        const levelById = new Map(levels.map((level) => [level.productId, level]));
        const codeByProduct = new Map<string, string>();
        for (const code of codes) {
          if (code.active && code.kind === "product" && code.productId && !codeByProduct.has(code.productId)) {
            codeByProduct.set(code.productId, code.code);
          }
        }
        const rows: CatalogExportRow[] = products.map((product) => ({
          id: product.id,
          name: product.name,
          tier: product.tier,
          category: product.category,
          unit: product.unit,
          partNumber: product.partNumber,
          locationName: product.locationId ? (locationById.get(product.locationId) ?? null) : null,
          minStock: product.minStock,
          returnable: product.returnable,
          active: product.active,
          qtyInStore: levelById.get(product.id)?.qtyInStore ?? null,
          qtyOut: levelById.get(product.id)?.qtyOut ?? null,
          code: codeByProduct.get(product.id) ?? null,
        }));
        downloadCsv(filename, buildCatalogCsv(rows));
      } else if (kind === "holdings") {
        const [holdingsRes, holdersRes] = await Promise.all([
          supabase.from("holdings").select("product_id, holder_id, qty").limit(REPORT_ROW_LIMIT),
          supabase.from("holders").select("id, name, kind").limit(REPORT_ROW_LIMIT),
        ]);
        if (holdingsRes.error) throw new Error(holdingsRes.error.message);
        if (holdersRes.error) throw new Error(holdersRes.error.message);

        const holderById = new Map<string, HolderRef>(
          (holdersRes.data ?? []).map((holder) => [holder.id, holder]),
        );
        const productById = new Map(products.map((product) => [product.id, product]));

        const rows: HoldingsExportRow[] = (holdingsRes.data as HoldingRow[])
          .filter((row) => row.product_id !== null && row.holder_id !== null)
          .map((row) => {
            const holder = holderById.get(row.holder_id!);
            const product = productById.get(row.product_id!);
            return {
              holderKind: holder?.kind ?? "unknown",
              holderName: holder?.name ?? "Unknown holder",
              productId: row.product_id!,
              productName: product?.name ?? "Unknown product",
              qty: Number(row.qty ?? 0),
              unit: product?.unit ?? "",
            };
          })
          .sort(
            (a, b) =>
              a.holderKind.localeCompare(b.holderKind) ||
              a.holderName.localeCompare(b.holderName) ||
              a.productName.localeCompare(b.productName),
          );
        downloadCsv(filename, buildHoldingsCsv(rows));
      } else {
        // The ledger is the one export big enough to be worth fetching only
        // on demand rather than on every dashboard load.
        const [movementsRes, holdersRes, membersRes] = await Promise.all([
          supabase
            .from("stock_movements")
            .select(
              "id, created_at, product_id, qty, from_holder_id, to_holder_id, reason, entry_method, scan_code, actor_member_id, session_id",
            )
            .order("id", { ascending: true })
            .limit(REPORT_ROW_LIMIT),
          supabase.from("holders").select("id, name, kind").limit(REPORT_ROW_LIMIT),
          supabase.from("members").select("id, full_name, display_name").limit(REPORT_ROW_LIMIT),
        ]);
        if (movementsRes.error) throw new Error(movementsRes.error.message);
        if (holdersRes.error) throw new Error(holdersRes.error.message);
        if (membersRes.error) throw new Error(membersRes.error.message);

        const holderById = new Map((holdersRes.data ?? []).map((holder) => [holder.id, holder]));
        const memberById = new Map((membersRes.data ?? []).map((member) => [member.id, member]));
        const productById = new Map(products.map((product) => [product.id, product]));

        const rows: MovementsExportRow[] = (movementsRes.data ?? []).map((row) => {
          const product = productById.get(row.product_id);
          const actor = row.actor_member_id ? memberById.get(row.actor_member_id) : null;
          return {
            id: row.id,
            createdAt: row.created_at,
            productId: row.product_id,
            productName: product?.name ?? "Unknown product",
            qty: row.qty,
            unit: product?.unit ?? "",
            fromHolderName: holderById.get(row.from_holder_id)?.name ?? "Unknown holder",
            toHolderName: holderById.get(row.to_holder_id)?.name ?? "Unknown holder",
            reason: row.reason,
            entryMethod: row.entry_method,
            scanCode: row.scan_code,
            actorName: actor ? (actor.display_name ?? actor.full_name) : null,
            sessionId: row.session_id,
          };
        });
        downloadCsv(filename, buildMovementsCsv(rows));
      }

      setFeedback({ variant: "success", message: `Downloaded ${filename}.` });
    } catch (error) {
      setFeedback({
        variant: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setExporting(null);
    }
  };

  // -------------------------------------------------------------------------
  // Table column definitions
  // -------------------------------------------------------------------------
  const sessionColumns: Column<DailySessionCount>[] = [
    { key: "date", header: "Day", render: (row) => shortDate(row.date) },
    ...modes.map((mode) => ({
      key: mode,
      header: mode,
      className: "text-right tabular-nums",
      render: (row: DailySessionCount) => row.byMode[mode] ?? 0,
    })),
    {
      key: "total",
      header: "Total",
      className: "text-right tabular-nums text-neutral-100",
      render: (row: DailySessionCount) => row.total,
    },
  ];

  const labelColumns: Column<LabelHealthRow>[] = [
    {
      key: "product",
      header: "Product",
      render: (row) => <span className="text-neutral-100">{row.productName}</span>,
    },
    {
      key: "verdict",
      header: "Signal",
      render: (row) =>
        row.verdict === "no_label" ? (
          <StatusPill tone="danger">no active label</StatusPill>
        ) : (
          <StatusPill tone="warning">mostly searched</StatusPill>
        ),
    },
    {
      key: "split",
      header: "Scanned / searched",
      className: "text-right tabular-nums",
      render: (row) => `${row.scanned} / ${row.searched}`,
    },
    {
      key: "ratio",
      header: "Search share",
      className: "text-right tabular-nums",
      render: (row) => formatRatio(row.searchRatio),
    },
    {
      key: "action",
      header: "",
      className: "text-right",
      render: (row) => (
        <Link
          href={row.code ? `/admin/labels?code=${encodeURIComponent(row.code)}` : "/admin/scan-codes"}
          className="font-medium text-red-400 hover:text-red-300"
        >
          {row.code ? "Reprint label" : "Create a code"}
        </Link>
      ),
    },
  ];

  const missColumns: Column<ScanMissGroup>[] = [
    {
      key: "code",
      header: "Code",
      render: (row) => <span className="font-mono text-neutral-100">{row.code}</span>,
    },
    { key: "outcome", header: "Outcome", render: (row) => row.outcomes.join(", ") },
    {
      key: "count",
      header: "Scans",
      className: "text-right tabular-nums",
      render: (row) => row.count,
    },
    { key: "last", header: "Last seen", render: (row) => formatDateTime(row.lastSeen) },
  ];

  const lowStockColumns: Column<StockLevelRow>[] = [
    {
      key: "name",
      header: "Product",
      render: (row) => <span className="text-neutral-100">{row.name}</span>,
    },
    {
      key: "qty",
      header: "In store",
      className: "text-right tabular-nums",
      render: (row) => `${row.qtyInStore} ${row.unit}`,
    },
    {
      key: "min",
      header: "Min",
      className: "text-right tabular-nums",
      render: (row) => (row.minStock === null ? "—" : row.minStock),
    },
  ];

  const negativeColumns: Column<StockLevelRow>[] = [
    {
      key: "name",
      header: "Product",
      render: (row) => <span className="text-neutral-100">{row.name}</span>,
    },
    {
      key: "qty",
      header: "In store",
      className: "text-right tabular-nums",
      render: (row) => (
        <StatusPill tone="danger">
          {row.qtyInStore} {row.unit}
        </StatusPill>
      ),
    },
  ];

  const varianceColumns: Column<LocationVariance>[] = [
    {
      key: "location",
      header: "Location",
      render: (row) => <span className="text-neutral-100">{row.locationName}</span>,
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
      render: (row) => row.productsWithVariance,
    },
    {
      key: "net",
      header: "Net variance",
      className: "text-right tabular-nums",
      render: (row) => formatVariance(row.netVariance),
    },
  ];

  if (loadError) {
    return (
      <Card>
        <p className="text-sm text-red-400">{loadError}</p>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {feedback ? (
        <Toast
          variant={feedback.variant}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Stat
          label={`Sessions (${ACTIVITY_DAYS}d)`}
          value={loading ? "…" : String(sessionTotal)}
          hint={modes.length > 0 ? modes.join(" · ") : "no activity yet"}
        />
        <Stat
          label="Scanned, not searched"
          value={loading ? "…" : formatRatio(breakdown.scanRatio)}
          hint={`${breakdown.memberEntries} member entries, ${LABEL_WINDOW_DAYS}d`}
        />
        <Stat
          label="Bind queue"
          value={loading ? "…" : String(bindQueue)}
          hint="unrecognised Telegram users waiting"
          tone={bindQueue > 0 ? "warning" : undefined}
        />
        <Stat
          label="Unknown codes scanned"
          value={loading ? "…" : String(missGroups.length)}
          hint={`${misses.length} scans over ${LABEL_WINDOW_DAYS}d`}
          tone={missGroups.length > 0 ? "warning" : undefined}
        />
        <Stat
          label="Low stock"
          value={loading ? "…" : String(stock.low.length)}
          hint="below min_stock"
          tone={stock.low.length > 0 ? "warning" : undefined}
        />
        <Stat
          label="Negative holdings"
          value={loading ? "…" : String(stock.negative.length)}
          hint="data quality, not a shortage"
          tone={stock.negative.length > 0 ? "danger" : undefined}
        />
      </div>

      <Card padded={false} title={`Sessions per day, by mode (${ACTIVITY_DAYS} days)`}>
        <DataTable
          columns={sessionColumns}
          rows={daily}
          rowKey={(row) => row.date}
          loading={loading}
          emptyMessage="No sessions in this window."
        />
      </Card>

      <Card title={`Scan vs. search (${LABEL_WINDOW_DAYS} days)`}>
        {loading ? (
          <p className="text-sm text-neutral-400">Loading…</p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-4">
              <Stat label="Scanned" value={String(breakdown.scan)} />
              <Stat label="Group pick" value={String(breakdown.groupPick)} />
              <Stat label="Searched" value={String(breakdown.search)} />
              <Stat label="Admin entry" value={String(breakdown.admin)} />
            </div>
            <p className="mt-3 text-sm text-neutral-400">
              A group pick counts as a scan — the member did scan a sticker, just the
              shelf&apos;s rather than the part&apos;s. Admin entries (restock, stocktake) are
              excluded from the ratio: nobody walked to a shelf, so the labels are not what
              they measure.
            </p>
          </>
        )}
      </Card>

      <Card
        padded={false}
        title="Label health"
        actions={
          <Link href="/admin/labels" className="text-xs font-medium text-red-400 hover:text-red-300">
            Print sheets
          </Link>
        }
      >
        {loading ? (
          <p className="p-4 text-sm text-neutral-400">Loading…</p>
        ) : labelProblems.length === 0 ? (
          <EmptyState message="Every product with enough usage to judge is being reached by scan. Nothing to reprint." />
        ) : (
          <>
            <p className="px-4 pt-4 text-sm text-neutral-400">
              A product consistently reached by search almost certainly has a missing or damaged
              sticker. Reprint on this signal rather than waiting for someone to complain.
            </p>
            <DataTable
              columns={labelColumns}
              rows={labelProblems}
              rowKey={(row) => row.productId}
            />
          </>
        )}
      </Card>

      <Card padded={false} title="Unknown or retired codes scanned">
        <DataTable
          columns={missColumns}
          rows={missGroups}
          rowKey={(row) => row.code}
          loading={loading}
          emptyMessage="No failed scans in this window."
        />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card padded={false} title="Low stock">
          <DataTable
            columns={lowStockColumns}
            rows={stock.low}
            rowKey={(row) => row.productId}
            loading={loading}
            emptyMessage="Nothing is below its minimum."
          />
        </Card>

        <Card padded={false} title="Negative holdings (data check)">
          {loading ? (
            <p className="p-4 text-sm text-neutral-400">Loading…</p>
          ) : stock.negative.length === 0 ? (
            <EmptyState message="No product reads below zero." />
          ) : (
            <>
              <p className="px-4 pt-4 text-sm text-neutral-400">
                Not a shortage. A negative balance almost always means the opening balance was
                never recorded — the part was on the shelf before the system knew about it. Fix
                it on{" "}
                <Link href="/admin/restock" className="font-medium text-red-400 hover:text-red-300">
                  Restock
                </Link>
                , or by counting that shelf.
              </p>
              <DataTable
                columns={negativeColumns}
                rows={stock.negative}
                rowKey={(row) => row.productId}
              />
            </>
          )}
        </Card>
      </div>

      <Card
        padded={false}
        title="Stocktake variance by location"
        actions={
          <Link
            href="/admin/stocktake/variance"
            className="text-xs font-medium text-red-400 hover:text-red-300"
          >
            Full report
          </Link>
        }
      >
        <DataTable
          columns={varianceColumns}
          rows={locationVariance}
          rowKey={(row) => row.locationId ?? "unassigned"}
          loading={loading}
          emptyMessage="No shelf has been counted yet."
        />
      </Card>

      <Card title="Export">
        <p className="text-sm text-neutral-400">
          Three CSVs: what parts exist, where they are right now, and how they got there. For
          backups and committee handover — a successor should be able to read the club&apos;s
          inventory without an account on anything.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {(["catalog", "holdings", "movements"] as const).map((kind) => (
            <Button
              key={kind}
              variant="secondary"
              className="min-h-0 px-3 py-2 text-xs"
              disabled={loading || exporting !== null}
              onClick={() => void runExport(kind)}
            >
              <span className="flex items-center gap-2">
                <IconDownload size={14} />
                {exporting === kind ? "Exporting…" : kind}
              </span>
            </Button>
          ))}
        </div>
      </Card>
    </div>
  );
}
