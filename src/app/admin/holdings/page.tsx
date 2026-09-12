"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import DataTable, { type Column } from "@/components/admin/DataTable";
import EmptyState from "@/components/admin/EmptyState";
import PageHeader from "@/components/admin/PageHeader";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import { getBrowserClient } from "@/lib/supabase/browser";

import {
  countNegativeLines,
  groupHoldingsByHolder,
  type HolderRef,
  type HoldingLine,
  type HoldingRow,
  type ProductRef,
} from "./group";

const KIND_FILTERS = [
  { value: "", label: "All holders" },
  { value: "store", label: "Store" },
  { value: "robot", label: "Robots" },
  { value: "member", label: "Members" },
  { value: "pseudo", label: "Consumed / adjustment" },
] as const;

type KindFilter = (typeof KIND_FILTERS)[number]["value"];

function matchesKindFilter(kind: string, filter: KindFilter): boolean {
  if (filter === "") return true;
  if (filter === "pseudo") return kind === "consumed" || kind === "adjustment";
  return kind === filter;
}

/**
 * /admin/holdings -- "where did our motors end up".
 *
 * This is the question data-model.md opens with. The spreadsheet answered it
 * with a free-text remarks cell ("15 darknus, 7 hero, 6 standard…") that
 * someone maintained by hand; here it is a `group by holder_id` over the
 * derived `holdings` view, which is just the movement ledger summed.
 *
 * The join to product and holder names happens in TypeScript rather than in
 * PostgREST because `holdings` is a view over a union with no declared
 * foreign keys, so it supports no embeds. Both other relations are small
 * enough to fetch whole.
 */
export default function AdminHoldingsPage() {
  const supabase = useMemo(() => getBrowserClient(), []);

  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [holders, setHolders] = useState<HolderRef[]>([]);
  const [products, setProducts] = useState<ProductRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [kindFilter, setKindFilter] = useState<KindFilter>("");
  const [search, setSearch] = useState("");
  const [negativesOnly, setNegativesOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadError(null);
      const [holdingsRes, holdersRes, productsRes] = await Promise.all([
        supabase.from("holdings").select("product_id, holder_id, qty"),
        supabase.from("holders").select("id, name, kind").order("name"),
        supabase.from("products").select("id, name, unit, tier"),
      ]);
      if (cancelled) return;

      const firstError =
        holdingsRes.error ?? holdersRes.error ?? productsRes.error ?? null;
      if (firstError) {
        setLoadError(firstError.message);
      } else {
        setRows(holdingsRes.data ?? []);
        setHolders(holdersRes.data ?? []);
        setProducts(productsRes.data ?? []);
      }
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  const allGroups = useMemo(
    () => groupHoldingsByHolder(rows, holders, products),
    [rows, holders, products],
  );

  const totalNegatives = useMemo(
    () => countNegativeLines(allGroups),
    [allGroups],
  );

  const visibleGroups = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return allGroups
      .filter((group) => matchesKindFilter(group.holder.kind, kindFilter))
      .map((group) => ({
        ...group,
        lines: group.lines.filter(
          (line) =>
            (!negativesOnly || line.qty < 0) &&
            (needle.length === 0 ||
              line.productName.toLowerCase().includes(needle)),
        ),
      }))
      .filter((group) => group.lines.length > 0);
  }, [allGroups, kindFilter, search, negativesOnly]);

  const columns: Column<HoldingLine>[] = [
    {
      key: "product",
      header: "Product",
      render: (line) => (
        <span className="text-neutral-100">{line.productName}</span>
      ),
    },
    { key: "tier", header: "Tier", render: (line) => line.tier },
    {
      key: "qty",
      header: "Qty",
      className: "text-right tabular-nums",
      render: (line) =>
        line.qty < 0 ? (
          <StatusPill tone="danger">
            {line.qty} {line.unit}
          </StatusPill>
        ) : (
          <span className="text-neutral-100">
            {line.qty} {line.unit}
          </span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Holdings"
        description="Current balance per holder, derived from the movement ledger. This is the spreadsheet's free-text allocation remark, as real data."
      />

      {!loading && !loadError && totalNegatives > 0 ? (
        <Card title="Negative balances">
          <p className="text-sm text-neutral-100">
            <StatusPill tone="danger">{totalNegatives} negative</StatusPill>{" "}
            <span className="ml-1">
              {totalNegatives === 1 ? "line is" : "lines are"} below zero.
            </span>
          </p>
          <p className="mt-2 text-sm text-neutral-400">
            Borrows are deliberately never blocked on insufficient stock, so a
            negative balance is expected and is a <strong>data-quality
            signal</strong>, not a sign anything went missing. Nearly always it
            means the opening balance was never recorded — the part was on the
            shelf before the system knew about it, and the first borrow took it
            below zero. Fix it by recording what was actually received on{" "}
            <Link
              href="/admin/restock"
              className="font-medium text-red-400 hover:text-red-300"
            >
              Restock
            </Link>
            , or by counting the shelf at a stocktake.
          </p>
        </Card>
      ) : null}

      <Card title="Filters">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm text-neutral-200">
            Holder kind
            <select
              value={kindFilter}
              onChange={(e) => setKindFilter(e.target.value as KindFilter)}
              className="min-h-11 rounded-lg border border-neutral-700 px-3 text-base"
            >
              {KIND_FILTERS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-neutral-200">
            Product
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by product name…"
              className="min-h-11 rounded-lg border border-neutral-700 px-3 text-base text-neutral-100"
            />
          </label>

          <label className="flex items-center gap-2 self-end text-sm text-neutral-200">
            <input
              type="checkbox"
              checked={negativesOnly}
              onChange={(e) => setNegativesOnly(e.target.checked)}
              className="h-4 w-4"
            />
            Negative balances only
          </label>
        </div>
      </Card>

      {loading ? (
        <Card>
          <p className="text-sm text-neutral-400">Loading…</p>
        </Card>
      ) : loadError ? (
        <Card>
          <p className="text-sm text-red-400">{loadError}</p>
        </Card>
      ) : visibleGroups.length === 0 ? (
        <Card padded={false}>
          <EmptyState
            message={
              allGroups.length === 0
                ? "Nothing is held anywhere yet — the ledger has no movements. Record what is on the shelves on Restock."
                : "No holdings match these filters."
            }
          />
        </Card>
      ) : (
        visibleGroups.map((group) => {
          // Default open: the store (what everyone came to see) and anything
          // with a negative line (the thing worth acting on). Everything else
          // starts folded so a page with 20 robots is still scannable.
          const isCollapsed =
            collapsed[group.holder.id] ??
            !(group.holder.kind === "store" || group.negativeCount > 0);
          return (
            <Card
              key={group.holder.id}
              padded={false}
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {group.holder.name}
                  <StatusPill tone="inactive">{group.holder.kind}</StatusPill>
                  {group.negativeCount > 0 ? (
                    <StatusPill tone="danger">
                      {group.negativeCount} negative
                    </StatusPill>
                  ) : null}
                </span>
              }
              actions={
                <>
                  <span className="text-xs text-neutral-400">
                    {group.lines.length}{" "}
                    {group.lines.length === 1 ? "product" : "products"} ·{" "}
                    {group.totalUnits} units
                  </span>
                  <Button
                    variant="secondary"
                    className="min-h-0 px-2 py-1 text-xs"
                    onClick={() =>
                      setCollapsed((prev) => ({
                        ...prev,
                        [group.holder.id]: !isCollapsed,
                      }))
                    }
                  >
                    {isCollapsed ? "Show" : "Hide"}
                  </Button>
                </>
              }
            >
              {isCollapsed ? null : (
                <DataTable
                  columns={columns}
                  rows={group.lines}
                  rowKey={(line) => line.productId}
                />
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}
