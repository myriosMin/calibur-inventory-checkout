"use client";

import Link from "next/link";
import { useMemo } from "react";

import Skeleton from "@/components/admin/Skeleton";
import BarList from "@/components/admin/charts/BarList";
import { useHolders, useHoldings } from "@/lib/admin/queries";

const KIND_ORDER = ["store", "robot", "member", "consumed"];

/**
 * Where this product is, per the ledger. Read from the cached, paged
 * `holdings` and `holders` lists every stock page shares, so opening a
 * product costs no extra requests.
 *
 * Read-only on purpose: a wrong number is corrected by counting it in
 * Stocktake, which leaves a record of who counted what, not by typing over it.
 */
export default function HoldingsPanel({ productId, unit }: { productId: string; unit: string }) {
  const holdingsQ = useHoldings();
  const holdersQ = useHolders();

  const rows = useMemo(() => {
    const byId = new Map((holdersQ.data ?? []).map((h) => [h.id, h]));
    return (holdingsQ.data ?? [])
      .filter((h) => h.product_id === productId && h.holder_id)
      .flatMap((h) => {
        const holder = byId.get(h.holder_id!);
        if (!holder || holder.kind === "adjustment") return [];
        return [{ holderId: holder.id, name: holder.name, kind: holder.kind, qty: Number(h.qty ?? 0) }];
      })
      .sort(
        (a, b) =>
          KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.qty - a.qty || a.name.localeCompare(b.name),
      );
  }, [holdingsQ.data, holdersQ.data, productId]);

  if (holdingsQ.isLoading || holdersQ.isLoading) return <Skeleton className="h-24 w-full" />;
  const error = (holdingsQ.error ?? holdersQ.error) as Error | undefined;
  if (error) return <p className="text-sm text-red-400">{error.message}</p>;

  const sumKind = (kind: string) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.qty, 0);
  const tiles = [
    { label: "In store", value: sumKind("store") },
    { label: "On robots", value: sumKind("robot") },
    { label: "With members", value: sumKind("member") },
    { label: "Used up", value: sumKind("consumed") },
  ];
  const placed = rows.filter((r) => r.kind !== "consumed");

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-neutral-800 bg-neutral-800 sm:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="bg-neutral-900 px-3 py-2.5">
            <dt className="text-xs text-neutral-500">{tile.label}</dt>
            <dd className={`font-display text-xl font-semibold tabular-nums ${tile.value < 0 ? "text-red-400" : "text-neutral-100"}`}>
              {tile.value}
              <span className="ml-1 text-xs font-normal text-neutral-500">{unit}</span>
            </dd>
          </div>
        ))}
      </dl>
      {placed.length === 0 ? (
        <p className="text-sm text-neutral-500">Nothing on the ledger yet: no stock has been received, counted or imported.</p>
      ) : (
        <BarList
          ariaLabel="Holders of this product"
          items={placed.map((row) => ({
            key: row.holderId,
            label: (
              <>
                {row.name}
                <span className="ml-2 text-xs text-neutral-500">{row.kind}</span>
              </>
            ),
            value: Math.max(0, row.qty),
            display: <span className={row.qty < 0 ? "text-red-400" : ""}>{row.qty}</span>,
          }))}
        />
      )}
      <Link href="/admin/stocktake" className="self-start text-sm text-neutral-500 hover:text-neutral-200">
        Wrong? Count it in Stocktake →
      </Link>
    </div>
  );
}
