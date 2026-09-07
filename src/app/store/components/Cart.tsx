"use client";

import Button from "@/components/ui/Button";
import Stepper from "@/components/ui/Stepper";
import { IconCamera, IconSearch } from "@/components/ui/icons";

export interface CartLineView {
  productId: string;
  name: string;
  unit: string;
  qty: number;
}

export interface CartProps {
  /** Destination holder name once chosen, e.g. "Hero". Null before the first item is added. */
  destHolderName: string | null;
  lines: CartLineView[];
  onQtyChange: (productId: string, qty: number) => void;
  onScanMore: () => void;
  onSearch: () => void;
  onDone: () => void;
  onCancel: () => void;
  /** Lets the member override an auto-filled destination (see
   * borrow/page.tsx's remembered-last-destination flow). Omitted entirely
   * before a destination is set -- there's nothing to change yet. */
  onChangeDestination?: () => void;
  submitting?: boolean;
}

/**
 * Live, in-app cart, per docs/tele-qr/flows.md §2. "Done" is the single
 * primary action a member reaches for on every item; "Scan more" / "Search"
 * are equal-weight secondary actions; "Cancel" is de-emphasized (ghost, in
 * the header) since aborting the whole cart is rare and shouldn't compete
 * visually with the actions used on every item.
 */
export default function Cart({
  destHolderName,
  lines,
  onQtyChange,
  onScanMore,
  onSearch,
  onDone,
  onCancel,
  onChangeDestination,
  submitting = false,
}: CartProps) {
  const isEmpty = lines.length === 0;

  return (
    <div className="flex min-h-screen flex-col bg-neutral-950 px-4 pb-6 pt-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <h1 className="text-lg font-semibold text-neutral-100">
          Borrowing
          {destHolderName ? (
            <>
              {" "}
              <span className="text-neutral-400">&rarr;</span> {destHolderName}
              {onChangeDestination ? (
                <button
                  type="button"
                  onClick={onChangeDestination}
                  disabled={submitting}
                  className="ml-2 align-middle text-xs font-medium text-red-400 hover:text-red-300 disabled:text-neutral-700"
                >
                  Change
                </button>
              ) : null}
            </>
          ) : null}
        </h1>
        <Button variant="ghost" onClick={onCancel} disabled={submitting} className="px-2">
          Cancel
        </Button>
      </div>

      {isEmpty ? (
        <p className="flex-1 py-8 text-center text-sm text-neutral-400">
          Cart is empty. Scan a sticker or search to add an item.
        </p>
      ) : (
        <ul className="mb-4 flex-1 divide-y divide-neutral-800">
          {lines.map((line) => (
            <li key={line.productId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-neutral-100">{line.name}</p>
                <p className="text-xs text-neutral-400">
                  × {line.qty} {line.unit}
                </p>
              </div>
              <Stepper
                value={line.qty}
                min={1}
                onChange={(qty) => onQtyChange(line.productId, qty)}
                label={line.name}
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-2">
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={onScanMore} disabled={submitting} className="gap-2">
            <IconCamera size={18} /> Scan more
          </Button>
          <Button variant="secondary" onClick={onSearch} disabled={submitting} className="gap-2">
            <IconSearch size={18} /> Search
          </Button>
        </div>
        <Button
          variant="primary"
          onClick={onDone}
          disabled={isEmpty || submitting}
          className="w-full"
        >
          {submitting ? "Submitting…" : "Done"}
        </Button>
      </div>
    </div>
  );
}
