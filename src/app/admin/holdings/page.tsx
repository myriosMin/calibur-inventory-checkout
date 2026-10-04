"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import EmptyState from "@/components/admin/EmptyState";
import InfoTip from "@/components/admin/InfoTip";
import PageHeader from "@/components/admin/PageHeader";
import Segmented from "@/components/admin/Segmented";
import Skeleton, { TableSkeleton } from "@/components/admin/Skeleton";
import StatusPill from "@/components/admin/StatusPill";
import BarList from "@/components/admin/charts/BarList";
import ProportionBar from "@/components/admin/charts/ProportionBar";
import { IconChevronDown, IconSearch } from "@/components/ui/icons";
import { useHolders, useHoldings, useProducts } from "@/lib/admin/queries";
import { toSegments, topN } from "@/lib/reports/chart-data";

import { countNegativeLines, groupHoldingsByHolder, PSEUDO_HOLDER_KINDS, type HoldingLine } from "./group";

type KindFilter = "all" | "store" | "robot" | "member" | "pseudo";

function kindOf(kind: string): Exclude<KindFilter, "all"> {
  if (kind === "consumed" || kind === "adjustment") return "pseudo";
  return kind as Exclude<KindFilter, "all">;
}

const KIND_LABEL: Record<Exclude<KindFilter, "all">, string> = {
  store: "Store",
  robot: "Robots",
  member: "Members",
  pseudo: "Consumed / adjustment",
};

/** Qty is flagged red only for real holders; see PSEUDO_HOLDER_KINDS. */
function columnsFor(flagNegatives: boolean): Column<HoldingLine>[] {
  return [
  {
    key: "product",
    header: "Product",
    render: (line) => (
      <span className="flex items-center gap-2">
        <span className="text-neutral-100">{line.productName}</span>
        {line.expensive ? <StatusPill tone="warning">expensive</StatusPill> : null}
      </span>
    ),
  },
  { key: "tier", header: "Tier", render: (line) => <span className="text-neutral-500">{line.tier}</span> },
  {
    key: "qty",
    header: "Qty",
    className: "text-right tabular-nums",
    render: (line) =>
      line.qty < 0 && flagNegatives ? (
        <StatusPill tone="danger">
          {line.qty} {line.unit}
        </StatusPill>
      ) : (
        <span className="text-neutral-100">
          {line.qty} <span className="text-neutral-500">{line.unit}</span>
        </span>
      ),
  },
];
}

const REAL_COLUMNS = columnsFor(true);
const PSEUDO_COLUMNS = columnsFor(false);

/**
 * /admin/holdings -- "where did our motors end up".
 *
 * The spreadsheet answered this with a free-text remarks cell ("15 darknus,
 * 7 hero, 6 standard…") that someone maintained by hand; here it is a
 * `group by holder_id` over the derived `holdings` view, which is just the
 * movement ledger summed.
 *
 * Names are joined in TypeScript because `holdings` is a view over a union
 * with no declared foreign keys, so PostgREST can't embed. All three reads
 * page past the 1000-row cap (src/lib/admin/queries.ts); before they did,
 * this page silently dropped the 1001st holding line.
 */
export default function AdminHoldingsPage() {
  return (
    <Suspense fallback={<TableSkeleton />}>
      <Holdings />
    </Suspense>
  );
}

function Holdings() {
  const params = useSearchParams();
  const holdingsQ = useHoldings();
  const holdersQ = useHolders();
  const productsQ = useProducts();

  const [kindFilter, setKindFilter] = useState<KindFilter>("all");
  const [holderFilter, setHolderFilter] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [negativesOnly, setNegativesOnly] = useState(params.get("negatives") === "1");
  // Expensive items (0028) are the ones to account for; the dashboard links here as ?expensive=1.
  const [expensiveOnly, setExpensiveOnly] = useState(params.get("expensive") === "1");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const loading = holdingsQ.isLoading || holdersQ.isLoading || productsQ.isLoading;
  const error = (holdingsQ.error ?? holdersQ.error ?? productsQ.error) as Error | undefined;

  const allGroups = useMemo(
    () => groupHoldingsByHolder(holdingsQ.data ?? [], holdersQ.data ?? [], productsQ.data ?? []),
    [holdingsQ.data, holdersQ.data, productsQ.data],
  );
  const totalNegatives = useMemo(() => countNegativeLines(allGroups), [allGroups]);

  const kindCounts = useMemo(() => {
    const counts: Record<KindFilter, number> = { all: allGroups.length, store: 0, robot: 0, member: 0, pseudo: 0 };
    for (const group of allGroups) counts[kindOf(group.holder.kind)] += 1;
    return counts;
  }, [allGroups]);

  // Where stock is *now*: consumed/adjustment are where it went, not where it is.
  const unitsByKind = useMemo(() => {
    const units = { store: 0, robot: 0, member: 0 };
    for (const group of allGroups) {
      const kind = kindOf(group.holder.kind);
      if (kind === "store" || kind === "robot" || kind === "member") units[kind] += Math.max(0, group.totalUnits);
    }
    return toSegments([
      { key: "store", label: "Store", value: units.store },
      { key: "robot", label: "Robots", value: units.robot },
      { key: "member", label: "Members", value: units.member },
    ]).map((segment) => ({ ...segment, slot: { store: 1, robot: 2, member: 3 }[segment.key] ?? 1 }));
  }, [allGroups]);

  const topHolders = useMemo(
    () =>
      topN(
        allGroups.filter((group) => ["robot", "member"].includes(group.holder.kind)),
        8,
        (group) => group.productCount,
      ),
    [allGroups],
  );

  const visibleGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allGroups
      .filter((group) => kindFilter === "all" || kindOf(group.holder.kind) === kindFilter)
      .filter((group) => !holderFilter || group.holder.id === holderFilter)
      .map((group) => ({
        ...group,
        lines: group.lines.filter(
          (line) =>
            (!negativesOnly || (line.qty < 0 && group.negativeCount > 0)) &&
            (!expensiveOnly || line.expensive) &&
            (needle.length === 0 ||
              line.productName.toLowerCase().includes(needle) ||
              group.holder.name.toLowerCase().includes(needle)),
        ),
      }))
      .filter((group) => group.lines.length > 0);
  }, [allGroups, kindFilter, holderFilter, search, negativesOnly, expensiveOnly]);

  const filtering = search.trim().length > 0 || negativesOnly || expensiveOnly || holderFilter !== null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Who holds what"
        description="Current balance per holder, summed from the movement ledger."
        info="This is the spreadsheet's free-text allocation remark (“15 darknus, 7 hero…”) as real data: every borrow, return and count is a movement between holders, and these balances are those movements added up."
      />

      {error ? <p className="text-sm text-red-400">{error.message}</p> : null}

      <div className="grid gap-6 lg:grid-cols-5">
        <Card title="Where stock is now" subtitle="Units held, all kinds of part" className="lg:col-span-2">
          {loading ? <Skeleton className="h-20 w-full" /> : <ProportionBar segments={unitsByKind} emptyMessage="Nothing is held anywhere yet." />}
        </Card>
        <Card
          title="Most held outside the store"
          subtitle="Products per robot or member. Click one to filter."
          className="lg:col-span-3"
        >
          {loading ? (
            <Skeleton className="h-32 w-full" />
          ) : topHolders.shown.length === 0 ? (
            <p className="text-sm text-neutral-500">Nothing is out with a robot or member.</p>
          ) : (
            <BarList
              ariaLabel="Holders with the most products"
              selected={holderFilter}
              onSelect={(key) => setHolderFilter((current) => (current === key ? null : key))}
              items={topHolders.shown.map((group) => ({
                key: group.holder.id,
                label: (
                  <>
                    {group.holder.name}
                    <span className="ml-2 text-xs text-neutral-500">{group.holder.kind}</span>
                  </>
                ),
                value: group.productCount,
              }))}
            />
          )}
        </Card>
      </div>

      {/* One filter row: kind chips, search, and the negatives toggle. */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <Segmented
          ariaLabel="Holder kind"
          value={kindFilter}
          onChange={(value) => {
            setKindFilter(value);
            setHolderFilter(null);
          }}
          options={(["all", "store", "robot", "member", "pseudo"] as const).map((value) => ({
            value,
            label: value === "all" ? "All" : KIND_LABEL[value],
            count: kindCounts[value],
          }))}
        />
        <div className="flex items-center gap-2">
          <label className="relative block">
            <span className="sr-only">Filter by product or holder</span>
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Product or holder…"
              className="min-h-9 w-full rounded-lg border border-neutral-800 bg-neutral-900/60 pl-9 pr-3 text-sm text-neutral-100 placeholder:text-neutral-600 sm:w-56"
            />
          </label>
          <button
            type="button"
            aria-pressed={expensiveOnly}
            onClick={() => setExpensiveOnly((value) => !value)}
            title="Only expensive items (S$20+, or critical with no price)"
            className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
              expensiveOnly
                ? "border-amber-500/50 bg-amber-500/10 text-amber-300"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
            }`}
          >
            Expensive only
          </button>
          {totalNegatives > 0 ? (
            <span className="flex items-center gap-1">
              <button
                type="button"
                aria-pressed={negativesOnly}
                onClick={() => setNegativesOnly((value) => !value)}
                className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
                  negativesOnly
                    ? "border-red-500/50 bg-red-500/10 text-red-300"
                    : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
                }`}
              >
                Negative <span className="tabular-nums text-red-400">{totalNegatives}</span>
              </button>
              <InfoTip label="Why balances go negative">
                <p>
                  Borrows are never blocked on stock, so a negative balance is a data-quality signal, not a loss.
                  Nearly always the opening balance was never recorded: the part was on the shelf before the
                  system knew about it.
                </p>
                <p>
                  Fix it by recording what was received on{" "}
                  <Link href="/admin/restock" className="text-red-400 hover:text-red-300">
                    Restock
                  </Link>
                  , or by counting the shelf.
                </p>
              </InfoTip>
            </span>
          ) : null}
        </div>
      </div>

      {loading ? (
        <Card padded={false}>
          <TableSkeleton />
        </Card>
      ) : visibleGroups.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            message={
              allGroups.length === 0
                ? "Nothing is held anywhere yet. Record what is on the shelves on Restock."
                : "No holdings match these filters."
            }
          />
        </Card>
      ) : (
        <ul className="flex flex-col gap-2">
          {visibleGroups.map((group) => {
            // Open by default: the store (what everyone came to see), anything
            // with a negative line, and every match while filtering.
            const isOpen =
              expanded[group.holder.id] ??
              (filtering || group.holder.kind === "store" || group.negativeCount > 0);
            return (
              <li key={group.holder.id} className="overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900/60">
                <button
                  type="button"
                  aria-expanded={isOpen}
                  onClick={() => setExpanded((prev) => ({ ...prev, [group.holder.id]: !isOpen }))}
                  className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-800/30"
                >
                  <IconChevronDown
                    size={16}
                    className={`shrink-0 text-neutral-500 transition-transform ${isOpen ? "" : "-rotate-90"}`}
                  />
                  <span className="min-w-0 flex-1 truncate font-medium text-neutral-100">{group.holder.name}</span>
                  <span className="hidden text-xs text-neutral-500 sm:inline">{group.holder.kind}</span>
                  {group.negativeCount > 0 ? <StatusPill tone="danger">{group.negativeCount} negative</StatusPill> : null}
                  <span className="w-32 shrink-0 text-right text-sm tabular-nums text-neutral-400">
                    {group.lines.length} {group.lines.length === 1 ? "product" : "products"}
                  </span>
                </button>
                {isOpen ? (
                  <div className="border-t border-neutral-800">
                    <DataTable
                      columns={PSEUDO_HOLDER_KINDS.has(group.holder.kind) ? PSEUDO_COLUMNS : REAL_COLUMNS}
                      rows={group.lines}
                      rowKey={(line) => line.productId}
                      rowHref={(line) => `/admin/products/${line.productId}`}
                      pageSize={25}
                    />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
