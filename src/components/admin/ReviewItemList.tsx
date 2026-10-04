"use client";

import Link from "next/link";
import { useState } from "react";

import Button from "@/components/ui/Button";
import { IconChevronDown } from "@/components/ui/icons";
import { isHighPriorityReview } from "@/lib/expensive";
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
  /** Open every item on first render: for a short list, like one product's. */
  expandAll?: boolean;
  /**
   * Products that are expensive (0028). An item about one, or marked
   * about_expensive, is high priority and says so.
   */
  expensiveProductIds?: ReadonlySet<string>;
}

/**
 * Review items as a compact list. Each row is one line until opened; only
 * the opened item shows its full issue, the note field and Resolve /
 * Dismiss, so a queue of 18 items is 18 readable lines rather than 18 forms.
 *
 * Who closed an item and when is stamped by the database trigger from the
 * signed-in session (0025_review_queue_and_staff_stocktake.sql), never sent
 * from here.
 */
export default function ReviewItemList({
  items,
  onUpdated,
  productNames,
  expandAll = false,
  expensiveProductIds = new Set(),
}: ReviewItemListProps) {
  const [openId, setOpenId] = useState<number | null>(null);
  return (
    <ul className="divide-y divide-neutral-800/70">
      {items.map((item) => (
        <ReviewItemRow
          key={item.id}
          item={item}
          open={expandAll || openId === item.id}
          onToggle={expandAll ? undefined : () => setOpenId((current) => (current === item.id ? null : item.id))}
          onUpdated={(updated) => {
            onUpdated(updated);
            // Closing an item moves on: nothing left to do on it.
            if (updated.status !== "open") setOpenId(null);
          }}
          productName={item.product_id ? productNames?.get(item.product_id) : undefined}
          highPriority={isHighPriorityReview(item, expensiveProductIds)}
          productIsExpensive={item.product_id !== null && expensiveProductIds.has(item.product_id)}
        />
      ))}
    </ul>
  );
}

function ReviewItemRow({
  item,
  open,
  onToggle,
  onUpdated,
  productName,
  highPriority,
  productIsExpensive,
}: {
  item: ReviewItem;
  open: boolean;
  onToggle?: () => void;
  onUpdated: (item: ReviewItem) => void;
  productName?: string;
  highPriority: boolean;
  productIsExpensive: boolean;
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

  async function setAboutExpensive(aboutExpensive: boolean) {
    setSaving(true);
    setError(null);
    const { data, error: updateError } = await getBrowserClient()
      .from("review_items")
      .update({ about_expensive: aboutExpensive })
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

  const isOpen = item.status === "open";
  const header = (
    <>
      <StatusPill tone={SEVERITY_TONE[item.severity] ?? "inactive"}>{item.severity}</StatusPill>
      {highPriority ? (
        <span title="About an expensive item: settle it first" className="shrink-0">
          <StatusPill tone="danger">expensive</StatusPill>
        </span>
      ) : null}
      <span className={`min-w-0 flex-1 truncate text-sm ${isOpen ? "text-neutral-100" : "text-neutral-500"}`}>
        {item.subject}
      </span>
      {productName && productName !== item.subject ? (
        <span className="hidden max-w-56 truncate text-xs text-neutral-500 md:inline">{productName}</span>
      ) : null}
      {!isOpen ? <StatusPill tone="active">{item.status}</StatusPill> : null}
    </>
  );

  return (
    <li className={isOpen ? "" : "opacity-75"}>
      {onToggle ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={onToggle}
          className="flex w-full cursor-pointer items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-neutral-800/30"
        >
          <IconChevronDown size={15} className={`shrink-0 text-neutral-500 transition-transform ${open ? "" : "-rotate-90"}`} />
          {header}
        </button>
      ) : (
        <div className="flex items-center gap-3 px-4 pt-3">{header}</div>
      )}

      {open ? (
        <div className={`flex flex-col gap-3 px-4 pb-4 ${onToggle ? "pl-11" : "pt-2"}`}>
          <p className="text-xs uppercase tracking-wide text-neutral-500">
            {item.entity}
            {productName && item.product_id ? (
              <>
                {" · "}
                <Link href={`/admin/products/${item.product_id}`} className="normal-case tracking-normal text-neutral-400 hover:text-neutral-100">
                  {productName} →
                </Link>
              </>
            ) : null}
          </p>
          <p className="whitespace-pre-line text-sm leading-relaxed text-neutral-300">{item.issue}</p>

          {productIsExpensive ? (
            <p className="text-xs text-neutral-500">High priority: the product is an expensive item.</p>
          ) : isOpen || item.about_expensive ? (
            <label className="flex items-center gap-2 text-xs text-neutral-400">
              <input
                type="checkbox"
                checked={item.about_expensive}
                disabled={saving}
                onChange={(e) => void setAboutExpensive(e.target.checked)}
              />
              About expensive items (settle it first)
            </label>
          ) : null}

          {isOpen ? (
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What did you check or change?"
                aria-label="Resolution note"
                className="min-h-9 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 placeholder:text-neutral-600"
              />
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setStatus("resolved")} disabled={saving}>
                  Resolve
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setStatus("dismissed")} disabled={saving}>
                  Dismiss
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-xs text-neutral-500">
              <span>
                {item.status === "resolved" ? "Resolved" : "Dismissed"}
                {item.resolved_at ? ` ${new Date(item.resolved_at).toLocaleDateString()}` : ""}
                {item.resolution_note ? `: ${item.resolution_note}` : ""}
              </span>
              <Button variant="ghost" size="sm" onClick={() => setStatus("open")} disabled={saving}>
                Reopen
              </Button>
            </div>
          )}

          {error ? <p className="text-sm text-red-400">{error}</p> : null}
        </div>
      ) : null}
    </li>
  );
}
