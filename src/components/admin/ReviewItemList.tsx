"use client";

import Link from "next/link";
import { useState } from "react";

import Button from "@/components/ui/Button";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";

import StatusPill, { type StatusTone } from "./StatusPill";

export type ReviewItem = Database["public"]["Tables"]["review_items"]["Row"];

const SEVERITY_TONE: Record<string, StatusTone> = {
  blocker: "danger",
  check: "warning",
  info: "inactive",
};

export interface ReviewItemListProps {
  items: ReviewItem[];
  onUpdated: (item: ReviewItem) => void;
  /** product_id -> name. When given, each item links to its product. */
  productNames?: Map<string, string>;
}

/**
 * Review items with resolve / dismiss / reopen. Who closed an item and when
 * is stamped by the database trigger from the signed-in session
 * (0025_review_queue_and_staff_stocktake.sql), never sent from here.
 */
export default function ReviewItemList({ items, onUpdated, productNames }: ReviewItemListProps) {
  return (
    <ul className="divide-y divide-neutral-800">
      {items.map((item) => (
        <ReviewItemRow
          key={item.id}
          item={item}
          onUpdated={onUpdated}
          productName={item.product_id ? productNames?.get(item.product_id) : undefined}
        />
      ))}
    </ul>
  );
}

function ReviewItemRow({
  item,
  onUpdated,
  productName,
}: {
  item: ReviewItem;
  onUpdated: (item: ReviewItem) => void;
  productName?: string;
}) {
  const [note, setNote] = useState(item.resolution_note ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(status: "open" | "resolved" | "dismissed") {
    setSaving(true);
    setError(null);
    const { data, error: updateError } = await getBrowserClient()
      .from("review_items")
      .update({ status, resolution_note: status === "open" ? item.resolution_note : note.trim() || null })
      .eq("id", item.id)
      .select()
      .single();
    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    onUpdated(data);
  }

  const open = item.status === "open";

  return (
    <li className={`flex flex-col gap-2 p-4 ${open ? "" : "opacity-70"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill tone={SEVERITY_TONE[item.severity] ?? "inactive"}>{item.severity}</StatusPill>
        <span className="text-xs uppercase tracking-wide text-neutral-500">{item.entity}</span>
        {!open ? <StatusPill tone="active">{item.status}</StatusPill> : null}
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-100">{item.subject}</span>
        {productName && item.product_id ? (
          <Link href={`/admin/products/${item.product_id}`} className="text-sm font-medium text-red-400 hover:text-red-300">
            Open product
          </Link>
        ) : null}
      </div>

      <p className="whitespace-pre-line text-sm text-neutral-300">{item.issue}</p>

      {open ? (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What did you check or change?"
            className="min-h-11 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-sm"
          />
          <div className="flex gap-2">
            <Button onClick={() => setStatus("resolved")} disabled={saving}>
              Resolve
            </Button>
            <Button variant="ghost" onClick={() => setStatus("dismissed")} disabled={saving}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-400">
          <span>
            {item.status === "resolved" ? "Resolved" : "Dismissed"}
            {item.resolved_at ? ` ${new Date(item.resolved_at).toLocaleDateString()}` : ""}
            {item.resolution_note ? `: ${item.resolution_note}` : ""}
          </span>
          <Button variant="ghost" onClick={() => setStatus("open")} disabled={saving} className="min-h-0 px-2 py-1 text-xs">
            Reopen
          </Button>
        </div>
      )}

      {error ? <p className="text-sm text-red-400">{error}</p> : null}
    </li>
  );
}
