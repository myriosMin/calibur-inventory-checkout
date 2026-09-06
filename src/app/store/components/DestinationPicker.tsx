"use client";

import Sheet from "@/components/ui/Sheet";

export interface DestinationOption {
  id: string;
  name: string;
}

export interface DestinationPickerProps {
  open: boolean;
  options: DestinationOption[];
  loading?: boolean;
  error?: string | null;
  onSelect: (option: DestinationOption) => void;
  /** Closing without picking aborts the item currently being added -- the
   * caller does not set destHolderId and the pending item is dropped. */
  onClose: () => void;
}

/**
 * "Where is this going?" (docs/tele-qr/flows.md §2). Shown once per session,
 * on the first item added while `destHolderId` is still null. Once a
 * destination is chosen it is fixed for the rest of the cart -- this sheet
 * is never reopened afterwards.
 *
 * `options` comes from `/api/store/destinations` (every active robot plus
 * the member's personal holder) -- not `/api/store/holdings/sources`, which
 * is the *return* flow's source picker and only lists robots the member has
 * already borrowed to. Using that one here would mean a fresh member could
 * never borrow to any robot for the first time.
 */
export default function DestinationPicker({
  open,
  options,
  loading = false,
  error = null,
  onSelect,
  onClose,
}: DestinationPickerProps) {
  return (
    <Sheet open={open} onClose={onClose} title="Where is this going?">
      {loading ? <p className="py-2 text-sm text-gray-500">Loading destinations…</p> : null}
      {error ? <p className="py-2 text-sm text-red-600">{error}</p> : null}
      {!loading && !error && options.length === 0 ? (
        <p className="py-2 text-sm text-gray-500">No destinations available.</p>
      ) : null}
      <ul className="divide-y divide-gray-100">
        {options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              onClick={() => onSelect(option)}
              className="flex min-h-11 w-full items-center justify-between py-3 text-left font-medium text-gray-900"
            >
              {option.name}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
