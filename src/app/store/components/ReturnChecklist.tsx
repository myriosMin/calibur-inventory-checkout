"use client";

import { useState } from "react";

import Button from "@/components/ui/Button";
import Stepper from "@/components/ui/Stepper";
import { IconPlus } from "@/components/ui/icons";
import SearchSheet, { type SearchProduct } from "./SearchSheet";

/** One row sourced from `GET /api/store/holdings?holderId=...` -- something
 * this member is actually recorded as holding at the chosen source. */
export interface HoldingItem {
  productId: string;
  name: string;
  tier: "asset" | "bulk" | "loose";
  unit: string;
  /** Qty currently held at the source holder -- the stepper's max. */
  qty: number;
}

/** A line added via the "Something else -> search" fallback: a return with
 * no prior borrow record (docs/tele-qr/flows.md §3 -- "it happens, since
 * parts predate the system"). Has no `held` qty because it never appeared in
 * the `/holdings` response; `submit_cart` resolves it server-side as an
 * `adjustment`-sourced movement flagged for admin review. */
export interface ExtraLine {
  productId: string;
  name: string;
  tier: "asset" | "bulk" | "loose";
  unit: string;
}

export interface ReturnChecklistProps {
  /** Items actually held at the chosen source (from `/holdings`). */
  items: HoldingItem[];
  /** Lines added via search that have no corresponding holdings row. */
  extraLines: ExtraLine[];
  /** Returning-qty per `productId`, covering both `items` and `extraLines`.
   * Fully controlled by the parent (`return/page.tsx`) -- this component
   * never holds its own copy of the quantities. */
  quantities: Record<string, number>;
  onQtyChange: (productId: string, qty: number) => void;
  /** Sets every line (held items only) to its own max held qty in one tap. */
  onReturnAll: () => void;
  /** A search result was picked; parent decides how to fold it into state
   * (e.g. no-op if it's already a held item or already an extra line). */
  onAddExtra: (product: SearchProduct) => void;
  /** Raw Telegram initData, forwarded to `SearchSheet` for the search API call. */
  initData: string;
}

/**
 * RETURN_LIST checklist (docs/tele-qr/flows.md §3):
 *
 *   • GM6020            held 2   returning [0] [-] [+]
 *   • Center board 2    held 1   returning [0] [-] [+]
 *   [Return all]  [Add item]  [Done]
 *
 * "Done" itself lives in the parent page (it needs to know about the chosen
 * source holder too) -- this component renders the rows plus the two
 * checklist-local affordances ("Return all" and the search fallback).
 */
export default function ReturnChecklist({
  items,
  extraLines,
  quantities,
  onQtyChange,
  onReturnAll,
  onAddExtra,
  initData,
}: ReturnChecklistProps) {
  const [searchOpen, setSearchOpen] = useState(false);

  const handleSearchSelect = (product: SearchProduct) => {
    onAddExtra(product);
    setSearchOpen(false);
  };

  const isEmpty = items.length === 0 && extraLines.length === 0;

  return (
    <div>
      <ul className="divide-y divide-neutral-800">
        {items.map((item) => (
          <li key={item.productId} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-neutral-100">{item.name}</p>
              <p className="text-xs text-neutral-400">
                held {item.qty} {item.unit}
              </p>
            </div>
            <Stepper
              value={quantities[item.productId] ?? 0}
              onChange={(value) => onQtyChange(item.productId, value)}
              min={0}
              max={item.qty}
              label={item.name}
            />
          </li>
        ))}
        {extraLines.map((line) => (
          <li key={line.productId} className="flex items-center justify-between gap-3 py-3">
            <div className="min-w-0">
              <p className="truncate font-medium text-neutral-100">{line.name}</p>
              <p className="text-xs text-amber-600">no borrow record on file</p>
            </div>
            <Stepper
              value={quantities[line.productId] ?? 1}
              onChange={(value) => onQtyChange(line.productId, value)}
              min={1}
              label={line.name}
            />
          </li>
        ))}
      </ul>

      {isEmpty ? (
        <p className="py-4 text-sm text-neutral-400">Nothing held at this source yet.</p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          onClick={onReturnAll}
          disabled={items.length === 0}
        >
          Return all
        </Button>
        <Button variant="secondary" onClick={() => setSearchOpen(true)} className="gap-1.5">
          <IconPlus size={16} /> Add item
        </Button>
      </div>

      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        initData={initData}
        onSelect={handleSearchSelect}
      />
    </div>
  );
}
