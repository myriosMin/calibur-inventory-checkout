"use client";

import Sheet from "@/components/ui/Sheet";

export interface GroupPickerProduct {
  id: string;
  name: string;
  tier: "asset" | "bulk" | "loose";
  unit: string;
  spec?: Record<string, unknown> | null;
}

export interface GroupPickerProps {
  open: boolean;
  locationName?: string;
  products: GroupPickerProduct[];
  /** Tapping a product behaves exactly like scanning it directly -- the
   * caller feeds it into the same add-to-cart + quantity-prompt pipeline,
   * just tagged with entryMethod 'group_pick' instead of 'scan'. */
  onSelect: (product: GroupPickerProduct) => void;
  onClose: () => void;
}

/**
 * Group-code resolution (docs/tele-qr/flows.md §1/§2): scanning a group code
 * (e.g. the resistor book page) lists the products at that location; the
 * member taps one. This is how ~157 resistor values sit behind ~8 page
 * stickers (see docs/tele-qr/qr-labels.md).
 */
export default function GroupPicker({ open, locationName, products, onSelect, onClose }: GroupPickerProps) {
  return (
    <Sheet open={open} onClose={onClose} title={locationName ?? "Pick an item"}>
      {products.length === 0 ? (
        <p className="py-2 text-sm text-neutral-400">Nothing active at this location.</p>
      ) : null}
      <ul className="divide-y divide-neutral-800">
        {products.map((product) => (
          <li key={product.id}>
            <button
              type="button"
              onClick={() => onSelect(product)}
              className="flex min-h-11 w-full items-center justify-between py-3 text-left"
            >
              <span className="font-medium text-neutral-100">{product.name}</span>
              <span className="text-xs uppercase text-neutral-600">{product.unit}</span>
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
