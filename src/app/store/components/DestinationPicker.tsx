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
 * "Where is this going?" (docs/tele-qr/flows.md §2). Normally shown once per
 * session, on the first item added while `destHolderId` is still null --
 * though it's skipped entirely when a remembered last destination exists
 * (see borrow/page.tsx). Once set, the destination is fixed for the rest of
 * the cart's normal flow, but this same sheet is reopened by Cart's "Change"
 * link if the member wants to override it (CHANGE_DEST in cartReducer).
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
      {loading ? <p className="py-2 text-sm text-neutral-400">Loading destinations…</p> : null}
      {error ? <p className="py-2 text-sm text-red-400">{error}</p> : null}
      {!loading && !error && options.length === 0 ? (
        <p className="py-2 text-sm text-neutral-400">No destinations available.</p>
      ) : null}
      <ul className="divide-y divide-neutral-800">
        {options.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              onClick={() => onSelect(option)}
              className="flex min-h-11 w-full items-center justify-between py-3 text-left font-medium text-neutral-100"
            >
              {option.name}
            </button>
          </li>
        ))}
      </ul>
    </Sheet>
  );
}
