"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import DataTable, { type Column } from "@/components/admin/DataTable";
import { getBrowserClient } from "@/lib/supabase/browser";

interface HoldingRow {
  holderId: string;
  name: string;
  kind: string;
  qty: number;
}

const KIND_ORDER = ["store", "robot", "member", "consumed"];

/**
 * Where this product is, per the ledger (`holdings` view). Read-only on
 * purpose: a wrong number is corrected by counting it in Stocktake, which
 * leaves a record of who counted what, not by typing over it.
 */
export default function HoldingsPanel({ productId, unit }: { productId: string; unit: string }) {
  const [rows, setRows] = useState<HoldingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const supabase = getBrowserClient();
      const { data: holdings, error: holdingsError } = await supabase
        .from("holdings")
        .select("holder_id, qty")
        .eq("product_id", productId);
      if (holdingsError) {
        if (!cancelled) {
          setError(holdingsError.message);
          setLoading(false);
        }
        return;
      }
      const ids = (holdings ?? []).map((h) => h.holder_id).filter((id): id is string => id !== null);
      const { data: holders, error: holdersError } = ids.length
        ? await supabase.from("holders").select("id, name, kind").in("id", ids)
        : { data: [], error: null };
      if (cancelled) return;
      if (holdersError) {
        setError(holdersError.message);
        setLoading(false);
        return;
      }
      const byId = new Map((holders ?? []).map((h) => [h.id, h]));
      setRows(
        (holdings ?? [])
          .flatMap((h) => {
            const holder = h.holder_id ? byId.get(h.holder_id) : undefined;
            if (!holder || holder.kind === "adjustment") return [];
            return [{ holderId: holder.id, name: holder.name, kind: holder.kind, qty: h.qty ?? 0 }];
          })
          .sort(
            (a, b) =>
              KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || b.qty - a.qty || a.name.localeCompare(b.name),
          ),
      );
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const sumKind = (kind: string) => rows.filter((r) => r.kind === kind).reduce((s, r) => s + r.qty, 0);
  const store = sumKind("store");
  const robots = sumKind("robot");
  const members = sumKind("member");
  const consumed = sumKind("consumed");

  const columns: Column<HoldingRow>[] = [
    { key: "name", header: "Holder", render: (r) => <span className="text-neutral-100">{r.name}</span> },
    { key: "kind", header: "Kind", render: (r) => r.kind },
    {
      key: "qty",
      header: "Qty",
      className: "text-right tabular-nums",
      render: (r) => <span className={r.qty < 0 ? "text-red-400" : ""}>{r.qty}</span>,
    },
  ];

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
        <p className="text-sm text-neutral-300">
          {store + robots + members} {unit} on the ledger: {store} in the store, {robots} on robots, {members} with
          members{consumed ? `, ${consumed} used up so far` : ""}.
        </p>
        <Link href="/admin/stocktake" className="text-sm font-medium text-red-400 hover:text-red-300">
          Wrong? Count it in Stocktake
        </Link>
      </div>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.holderId}
        loading={loading}
        error={error}
        emptyMessage="Nothing on the ledger yet: no stock has been received, counted or imported."
      />
    </div>
  );
}
