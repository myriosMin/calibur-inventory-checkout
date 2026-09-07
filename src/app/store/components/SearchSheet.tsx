"use client";

import { useEffect, useState } from "react";

import SheetComponent from "@/components/ui/Sheet";
import { IconSearch } from "@/components/ui/icons";

export interface SearchProduct {
  id: string;
  name: string;
  tier: "asset" | "bulk" | "loose";
  unit: string;
  category?: string | null;
  spec?: Record<string, unknown> | null;
}

export interface SearchSheetProps {
  open: boolean;
  onClose: () => void;
  /** Raw Telegram initData string, sent as the X-Telegram-Init-Data header. */
  initData: string;
  /** Called when the member taps a result. Caller decides what happens next
   * (add to cart, resolve as a return line, etc.) and is responsible for
   * closing the sheet afterwards if desired. */
  onSelect: (product: SearchProduct) => void;
}

/**
 * Shared search fallback used by both the borrow (WP16) and return (WP17)
 * flows -- every scan path in this app has a search path behind it (see
 * docs/tele-qr/flows.md "Failure and degraded modes"), so a damaged label,
 * a retired code, or a denied camera permission never dead-ends the member.
 */
export default function SearchSheet({ open, onClose, initData, onSelect }: SearchSheetProps) {
  const [query, setQuery] = useState("");
  const [wasOpen, setWasOpen] = useState(open);
  const [results, setResults] = useState<SearchProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset on close, computed during render rather than in an effect (React's
  // recommended pattern for "adjust state when a prop changes" -- avoids an
  // extra commit and the set-state-in-effect lint rule).
  if (open !== wasOpen) {
    setWasOpen(open);
    if (!open) {
      setQuery("");
      setResults([]);
      setError(null);
    }
  }

  const trimmedQuery = query.trim();

  useEffect(() => {
    if (!open || trimmedQuery === "") return;

    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      setError(null);
      fetch(`/api/store/search?q=${encodeURIComponent(trimmedQuery)}`, {
        headers: { "X-Telegram-Init-Data": initData },
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`Search failed (${res.status})`);
          return res.json() as Promise<{ items: SearchProduct[] }>;
        })
        .then((data) => {
          if (!cancelled) setResults(data.items);
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [trimmedQuery, open, initData]);

  // Derived, not stored: avoids clearing `results` state synchronously
  // whenever the query is emptied.
  const visibleResults = trimmedQuery === "" ? [] : results;

  return (
    <SheetComponent open={open} onClose={onClose} title="Search">
      <div className="relative mb-3">
        <IconSearch size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, value, package…"
          autoFocus
          className="min-h-11 w-full rounded-lg border border-slate-300 py-2 pl-10 pr-3 text-base"
        />
      </div>
      {loading ? <p className="py-2 text-sm text-slate-500">Searching…</p> : null}
      {error ? <p className="py-2 text-sm text-red-600">{error}</p> : null}
      {!loading && !error && trimmedQuery !== "" && visibleResults.length === 0 ? (
        <p className="py-2 text-sm text-slate-500">No matches.</p>
      ) : null}
      <ul className="divide-y divide-slate-100">
        {visibleResults.map((product) => (
          <li key={product.id}>
            <button
              type="button"
              onClick={() => onSelect(product)}
              className="flex min-h-11 w-full items-center justify-between py-2 text-left"
            >
              <span>
                <span className="block font-medium text-slate-900">{product.name}</span>
                {product.category ? (
                  <span className="block text-xs text-slate-500">{product.category}</span>
                ) : null}
              </span>
              <span className="text-xs uppercase text-slate-400">{product.tier}</span>
            </button>
          </li>
        ))}
      </ul>
    </SheetComponent>
  );
}
