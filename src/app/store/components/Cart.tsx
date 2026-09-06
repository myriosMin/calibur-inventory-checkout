"use client";

import Button from "@/components/ui/Button";
import Stepper from "@/components/ui/Stepper";

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
  submitting?: boolean;
}

/**
 * Live, in-app cart mock from docs/tele-qr/flows.md §2:
 *
 *   🛒 Borrowing → Hero
 *   • Resistor 10kΩ 0402      × 10   [-] [+]
 *   • XT30 right angle M      ×  2   [-] [+]
 *   [📷 Scan more]  [🔍 Search]  [✅ Done]  [❌ Cancel]
 */
export default function Cart({
  destHolderName,
  lines,
  onQtyChange,
  onScanMore,
  onSearch,
  onDone,
  onCancel,
  submitting = false,
}: CartProps) {
  const isEmpty = lines.length === 0;

  return (
    <div className="flex min-h-screen flex-col bg-white px-4 pb-6 pt-4">
      <h1 className="mb-3 text-lg font-semibold text-gray-900">
        🛒 Borrowing{destHolderName ? ` → ${destHolderName}` : ""}
      </h1>

      {isEmpty ? (
        <p className="flex-1 py-8 text-center text-sm text-gray-500">
          Cart is empty. Scan a sticker or search to add an item.
        </p>
      ) : (
        <ul className="mb-4 flex-1 divide-y divide-gray-100">
          {lines.map((line) => (
            <li key={line.productId} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-gray-900">{line.name}</p>
                <p className="text-xs text-gray-500">
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

      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onScanMore} disabled={submitting}>
          📷 Scan more
        </Button>
        <Button variant="secondary" onClick={onSearch} disabled={submitting}>
          🔍 Search
        </Button>
        <Button variant="primary" onClick={onDone} disabled={isEmpty || submitting}>
          ✅ Done
        </Button>
        <Button variant="danger" onClick={onCancel} disabled={submitting}>
          ❌ Cancel
        </Button>
      </div>
    </div>
  );
}
