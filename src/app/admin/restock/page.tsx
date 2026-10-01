"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";

import Card from "@/components/admin/Card";
import EmptyState from "@/components/admin/EmptyState";
import PageHeader from "@/components/admin/PageHeader";
import Button from "@/components/ui/Button";
import Stepper from "@/components/ui/Stepper";
import Toast from "@/components/ui/Toast";
import { IconPlus, IconSearch, IconX } from "@/components/ui/icons";
import { FIELD, FIELD_AREA } from "@/components/admin/form";
import { revalidateStock, useProducts } from "@/lib/admin/queries";
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
import { matchProducts } from "./product-search";

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
  const supabase = getBrowserClient();

  const [query, setQuery] = useState("");

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

  // Search the cached catalog locally: instant, and no request per
  // keystroke (it used to be a debounced ilike query each time).
  const productsQ = useProducts();
  const results: ProductSearchRow[] = useMemo(
    () => matchProducts(productsQ.data ?? [], query, SEARCH_LIMIT),
    [productsQ.data, query],
  );
  const searching = productsQ.isLoading && query.trim().length > 0;
  const searchError = (productsQ.error as Error | undefined)?.message ?? null;

  function handleAdd(product: ProductSearchRow) {
    setLines((prev) => addLine(prev, product));
    setFeedback(null);
    // Clear the box but keep focus: the next part is already in the admin's
    // other hand.
    setQuery("");
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
    void revalidateStock();
    searchInputRef.current?.focus();
  }

  const units = totalUnits(lines);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Restock"
        description="Record a delivery into the store."
        info="Each line writes one adjustment → store movement; the whole delivery commits as a single ledger session. Search, press Enter to add the top match, and keep typing."
      />

      {feedback ? <Toast variant={feedback.variant} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}

      {lastCommit ? (
        <p className="text-sm text-neutral-400">
          Last recorded: <span className="text-neutral-200">{lastCommit.summary}</span> · {lastCommit.at} ·{" "}
          <Link href="/admin/movements" className="text-neutral-300 underline-offset-4 hover:text-neutral-100 hover:underline">
            view in the ledger
          </Link>
        </p>
      ) : null}

      <div className="grid items-start gap-6 lg:grid-cols-5">
        <Card title="Find products" className="lg:col-span-3">
          <form onSubmit={handleSearchSubmit} className="relative">
            <IconSearch size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
            <input
              ref={searchInputRef}
              type="search"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Name, part number or category…"
              aria-label="Search products"
              className={`${FIELD} pl-9`}
            />
          </form>

          {searchError ? <p className="mt-3 text-sm text-red-400">{searchError}</p> : null}

          {query.trim().length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">Type to search. Enter adds the top match.</p>
          ) : searching ? (
            <p className="mt-3 text-sm text-neutral-500">Loading the catalog…</p>
          ) : results.length === 0 ? (
            <p className="mt-3 text-sm text-neutral-500">
              No active products match &ldquo;{query.trim()}&rdquo;.{" "}
              <Link href="/admin/products" className="text-neutral-300 hover:text-neutral-100">
                Create it first
              </Link>
              , then come back.
            </p>
          ) : (
            <ul className="mt-2 flex flex-col">
              {results.map((product, index) => (
                <li key={product.id}>
                  <button
                    type="button"
                    onClick={() => handleAdd(product)}
                    className={`group flex w-full cursor-pointer items-center justify-between gap-3 rounded-lg px-2 py-2 text-left transition-colors hover:bg-neutral-800 ${
                      index === 0 ? "bg-neutral-800/40" : ""
                    }`}
                  >
                    <span className="min-w-0 text-sm">
                      <span className="block truncate text-neutral-100">{product.name}</span>
                      <span className="block truncate text-xs text-neutral-500">
                        {product.tier}
                        {product.part_number ? ` · ${product.part_number}` : ""}
                        {product.category ? ` · ${product.category}` : ""}
                      </span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1 text-xs text-neutral-500 group-hover:text-neutral-200">
                      {index === 0 ? <kbd className="rounded border border-neutral-700 px-1 text-[0.65rem]">Enter</kbd> : null}
                      <IconPlus size={14} />
                      Add
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <form onSubmit={handleCommit} className="lg:sticky lg:top-6 lg:col-span-2">
          <Card title="Delivery" subtitle={lines.length > 0 ? describeRestock(lines) : undefined}>
            {lines.length === 0 ? (
              <EmptyState className="py-6" message="Nothing added yet. Search and add what you received." />
            ) : (
              <ul className="flex flex-col divide-y divide-neutral-800/70">
                {lines.map((line) => (
                  <li key={line.productId} className="flex items-center justify-between gap-2 py-2">
                    <div className="min-w-0 text-sm">
                      <div className="truncate text-neutral-100">{line.name}</div>
                      <div className="text-xs text-neutral-500">{line.unit}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <Stepper
                        label={line.name}
                        value={line.qty}
                        min={1}
                        onChange={(qty) => setLines((prev) => setLineQty(prev, line.productId, qty))}
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
                          setLines((prev) => setLineQty(prev, line.productId, Number.parseInt(e.target.value, 10) || 0))
                        }
                        className="min-h-10 w-16 rounded-lg border border-neutral-800 bg-neutral-950 px-2 text-sm tabular-nums text-neutral-100"
                      />
                      <button
                        type="button"
                        aria-label={`Remove ${line.name}`}
                        disabled={submitting}
                        onClick={() => setLines((prev) => removeLine(prev, line.productId))}
                        className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-neutral-500 hover:bg-neutral-800 hover:text-neutral-100 disabled:opacity-40"
                      >
                        <IconX size={15} />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}

            <label className="mt-4 flex flex-col gap-1.5 text-sm">
              <span className="font-medium text-neutral-300">Note</span>
              <textarea
                value={note}
                rows={2}
                disabled={submitting}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Optional, e.g. PO 4471, received from Cytron"
                className={FIELD_AREA}
              />
            </label>

            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={submitting || lines.length === 0}>
                {submitting ? "Recording…" : lines.length > 0 ? `Record ${units} ${units === 1 ? "unit" : "units"}` : "Record restock"}
              </Button>
              {lines.length > 0 ? (
                <Button
                  variant="ghost"
                  size="sm"
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
            </div>
          </Card>
        </form>
      </div>
    </div>
  );
}
