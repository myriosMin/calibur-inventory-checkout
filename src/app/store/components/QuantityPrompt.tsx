"use client";

import { useState } from "react";

import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";

export interface QuantityPromptProduct {
  name: string;
  tier: "bulk" | "loose";
  unit: string;
}

export interface QuantityPromptProps {
  open: boolean;
  product: QuantityPromptProduct | null;
  onConfirm: (qty: number) => void;
  onClose: () => void;
}

const BULK_CHIPS = [1, 2, 5, 10];

/**
 * Quantity prompt, driven by tier (docs/tele-qr/flows.md §2). `asset` needs
 * no prompt at all -- the caller adds qty=1 directly and never renders this
 * component. This component only ever handles `bulk` and `loose`.
 *
 * KNOWN SIMPLIFICATION: for `loose`, both "Took some" and "Took the last of
 * it" submit qty=1. The real "raise a restock flag" behavior for the latter
 * needs `min_stock` / notification wiring (Phase 5, out of this pass's
 * scope) since `stock_movements.qty` is `check (qty > 0)` and there's no
 * column to carry "level now empty" semantics yet.
 */
export default function QuantityPrompt({ open, product, onConfirm, onClose }: QuantityPromptProps) {
  const [typedQty, setTypedQty] = useState("");

  if (!product) return null;

  const handleClose = () => {
    setTypedQty("");
    onClose();
  };

  const handleConfirm = (qty: number) => {
    setTypedQty("");
    onConfirm(qty);
  };

  const handleTypedSubmit = () => {
    const qty = Number.parseInt(typedQty, 10);
    if (Number.isFinite(qty) && qty > 0) handleConfirm(qty);
  };

  return (
    <Sheet open={open} onClose={handleClose} title={product.name}>
      {product.tier === "bulk" ? (
        <div className="space-y-3">
          <div className="flex flex-wrap gap-2">
            {BULK_CHIPS.map((chip) => (
              <button
                key={chip}
                type="button"
                onClick={() => handleConfirm(chip)}
                className="flex min-h-11 min-w-14 items-center justify-center rounded-lg bg-neutral-800 px-4 text-base font-semibold text-neutral-100 hover:bg-neutral-700"
              >
                {chip}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="number"
              inputMode="numeric"
              min={1}
              value={typedQty}
              onChange={(e) => setTypedQty(e.target.value)}
              placeholder={`Type… (${product.unit})`}
              className="min-h-11 w-full rounded-lg border border-neutral-700 px-3 text-base"
            />
            <Button
              variant="primary"
              onClick={handleTypedSubmit}
              disabled={!Number.parseInt(typedQty, 10) || Number.parseInt(typedQty, 10) <= 0}
            >
              Add
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <Button variant="secondary" onClick={() => handleConfirm(1)} className="w-full">
            Took some
          </Button>
          <Button variant="secondary" onClick={() => handleConfirm(1)} className="w-full">
            Took the last of it
          </Button>
        </div>
      )}
    </Sheet>
  );
}
