"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import useSWR from "swr";

import ActionMenu from "@/components/admin/ActionMenu";
import Card from "@/components/admin/Card";
import PageHeader from "@/components/admin/PageHeader";
import Skeleton from "@/components/admin/Skeleton";
import StatCard from "@/components/admin/StatCard";
import BarList from "@/components/admin/charts/BarList";
import DivergingBarList from "@/components/admin/charts/DivergingBarList";
import { DailyStackedBar } from "@/components/admin/charts/lazy";
import ProportionBar from "@/components/admin/charts/ProportionBar";
import Sparkline from "@/components/admin/charts/Sparkline";
import { IconAlert, IconCheck, IconChevronRight, IconDownload } from "@/components/ui/icons";
import Toast from "@/components/ui/Toast";
import {
  toReportProducts,
  toScanCodeRefs,
  toStockCountRows,
  useLocations,
  useNavBadges,
  useProducts,
  useScanCodes,
  useStockCounts,
  useStockLevels,
} from "@/lib/admin/queries";
import { entryMethodBreakdown, formatRatio, sessionsPerDay, summariseScanMisses } from "@/lib/reports/activity";
import {
  SESSION_MODE_SERIES,
  seriesPresent,
  toDailySeries,
  toSegments,
} from "@/lib/reports/chart-data";
import { computeLabelHealth, needsAttention } from "@/lib/reports/label-health";
import { fetchEntriesSince, fetchScanMissesSince, fetchSessionsSince } from "@/lib/reports/queries";
import { classifyStockLevels } from "@/lib/reports/stock";
import { getBrowserClient } from "@/lib/supabase/browser";

import { runExport, type ExportKind } from "./dashboard-export";
import { summariseByLocation, summariseByProduct } from "./stocktake/variance";
import { formatVariance } from "./stocktake/walk";

// ---------------------------------------------------------------------------
// The /admin dashboard: architecture.md §Observability's "minimum useful
// set", plus label health and the CSV export.
//
// Every number comes from src/lib/reports/*, the same modules the nightly
// cron uses, so the dashboard and the bot can't drift apart on what "low
// stock" means. Each read is its own SWR key, so a tile renders as soon as
// its own data lands instead of waiting for the slowest read (90 days of
// movements), and the reference lists are shared with every other page.
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
const LOW_STOCK_SHOWN = 8;

/** Fixed palette slots, so each entry method keeps its colour whatever is present. */
const SCAN_SLOTS: Record<string, number> = { scan: 1, group: 2, search: 3 };

function isoDaysAgo(days: number): string {
  // Rounded to the hour so the SWR key (and the query) is stable across renders.
  const at = new Date(Date.now() - days * DAY_MS);
  at.setMinutes(0, 0, 0);
  return at.toISOString();
}

interface Feedback {
  variant: "success" | "error";
  message: string;
}

export default function DashboardClient() {
  const supabase = getBrowserClient();
  const activitySince = isoDaysAgo(ACTIVITY_DAYS);
  const labelSince = isoDaysAgo(LABEL_WINDOW_DAYS);

  const sessionsQ = useSWR(["dash/sessions", activitySince], () => fetchSessionsSince(supabase, activitySince));
  const entriesQ = useSWR(["dash/entries", labelSince], () => fetchEntriesSince(supabase, labelSince));
  const missesQ = useSWR(["dash/misses", labelSince], () => fetchScanMissesSince(supabase, labelSince));
  const badgesQ = useNavBadges();
  const levelsQ = useStockLevels();
  const productsQ = useProducts();
  const codesQ = useScanCodes();
  const countsQ = useStockCounts();
  const locationsQ = useLocations();

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [exporting, setExporting] = useState<ExportKind | null>(null);

  const firstError = [sessionsQ, entriesQ, missesQ, badgesQ, levelsQ, productsQ, codesQ, countsQ, locationsQ].find(
    (q) => q.error,
  )?.error as Error | undefined;

  // -------------------------------------------------------------------------
  // Derived views. All pure, all from src/lib/reports/*.
  // -------------------------------------------------------------------------
  const daily = useMemo(
    () => sessionsPerDay(sessionsQ.data ?? [], { days: ACTIVITY_DAYS, now: new Date() }),
    [sessionsQ.data],
  );
  const activity = useMemo(() => toDailySeries(daily, SESSION_MODE_SERIES), [daily]);
  const activitySeries = useMemo(() => {
    const present = seriesPresent(activity, SESSION_MODE_SERIES);
    return present.length > 0 ? present : SESSION_MODE_SERIES.slice(0, 2);
  }, [activity]);
  const sessionTotal = daily.reduce((sum, row) => sum + row.total, 0);

  const breakdown = useMemo(() => entryMethodBreakdown(entriesQ.data ?? []), [entriesQ.data]);
  const missGroups = useMemo(() => summariseScanMisses(missesQ.data ?? []), [missesQ.data]);
  const stock = useMemo(() => classifyStockLevels(levelsQ.data ?? []), [levelsQ.data]);
  const productsOut = useMemo(() => (levelsQ.data ?? []).filter((row) => row.qtyOut > 0), [levelsQ.data]);
  const reportProducts = useMemo(() => toReportProducts(productsQ.data ?? []), [productsQ.data]);

  const labelProblems = useMemo(() => {
    if (!entriesQ.data || !codesQ.data) return [];
    return needsAttention(
      computeLabelHealth(
        entriesQ.data.map((entry) => ({ productId: entry.productId, entryMethod: entry.entryMethod })),
        // locationId is what gives a shelf's group sticker credit for every
        // product on it -- without it the whole resistor book reads as
        // "no active label".
        reportProducts.map((p) => ({ id: p.id, name: p.name, tier: p.tier, active: p.active, locationId: p.locationId })),
        toScanCodeRefs(codesQ.data),
      ),
    );
  }, [entriesQ.data, codesQ.data, reportProducts]);

  const locationVariance = useMemo(
    () =>
      summariseByLocation(
        summariseByProduct(
          toStockCountRows(countsQ.data ?? []),
          reportProducts.map((p) => ({ id: p.id, name: p.name, locationId: p.locationId })),
          locationsQ.data ?? [],
        ),
      ),
    [countsQ.data, reportProducts, locationsQ.data],
  );

  const scanSegments = useMemo(
    () =>
      toSegments([
        { key: "scan", label: "Scanned", value: breakdown.scan },
        { key: "group", label: "Shelf sticker", value: breakdown.groupPick },
        { key: "search", label: "Searched", value: breakdown.search },
      ]).map((segment) => ({ ...segment, slot: SCAN_SLOTS[segment.key] ?? 1 })),
    [breakdown],
  );

  const bindQueue = badgesQ.data?.bindQueue ?? 0;
  const openReview = badgesQ.data?.openReview ?? 0;

  const attention = [
    {
      key: "bind",
      count: bindQueue,
      label: bindQueue === 1 ? "Telegram user waiting to be linked" : "Telegram users waiting to be linked",
      href: "/admin/bind-queue",
      tone: "warning" as const,
    },
    {
      key: "negative",
      count: stock.negative.length,
      label: `${stock.negative.length === 1 ? "product reads" : "products read"} below zero in the store (opening balance never recorded)`,
      href: "/admin/holdings?negatives=1",
      tone: "danger" as const,
    },
    {
      key: "labels",
      count: labelProblems.length,
      label: `${labelProblems.length === 1 ? "label looks" : "labels look"} missing or damaged (mostly reached by search)`,
      href: "/admin/labels",
      tone: "warning" as const,
    },
    {
      key: "misses",
      count: missGroups.length,
      label: `unknown or retired ${missGroups.length === 1 ? "code" : "codes"} scanned in ${LABEL_WINDOW_DAYS} days`,
      href: "/admin/scan-codes",
      tone: "warning" as const,
    },
  ];
  const attentionLoading = badgesQ.isLoading || levelsQ.isLoading || entriesQ.isLoading || missesQ.isLoading;
  const attentionItems = attention.filter((item) => item.count > 0);

  const handleExport = async (kind: ExportKind) => {
    setExporting(kind);
    setFeedback(null);
    try {
      const filename = await runExport(kind, {
        supabase,
        products: reportProducts,
        levels: levelsQ.data ?? [],
        codes: toScanCodeRefs(codesQ.data ?? []),
        locations: locationsQ.data ?? [],
      });
      setFeedback({ variant: "success", message: `Downloaded ${filename}.` });
    } catch (error) {
      setFeedback({ variant: "error", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setExporting(null);
    }
  };

  const exportReady = !!productsQ.data && !!levelsQ.data && !!codesQ.data && !!locationsQ.data;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Dashboard"
        description="What needs attention, and how the store is being used."
        actions={
          <ActionMenu
            label={exporting ? "Exporting…" : "Export"}
            icon={<IconDownload size={15} className="text-neutral-400" />}
            items={[
              { label: "Catalog", hint: "What parts exist", onSelect: () => void handleExport("catalog"), disabled: !exportReady || !!exporting },
              { label: "Holdings", hint: "Where they are right now", onSelect: () => void handleExport("holdings"), disabled: !exportReady || !!exporting },
              { label: "Movements", hint: "The full ledger", onSelect: () => void handleExport("movements"), disabled: !exportReady || !!exporting },
            ]}
          />
        }
      />

      {feedback ? <Toast variant={feedback.variant} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}
      {firstError ? <Toast variant="error" message={firstError.message} /> : null}

      {/* KPIs: four numbers, coloured only when they need someone. */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Open review items"
          value={openReview}
          tone={openReview > 0 ? "warning" : undefined}
          hint={openReview > 0 ? "Catalog questions to settle" : "Nothing to review"}
          href="/admin/review"
          loading={badgesQ.isLoading}
        />
        <StatCard
          label="Low stock"
          value={stock.low.length}
          tone={stock.low.length > 0 ? "warning" : undefined}
          hint="Below their minimum"
          href="/admin/products?stock=low"
          loading={levelsQ.isLoading}
        />
        <StatCard
          label="Parts out"
          value={productsOut.length}
          hint="Products with stock outside the store"
          href="/admin/holdings"
          loading={levelsQ.isLoading}
        />
        <StatCard
          label={`Sessions, ${ACTIVITY_DAYS} days`}
          value={sessionTotal}
          hint={sessionTotal === 0 ? "Quiet fortnight" : undefined}
          loading={sessionsQ.isLoading}
        >
          {sessionTotal > 0 ? (
            <Sparkline values={daily.map((d) => d.total)} label={`Sessions per day over ${ACTIVITY_DAYS} days`} />
          ) : null}
        </StatCard>
      </div>

      {/* Needs attention: only what is non-zero, each one click from its fix. */}
      <Card title="Needs attention">
        {attentionLoading ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-5 w-1/2" />
          </div>
        ) : attentionItems.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-neutral-400">
            <IconCheck size={16} className="text-green-400" />
            All clear. No queue, no negative balances, no labels to reprint.
          </p>
        ) : (
          <ul className="-mx-2 flex flex-col">
            {attentionItems.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-neutral-800/50"
                >
                  <IconAlert size={16} className={item.tone === "danger" ? "text-red-400" : "text-amber-400"} />
                  <span className="text-sm text-neutral-300">
                    <span className="font-semibold tabular-nums text-neutral-100">{item.count}</span> {item.label}
                  </span>
                  <IconChevronRight size={16} className="ml-auto text-neutral-600 group-hover:text-neutral-300" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card
          title="Activity"
          subtitle={`Sessions per day by mode, last ${ACTIVITY_DAYS} days`}
          className="lg:col-span-2"
        >
          {sessionsQ.isLoading ? (
            <Skeleton className="h-[248px] w-full" />
          ) : sessionTotal === 0 ? (
            <p className="py-10 text-center text-sm text-neutral-500">
              No borrows, returns or counts in the last {ACTIVITY_DAYS} days.
            </p>
          ) : (
            <DailyStackedBar data={activity} series={activitySeries} unit="sessions" />
          )}
        </Card>

        <Card
          title="Scan vs search"
          subtitle={`Member entries, last ${LABEL_WINDOW_DAYS} days`}
          info={
            <>
              <p>
                How members reached each part. A shelf sticker counts as a scan: the member did scan a label, just
                the shelf&apos;s rather than the part&apos;s.
              </p>
              <p>
                Restock and stocktake entries are left out: nobody walked to a shelf, so they say nothing about the
                labels. A product consistently reached by search almost certainly has a missing or damaged sticker.
              </p>
            </>
          }
        >
          {entriesQ.isLoading ? (
            <Skeleton className="h-28 w-full" />
          ) : (
            <div className="flex flex-col gap-4">
              <p>
                <span className="font-display text-3xl font-semibold tabular-nums text-neutral-100">
                  {formatRatio(breakdown.scanRatio)}
                </span>
                <span className="ml-2 text-sm text-neutral-400">reached by scan</span>
              </p>
              <ProportionBar segments={scanSegments} emptyMessage="No member entries in this window yet." />
              {labelProblems.length > 0 ? (
                <Link href="/admin/labels" className="text-sm text-neutral-400 underline-offset-4 hover:text-neutral-100 hover:underline">
                  {labelProblems.length} label{labelProblems.length === 1 ? "" : "s"} to reprint →
                </Link>
              ) : null}
            </div>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card
          title="Low stock"
          subtitle="In store against each product's minimum"
          actions={
            stock.low.length > LOW_STOCK_SHOWN ? (
              <Link href="/admin/products?stock=low" className="text-sm text-neutral-400 hover:text-neutral-100">
                All {stock.low.length} →
              </Link>
            ) : null
          }
        >
          {levelsQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : stock.low.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing is below its minimum.</p>
          ) : (
            <BarList
              barClass="bg-status-warning"
              ariaLabel="Low stock products"
              items={stock.low.slice(0, LOW_STOCK_SHOWN).map((row) => ({
                key: row.productId,
                label: row.name,
                value: row.qtyInStore,
                target: row.minStock ?? undefined,
                display: (
                  <>
                    {row.qtyInStore}
                    <span className="text-neutral-500"> / {row.minStock}</span>
                  </>
                ),
                href: `/admin/products/${row.productId}`,
              }))}
            />
          )}
        </Card>

        <Card
          title="Stocktake variance"
          subtitle="Net drift at the last count, by location"
          info="Counted minus expected, summed over each location's products at their most recent count. Blue is more on the shelf than the ledger says; red is less. A diagnostic, not an accusation."
          actions={
            <Link href="/admin/stocktake/variance" className="text-sm text-neutral-400 hover:text-neutral-100">
              Full report →
            </Link>
          }
        >
          {countsQ.isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : locationVariance.length === 0 ? (
            <p className="text-sm text-neutral-500">No shelf has been counted yet.</p>
          ) : (
            <DivergingBarList
              items={locationVariance.slice(0, 8).map((row) => ({
                key: row.locationId ?? "unassigned",
                label: row.locationName,
                value: row.netVariance,
                display: formatVariance(row.netVariance),
              }))}
            />
          )}
        </Card>
      </div>
    </div>
  );
}
