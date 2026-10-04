"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import EmptyState from "@/components/admin/EmptyState";
import PageHeader from "@/components/admin/PageHeader";
import Segmented from "@/components/admin/Segmented";
import { TableSkeleton } from "@/components/admin/Skeleton";
import StatCard from "@/components/admin/StatCard";
import { type BuildListLineRow, useBuildListLines, useBuildLists, useProducts, useStockLevels } from "@/lib/admin/queries";

import { buildTotals, formatSgd, groupBySection, inStoreFor, isShort, lineCost } from "./build-summary";

/**
 * The season's robot build lists (migration 0027, loaded from the build
 * budget spreadsheet by scripts/import-build-lists.ts). A plan, not stock:
 * nothing here moves anything. Parts that arrive go in through Restock.
 */
export default function AdminBuildsPage() {
  const listsQ = useBuildLists();
  const linesQ = useBuildListLines();
  const productsQ = useProducts();
  const stockQ = useStockLevels();
  const [selected, setSelected] = useState<string | null>(null);

  const lists = useMemo(() => listsQ.data ?? [], [listsQ.data]);
  const current = lists.find((l) => l.id === selected) ?? lists[0] ?? null;
  const productNames = useMemo(() => new Map((productsQ.data ?? []).map((p) => [p.id, p.name])), [productsQ.data]);
  const inStore = useMemo(
    () => new Map((stockQ.data ?? []).map((row) => [row.productId, row.qtyInStore])),
    [stockQ.data],
  );
  const lines = useMemo(
    () => (linesQ.data ?? []).filter((line) => line.build_list_id === current?.id),
    [linesQ.data, current?.id],
  );
  const totals = useMemo(() => buildTotals(lines, inStore), [lines, inStore]);
  const groups = useMemo(() => groupBySection(lines), [lines]);
  const loading = listsQ.isLoading || linesQ.isLoading;
  const loadError = ((listsQ.error ?? linesQ.error) as Error | undefined)?.message;

  const columns: Column<BuildListLineRow>[] = [
    {
      key: "part",
      header: "Part",
      render: (line) => (
        <div className="min-w-48 max-w-md">
          <p className="text-neutral-100">{line.part_name}</p>
          <p className="text-xs text-neutral-500">
            {[line.category, line.product_id ? productNames.get(line.product_id) : null].filter(Boolean).join(" · ") || "—"}
          </p>
          {line.notes ? <p className="mt-0.5 text-xs text-amber-400/80">{line.notes}</p> : null}
        </div>
      ),
    },
    {
      key: "qty",
      header: "Qty",
      className: "text-right tabular-nums",
      render: (line) => line.qty ?? "TBD",
    },
    {
      key: "price",
      header: "Unit",
      className: "text-right tabular-nums whitespace-nowrap",
      render: (line) =>
        line.sourcing === "referee_kit" ? (
          <span className="text-neutral-500">Referee kit</span>
        ) : line.unit_price_sgd === null ? (
          "—"
        ) : (
          formatSgd(line.unit_price_sgd)
        ),
    },
    {
      key: "cost",
      header: "Subtotal",
      className: "text-right tabular-nums whitespace-nowrap",
      render: (line) => {
        const cost = lineCost(line);
        return cost === null ? "—" : formatSgd(cost);
      },
    },
    {
      key: "store",
      header: "In store",
      className: "text-right tabular-nums",
      render: (line) => {
        const have = inStoreFor(line, inStore);
        if (have === null) return <span className="text-neutral-600">—</span>;
        return (
          <Link
            href={`/admin/products/${line.product_id}`}
            className={`underline-offset-2 hover:underline ${isShort(line, inStore) ? "text-amber-400" : "text-neutral-200"}`}
          >
            {have}
          </Link>
        );
      },
    },
    {
      key: "supplier",
      header: "Supplier",
      render: (line) =>
        line.supplier_url ? (
          <a
            href={line.supplier_url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-sky-400 underline-offset-2 hover:underline"
          >
            {line.supplier ?? "Link"}
          </a>
        ) : (
          (line.supplier ?? "—")
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Builds"
        description={current ? `${current.season} parts list for ${current.name}.` : "Robot build lists."}
        info={
          <>
            <p>What each robot of the season needs, from the build budget spreadsheet.</p>
            <p>
              A plan, not stock: nothing here moves anything. &quot;In store&quot; is shown for parts linked to a store
              product, and is amber when the store holds fewer than the line needs. The same store stock may be counted
              against more than one build.
            </p>
          </>
        }
      />

      {lists.length > 1 ? (
        <Segmented
          ariaLabel="Build list"
          value={current?.id ?? ""}
          onChange={setSelected}
          options={lists.map((list) => ({ value: list.id, label: list.name }))}
        />
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Est. cost to buy"
          value={formatSgd(totals.estCostSgd)}
          hint={totals.unpriced ? `${totals.unpriced} line${totals.unpriced === 1 ? "" : "s"} still TBD` : undefined}
          loading={loading}
        />
        <StatCard label="Lines" value={totals.lines} hint={`${totals.refereeKit} from the referee kit`} loading={loading} />
        <StatCard label="Linked to store parts" value={totals.linked} loading={loading} />
        <StatCard
          label="Short in store"
          value={totals.short}
          tone={totals.short ? "warning" : undefined}
          hint="Linked lines needing more than the store holds"
          loading={loading || stockQ.isLoading}
        />
      </div>

      {loading ? (
        <Card padded={false}>
          <TableSkeleton />
        </Card>
      ) : loadError ? (
        <Card>
          <p className="text-sm text-red-400">{loadError}</p>
        </Card>
      ) : !current ? (
        <Card padded={false}>
          <EmptyState message="No build lists yet. Load one with scripts/import-build-lists.ts." />
        </Card>
      ) : (
        groups.map((group) => (
          <Card key={group.section} title={group.section} subtitle={`${group.lines.length} lines`} padded={false}>
            <DataTable columns={columns} rows={group.lines} rowKey={(line) => line.id} pageSize={Infinity} />
          </Card>
        ))
      )}
    </div>
  );
}
