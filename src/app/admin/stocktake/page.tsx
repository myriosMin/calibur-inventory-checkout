"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import EmptyState from "@/components/admin/EmptyState";
import PageHeader from "@/components/admin/PageHeader";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import Toast from "@/components/ui/Toast";
import { IconChevronRight, IconCheck } from "@/components/ui/icons";
import { getBrowserClient } from "@/lib/supabase/browser";

import { UNASSIGNED_LOCATION_NAME } from "./variance";
import {
  buildCommitPayload,
  clearStoredWalk,
  COUNT_ERROR_MESSAGES,
  enteredCount,
  formatVariance,
  loadStoredWalk,
  newWalk,
  parseCountInput,
  setWalkCount,
  storeWalk,
  summariseWalk,
  varianceDirection,
  varianceOf,
  type StocktakeWalk,
} from "./walk";

// ---------------------------------------------------------------------------
// Rolling stocktake: one location at a time, counted standing at the shelf
// with a phone in one hand (docs/tele-qr/operations.md -- "Stocktake --
// rolling, never one big day"). It lives in /admin per flows.md §6, but the
// layout is phone-first: one product per row, 44px targets, and the commit
// control pinned within thumb reach.
//
// The count is scoped to the STORE holder. The RPC takes a p_holder_id and
// can stocktake a robot's holdings, but "walk a shelf" is the flow the club
// actually runs monthly, and a holder picker would add a second decision at
// the shelf for a case nobody has asked for yet.
// ---------------------------------------------------------------------------

interface WalkProduct {
  id: string;
  name: string;
  tier: string;
  unit: string;
  expectedQty: number;
  locationId: string | null;
}

interface LocationOption {
  /** null = the "no location set" bucket, real while the catalog migrates. */
  id: string | null;
  name: string;
  productCount: number;
}

interface CommitReceiptLine {
  productId: string;
  productName: string;
  countedQty: number;
  expectedQty: number;
  variance: number;
  hadMovement: boolean;
}

interface CommitReceipt {
  sessionId: string;
  locationName: string;
  lines: CommitReceiptLine[];
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "earlier";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export default function AdminStocktakePage() {
  const [products, setProducts] = useState<WalkProduct[]>([]);
  const [locationNames, setLocationNames] = useState<Map<string, string>>(
    new Map(),
  );
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [walk, setWalk] = useState<StocktakeWalk | null>(null);
  const [restored, setRestored] = useState(false);
  const [filter, setFilter] = useState("");
  const [note, setNote] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [receipt, setReceipt] = useState<CommitReceipt | null>(null);
  const [feedback, setFeedback] = useState<{
    variant: "success" | "error" | "info";
    message: string;
  } | null>(null);

  const loadData = async () => {
    setLoading(true);
    setLoadError(null);
    const supabase = getBrowserClient();

    const [locationsRes, summaryRes] = await Promise.all([
      supabase.from("locations").select("id, name").order("name"),
      // stock_summary already filters to active products and gives the
      // store-held quantity, which is exactly the `expected` shown for
      // reference. It is a reference only: admin_commit_stocktake recomputes
      // expected from the ledger at commit time and ignores this number.
      supabase
        .from("stock_summary")
        .select("product_id, name, tier, unit, qty_in_store, location_id")
        .order("name"),
    ]);

    if (locationsRes.error) {
      setLoadError(locationsRes.error.message);
    } else {
      setLocationNames(
        new Map((locationsRes.data ?? []).map((l) => [l.id, l.name])),
      );
    }

    if (summaryRes.error) {
      setLoadError((prev) => prev ?? summaryRes.error!.message);
    } else {
      setProducts(
        (summaryRes.data ?? [])
          .filter((row) => row.product_id !== null)
          .map((row) => ({
            id: row.product_id!,
            name: row.name ?? "Unnamed product",
            tier: row.tier ?? "loose",
            unit: row.unit ?? "pcs",
            expectedQty: row.qty_in_store ?? 0,
            locationId: row.location_id,
          })),
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadData();
      if (cancelled) return;
      // Pick the walk back up. A backgrounded phone tab is the normal way a
      // count ends, not the exceptional one. Restoring AFTER the fetch (not
      // in a second effect) keeps localStorage out of the render pass, where
      // it would differ between the server pass and the client and trip a
      // hydration mismatch.
      const stored = loadStoredWalk();
      if (stored) {
        setWalk(stored);
        setRestored(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist on every keystroke. An hour of counting is far too expensive to
  // lose; a few hundred bytes of localStorage churn costs nothing.
  useEffect(() => {
    if (walk) storeWalk(walk);
  }, [walk]);

  const locationOptions = useMemo<LocationOption[]>(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const product of products) {
      if (product.locationId === null) unassigned += 1;
      else counts.set(product.locationId, (counts.get(product.locationId) ?? 0) + 1);
    }
    const options: LocationOption[] = [...counts.entries()].map(([id, n]) => ({
      id,
      name: locationNames.get(id) ?? id,
      productCount: n,
    }));
    options.sort((a, b) => a.name.localeCompare(b.name));
    if (unassigned > 0) {
      options.push({
        id: null,
        name: UNASSIGNED_LOCATION_NAME,
        productCount: unassigned,
      });
    }
    return options;
  }, [products, locationNames]);

  const walkProducts = useMemo<WalkProduct[]>(() => {
    if (!walk) return [];
    return products.filter((p) => p.locationId === walk.locationId);
  }, [products, walk]);

  const visibleProducts = useMemo<WalkProduct[]>(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return walkProducts;
    return walkProducts.filter((p) => p.name.toLowerCase().includes(needle));
  }, [walkProducts, filter]);

  const expectedByProduct = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    for (const p of walkProducts) map[p.id] = p.expectedQty;
    return map;
  }, [walkProducts]);

  const entered = walk ? enteredCount(walk) : 0;
  const summary = walk ? summariseWalk(walk, expectedByProduct) : null;

  function startWalk(option: LocationOption) {
    setWalk(
      newWalk({
        // One token per WALK, not per request: a commit that times out can be
        // retried with the same token and admin_commit_stocktake will return
        // the original session rather than correcting twice.
        clientToken: crypto.randomUUID(),
        locationId: option.id,
        locationName: option.name,
      }),
    );
    setRestored(false);
    setFilter("");
    setNote("");
    setReceipt(null);
    setFeedback(null);
  }

  function discardWalk() {
    clearStoredWalk();
    setWalk(null);
    setRestored(false);
    setFilter("");
    setNote("");
    setConfirmOpen(false);
    setFeedback(null);
  }

  function handleCountChange(productId: string, raw: string) {
    setWalk((current) =>
      current ? setWalkCount(current, productId, raw) : current,
    );
  }

  async function handleCommit() {
    if (!walk) return;
    setFeedback(null);

    const payload = buildCommitPayload(walk);
    if (!payload.ok) {
      const first = payload.invalid[0];
      const name =
        walkProducts.find((p) => p.id === first.productId)?.name ??
        "one of the products";
      setFeedback({
        variant: "error",
        message: `${name}: ${COUNT_ERROR_MESSAGES[first.reason]}`,
      });
      setConfirmOpen(false);
      return;
    }

    const supabase = getBrowserClient();
    const trimmedNote = note.trim();

    setCommitting(true);
    const { data, error } = await supabase.rpc("admin_commit_stocktake", {
      p_counts: payload.counts,
      ...(walk.locationId ? { p_location_id: walk.locationId } : {}),
      ...(trimmedNote ? { p_note: trimmedNote } : {}),
      p_client_token: walk.clientToken,
    });

    if (error) {
      setCommitting(false);
      setConfirmOpen(false);
      // Keep the walk, the counts AND the token. The admin is standing at the
      // shelf; making them re-walk it is the fastest way to teach them not to
      // bother. Retrying reuses the token, so a commit that actually landed
      // before the connection dropped will not correct twice.
      setFeedback({
        variant: "error",
        message: `Commit failed: ${error.message} — your counts are still here, press Commit again to retry.`,
      });
      return;
    }

    const sessionId = data as string;

    // Read the committed rows back rather than showing what was on screen:
    // `expected` was recomputed server-side, so these are the only numbers
    // worth reporting.
    const { data: rows, error: rowsError } = await supabase
      .from("stock_counts")
      .select("product_id, counted_qty, expected_qty, movement_id")
      .eq("session_id", sessionId);

    const nameById = new Map(products.map((p) => [p.id, p.name]));
    const lines: CommitReceiptLine[] = (rows ?? []).map((row) => ({
      productId: row.product_id,
      productName: nameById.get(row.product_id) ?? "Unknown product",
      countedQty: row.counted_qty,
      expectedQty: row.expected_qty,
      variance: row.counted_qty - row.expected_qty,
      hadMovement: row.movement_id !== null,
    }));
    lines.sort(
      (a, b) =>
        Math.abs(b.variance) - Math.abs(a.variance) ||
        a.productName.localeCompare(b.productName),
    );

    clearStoredWalk();
    setReceipt({ sessionId, locationName: walk.locationName, lines });
    setWalk(null);
    setRestored(false);
    setNote("");
    setFilter("");
    setConfirmOpen(false);
    setCommitting(false);
    if (rowsError) {
      setFeedback({
        variant: "info",
        message: `Counts committed, but the summary could not be read back: ${rowsError.message}`,
      });
    }
    // Expected quantities have just moved; reload so a second walk of the
    // same shelf doesn't show pre-correction numbers.
    await loadData();
  }

  const header = (
    <PageHeader
      title="Stocktake"
      description="Count one location at a time — a shelf a month keeps the whole catalog under a year stale. Committing writes the correction for you; nobody edits numbers by hand."
      actions={
        <Link
          href="/admin/stocktake/variance"
          className="inline-flex min-h-11 items-center rounded-lg bg-neutral-800 px-4 text-sm font-medium uppercase tracking-wide text-neutral-100 hover:bg-neutral-700"
        >
          Variance report
        </Link>
      }
    />
  );

  // --- committed receipt ---------------------------------------------------
  if (receipt) {
    const corrected = receipt.lines.filter((l) => l.hadMovement);
    return (
      <div className="flex flex-col gap-6">
        {header}
        {feedback ? (
          <Toast
            variant={feedback.variant}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        ) : null}
        <Card title={`Counted: ${receipt.locationName}`}>
          <p className="text-sm text-neutral-300">
            {receipt.lines.length} product
            {receipt.lines.length === 1 ? "" : "s"} counted,{" "}
            {corrected.length} corrected.{" "}
            {corrected.length === 0
              ? "Everything matched the ledger."
              : "The rest matched the ledger exactly and wrote no movement."}
          </p>
          {corrected.length > 0 ? (
            <ul className="mt-3 flex flex-col gap-2">
              {corrected.map((line) => (
                <li
                  key={line.productId}
                  className="flex items-center justify-between gap-3 rounded-lg bg-neutral-950 px-3 py-2"
                >
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-100">
                    {line.productName}
                  </span>
                  <span className="text-xs text-neutral-400 tabular-nums">
                    counted {line.countedQty} · ledger said {line.expectedQty}
                  </span>
                  <StatusPill tone="warning">
                    {formatVariance(line.variance)}
                  </StatusPill>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-xs text-neutral-400">
            Variance is a diagnostic, not an accusation — a part that drifts
            every time is one people aren&apos;t logging, which is a flow to fix
            rather than a person to chase.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setReceipt(null)}>Count another shelf</Button>
            <Link
              href="/admin/stocktake/variance"
              className="inline-flex min-h-11 items-center rounded-lg bg-neutral-800 px-4 text-sm font-medium uppercase tracking-wide text-neutral-100 hover:bg-neutral-700"
            >
              Variance report
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // --- location picker -----------------------------------------------------
  if (!walk) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {feedback ? (
          <Toast
            variant={feedback.variant}
            message={feedback.message}
            onDismiss={() => setFeedback(null)}
          />
        ) : null}
        <Card title="Pick a location to count" padded={false}>
          {loading ? (
            <p className="p-4 text-sm text-neutral-400">Loading…</p>
          ) : loadError ? (
            <p className="p-4 text-sm text-red-400">{loadError}</p>
          ) : locationOptions.length === 0 ? (
            <EmptyState message="No active products have a location yet. Set locations on the products page first — a stocktake walks a shelf, so it needs to know what lives on one." />
          ) : (
            <ul>
              {locationOptions.map((option) => (
                <li
                  key={option.id ?? "unassigned"}
                  className="border-b border-neutral-800 last:border-0"
                >
                  <button
                    type="button"
                    onClick={() => startWalk(option)}
                    className="flex min-h-tap w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium text-neutral-100">
                        {option.name}
                      </span>
                      <span className="block text-xs text-neutral-400">
                        {option.productCount} product
                        {option.productCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <IconChevronRight size={18} className="text-neutral-500" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    );
  }

  // --- the walk ------------------------------------------------------------
  return (
    <div className="flex flex-col gap-4">
      {header}

      {restored ? (
        <Toast
          variant="info"
          message={`Picked up your count of ${walk.locationName} from ${relativeTime(walk.updatedAt)} — ${entered} product${entered === 1 ? "" : "s"} already entered.`}
          actionLabel="Start over"
          onAction={discardWalk}
          onDismiss={() => setRestored(false)}
        />
      ) : null}

      {feedback ? (
        <Toast
          variant={feedback.variant}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-neutral-100">
              {walk.locationName}
            </h2>
            <p className="text-xs text-neutral-400">
              {entered} of {walkProducts.length} entered · blanks are skipped,
              not counted as zero
            </p>
          </div>
          <Button
            variant="ghost"
            onClick={discardWalk}
            className="min-h-0 px-2 py-1 text-xs"
          >
            Discard count
          </Button>
        </div>

        {walkProducts.length > 8 ? (
          <div className="border-b border-neutral-800 px-4 py-2">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter this shelf…"
              className="min-h-tap w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-base text-neutral-100 placeholder:text-neutral-500"
            />
          </div>
        ) : null}

        {loading ? (
          <p className="p-4 text-sm text-neutral-400">Loading…</p>
        ) : visibleProducts.length === 0 ? (
          <EmptyState
            message={
              walkProducts.length === 0
                ? "Nothing active is assigned to this location any more. Discard the count and pick another shelf."
                : "Nothing on this shelf matches that filter."
            }
          />
        ) : (
          // A list, not a DataTable: this is a form walked one row at a time
          // on a phone, and a table's cells fight the 44px inputs.
          <ul>
            {visibleProducts.map((product) => {
              const raw = walk.counts[product.id] ?? "";
              const parsed = parseCountInput(raw);
              const variance = parsed.ok
                ? varianceOf(parsed.value, product.expectedQty)
                : null;
              const direction =
                variance === null ? null : varianceDirection(variance);
              return (
                <li
                  key={product.id}
                  className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-100">
                      {product.name}
                    </p>
                    <p className="text-xs text-neutral-400 tabular-nums">
                      Ledger says {product.expectedQty} {product.unit}
                    </p>
                  </div>
                  <div className="w-12 shrink-0 text-right">
                    {direction === "match" ? (
                      <IconCheck
                        size={16}
                        className="ml-auto text-neutral-500"
                        aria-label="Matches the ledger"
                      />
                    ) : direction ? (
                      <StatusPill tone="warning">
                        {formatVariance(variance!)}
                      </StatusPill>
                    ) : !parsed.ok && parsed.reason !== "empty" ? (
                      <span className="text-xs text-amber-400">check</span>
                    ) : null}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={raw}
                    onChange={(e) =>
                      handleCountChange(product.id, e.target.value)
                    }
                    aria-label={`Counted quantity for ${product.name}`}
                    placeholder="—"
                    className="min-h-tap w-20 shrink-0 rounded-lg border border-neutral-700 bg-neutral-950 px-3 text-right text-base tabular-nums text-neutral-100 placeholder:text-neutral-600"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <label className="flex flex-col gap-1 text-sm text-neutral-300">
        Note for this count (optional)
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. counted with Wei Ming, bottom drawer was open"
          className="min-h-tap rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-base text-neutral-100 placeholder:text-neutral-500"
        />
      </label>

      {/* Thumb-reachable: the commit control follows the scroll instead of
          living at the bottom of a 157-row list. */}
      <div className="sticky bottom-0 -mx-4 flex items-center gap-3 border-t border-neutral-800 bg-neutral-950/95 px-4 py-3 backdrop-blur">
        <p className="min-w-0 flex-1 text-xs text-neutral-400">
          {entered} of {walkProducts.length} entered
        </p>
        <Button onClick={() => setConfirmOpen(true)} disabled={entered === 0}>
          Review count
        </Button>
      </div>

      <Sheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Commit this count?"
      >
        <div className="flex flex-col gap-3 pb-4">
          <p className="text-sm text-neutral-300">
            {summary?.entered} product
            {summary?.entered === 1 ? "" : "s"} counted on {walk.locationName}.
            {walkProducts.length - entered > 0
              ? ` ${walkProducts.length - entered} left blank will not be touched.`
              : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <StatusPill tone="active">{summary?.matched ?? 0} match</StatusPill>
            <StatusPill tone="warning">
              {(summary?.gains ?? 0) + (summary?.losses ?? 0)} to correct
            </StatusPill>
          </div>
          <p className="text-xs text-neutral-400">
            Provisional. Expected quantities are recomputed from the ledger at
            the moment you commit — if someone borrowed from this shelf while
            you were counting, the correction uses their movement, not the
            number on your screen. Products that match write no movement at
            all.
          </p>
          <div className="flex gap-2">
            <Button onClick={handleCommit} disabled={committing}>
              {committing ? "Committing…" : "Commit count"}
            </Button>
            <Button
              variant="ghost"
              onClick={() => setConfirmOpen(false)}
              disabled={committing}
            >
              Keep counting
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
