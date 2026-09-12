"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

import Card from "@/components/admin/Card";
import EmptyState from "@/components/admin/EmptyState";
import PageHeader from "@/components/admin/PageHeader";
import Button from "@/components/ui/Button";
import Stepper from "@/components/ui/Stepper";
import Toast from "@/components/ui/Toast";
import { IconPlus, IconX } from "@/components/ui/icons";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";

import {
  addLine,
  describeRestock,
  removeLine,
  setLineQty,
  totalUnits,
  validateRestockLines,
  type RestockLine,
} from "./lines";
import { buildProductSearchFilter } from "./product-search";

type ProductSearchRow = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  "id" | "name" | "unit" | "tier" | "part_number" | "category"
>;

const SEARCH_LIMIT = 20;

/**
 * /admin/restock -- the only way stock enters the store.
 *
 * Nothing else in the system creates a positive store balance: submit_cart
 * only moves stock that is already somewhere, and the catalog import creates
 * products with no movements at all. Without this page a freshly imported
 * catalog sits at zero and every borrow drives the store negative.
 *
 * operations.md treats "add a new product" as the most frequent recurring
 * task and makes the *speed* of this flow a product requirement -- if it
 * takes more than five minutes people stop doing it and the catalog rots.
 * Hence: one search box that stays focused, several products per commit, and
 * no confirmation step.
 *
 * Writes go through the `admin_restock` RPC (one session + one
 * adjustment -> store movement per line, in one transaction), not through
 * direct inserts, so a half-written delivery is not representable. RLS's
 * is_admin() is what actually authorises it; this page holds only the anon
 * key.
 */
export default function AdminRestockPage() {
  const supabase = useMemo(() => getBrowserClient(), []);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSearchRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [lines, setLines] = useState<RestockLine[]>([]);
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{
    variant: "success" | "error" | "info";
    message: string;
  } | null>(null);
  const [lastCommit, setLastCommit] = useState<{
    summary: string;
    sessionId: string;
    at: string;
  } | null>(null);

  const searchInputRef = useRef<HTMLInputElement>(null);

  /**
   * One token per *form submission*, not per attempt: if the commit fails
   * ambiguously (network died after the INSERT), retrying with the same token
   * makes admin_restock return the original session and write nothing. It is
   * cleared only once a commit has definitively succeeded.
   */
  const clientTokenRef = useRef<string | null>(null);

  // Debounced product search. Same shape as the member picker in
  // /admin/bind-queue: 200ms timer, `cancelled` guard so a slow response for
  // an old query cannot overwrite a fast one for a newer query.
  useEffect(() => {
    const trimmed = query.trim();
    let cancelled = false;

    async function search() {
      // Every state update lives inside this deferred callback, never in the
      // effect body -- a synchronous setState there triggers the cascading
      // render that react-hooks/set-state-in-effect flags.
      if (trimmed.length === 0) {
        setResults([]);
        setSearchError(null);
        setSearching(false);
        return;
      }

      setSearching(true);
      setSearchError(null);
      const { data, error } = await supabase
        .from("products")
        .select("id, name, unit, tier, part_number, category")
        .eq("active", true)
        .or(buildProductSearchFilter(trimmed))
        .order("name", { ascending: true })
        .limit(SEARCH_LIMIT);

      if (cancelled) return;
      if (error) {
        setSearchError(error.message);
        setResults([]);
      } else {
        setResults(data ?? []);
      }
      setSearching(false);
    }

    const timeout = setTimeout(search, 200);
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [query, supabase]);

  function handleAdd(product: ProductSearchRow) {
    setLines((prev) => addLine(prev, product));
    setFeedback(null);
    // Clear the box but keep focus: the next part is already in the admin's
    // other hand.
    setQuery("");
    setResults([]);
    searchInputRef.current?.focus();
  }

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Enter adds the top hit -- the whole point is to avoid reaching for the
    // mouse between parts.
    if (results.length > 0) handleAdd(results[0]);
  }

  async function handleCommit(e: React.FormEvent) {
    e.preventDefault();
    setFeedback(null);

    const validation = validateRestockLines(lines);
    if (!validation.ok) {
      setFeedback({ variant: "error", message: validation.error });
      return;
    }

    if (!clientTokenRef.current) {
      clientTokenRef.current = crypto.randomUUID();
    }

    const summary = describeRestock(lines);
    const trimmedNote = note.trim();

    setSubmitting(true);
    const { data, error } = await supabase.rpc("admin_restock", {
      p_lines: validation.lines,
      ...(trimmedNote ? { p_note: trimmedNote } : {}),
      p_client_token: clientTokenRef.current,
    });
    setSubmitting(false);

    if (error) {
      // Deliberately keep the lines, the quantities, the note AND the token.
      // The admin is standing at the shelf holding the parts; making them
      // retype the delivery is the fastest way to teach them not to bother.
      setFeedback({
        variant: "error",
        message: `Restock failed: ${error.message} — your lines are still here, press Record again to retry.`,
      });
      return;
    }

    clientTokenRef.current = null;
    setLastCommit({
      summary,
      sessionId: data as string,
      at: new Date().toLocaleString(),
    });
    setFeedback({
      variant: "success",
      message: `Recorded ${summary} into the store.`,
    });
    setLines([]);
    setNote("");
    searchInputRef.current?.focus();
  }

  const units = totalUnits(lines);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Restock"
        description="Record newly received stock into the store. Each line writes one adjustment → store movement; the whole delivery commits as a single ledger session."
      />

      {feedback ? (
        <Toast
          variant={feedback.variant}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      {lastCommit ? (
        <Card title="Last recorded">
          <p className="text-sm text-neutral-100">{lastCommit.summary}</p>
          <p className="mt-1 text-xs text-neutral-400">
            {lastCommit.at} · session{" "}
            <code className="rounded bg-neutral-800 px-1 py-0.5">
              {lastCommit.sessionId.slice(0, 8)}
            </code>
          </p>
          <p className="mt-3 text-sm">
            <Link
              href="/admin/movements"
              className="font-medium text-red-400 hover:text-red-300"
            >
              View it in the ledger
            </Link>
          </p>
        </Card>
      ) : null}

      <Card title="Find products">
        <form onSubmit={handleSearchSubmit}>
          <input
            ref={searchInputRef}
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, part number, or category…"
            aria-label="Search products"
            className="min-h-11 w-full rounded-lg border border-neutral-700 px-3 text-base text-neutral-100"
          />
        </form>

        {searchError ? (
          <p className="mt-3 text-sm text-red-400">{searchError}</p>
        ) : null}

        {query.trim().length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            Type to search the catalog. Press Enter to add the top match, then
            keep typing — you can record several products in one go.
          </p>
        ) : searching ? (
          <p className="mt-3 text-sm text-neutral-400">Searching…</p>
        ) : results.length === 0 ? (
          <p className="mt-3 text-sm text-neutral-400">
            No active products match “{query.trim()}”.{" "}
            <Link
              href="/admin/products"
              className="font-medium text-red-400 hover:text-red-300"
            >
              Create it first
            </Link>
            , then come back.
          </p>
        ) : (
          <ul className="mt-3 flex flex-col gap-1">
            {results.map((product) => (
              <li
                key={product.id}
                className="flex items-center justify-between gap-3 rounded-lg px-2 py-2 hover:bg-neutral-800"
              >
                <div className="min-w-0 text-sm">
                  <div className="truncate text-neutral-100">{product.name}</div>
                  <div className="truncate text-xs text-neutral-400">
                    {product.tier}
                    {product.part_number ? ` · ${product.part_number}` : ""}
                    {product.category ? ` · ${product.category}` : ""}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => handleAdd(product)}
                  className="min-h-0 shrink-0 px-2 py-1 text-xs"
                >
                  <IconPlus size={14} className="mr-1" />
                  Add
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <form onSubmit={handleCommit}>
        <Card
          title="Delivery"
          actions={
            lines.length > 0 ? (
              <span className="text-xs text-neutral-400">
                {describeRestock(lines)}
              </span>
            ) : null
          }
        >
          {lines.length === 0 ? (
            <EmptyState
              className="p-0"
              message="Nothing added yet. Search above and add the products you received."
            />
          ) : (
            <ul className="flex flex-col gap-2">
              {lines.map((line) => (
                <li
                  key={line.productId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 px-3 py-2"
                >
                  <div className="min-w-0 text-sm">
                    <div className="truncate text-neutral-100">{line.name}</div>
                    <div className="text-xs text-neutral-400">{line.unit}</div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Stepper
                      label={line.name}
                      value={line.qty}
                      min={1}
                      onChange={(qty) =>
                        setLines((prev) => setLineQty(prev, line.productId, qty))
                      }
                      disabled={submitting}
                    />
                    <input
                      type="number"
                      min={1}
                      step={1}
                      value={line.qty}
                      aria-label={`${line.name} quantity`}
                      disabled={submitting}
                      onChange={(e) =>
                        setLines((prev) =>
                          setLineQty(
                            prev,
                            line.productId,
                            Number.parseInt(e.target.value, 10) || 0,
                          ),
                        )
                      }
                      className="min-h-11 w-20 rounded-lg border border-neutral-700 px-2 text-base text-neutral-100"
                    />
                    <button
                      type="button"
                      aria-label={`Remove ${line.name}`}
                      disabled={submitting}
                      onClick={() =>
                        setLines((prev) => removeLine(prev, line.productId))
                      }
                      className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40"
                    >
                      <IconX size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}

          <label className="mt-4 flex flex-col gap-1 text-sm text-neutral-200">
            Note (optional)
            <textarea
              value={note}
              rows={2}
              disabled={submitting}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. PO 4471, received from Cytron"
              className="rounded-lg border border-neutral-700 px-3 py-2 text-base text-neutral-100"
            />
          </label>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={submitting || lines.length === 0}>
              {submitting ? "Recording…" : "Record restock"}
            </Button>
            {lines.length > 0 ? (
              <Button
                variant="ghost"
                disabled={submitting}
                onClick={() => {
                  setLines([]);
                  setNote("");
                  // A fresh token: whatever was half-attempted is abandoned
                  // on purpose, not retried.
                  clientTokenRef.current = null;
                  setFeedback(null);
                }}
              >
                Clear
              </Button>
            ) : null}
            {lines.length > 0 ? (
              <span className="text-sm text-neutral-400">
                {units} {units === 1 ? "unit" : "units"} into the store
              </span>
            ) : null}
          </div>
        </Card>
      </form>
    </div>
  );
}
