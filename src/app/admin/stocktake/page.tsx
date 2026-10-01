"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import Card from "@/components/admin/Card";
import EmptyState from "@/components/admin/EmptyState";
import PageHeader from "@/components/admin/PageHeader";
import { TableSkeleton } from "@/components/admin/Skeleton";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import Toast from "@/components/ui/Toast";
import { IconChevronRight, IconCheck } from "@/components/ui/icons";
import { revalidateStock } from "@/lib/admin/queries";
import { getBrowserClient } from "@/lib/supabase/browser";
import { fetchAllRows } from "@/lib/supabase/fetch-all";

import { UNASSIGNED_LOCATION_NAME } from "./variance";
import {
  addWalkProduct,
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
// Rolling stocktake, counted standing at the shelf with a phone in one hand
// (docs/tele-qr/operations.md -- "Stocktake -- rolling, never one big day").
// It lives in /admin per flows.md §6, but the layout is phone-first: one
// product per row, 44px targets, and the commit control pinned within thumb
// reach.
//
// Two kinds of walk:
//  - a store shelf: every active product at one location, against its store
//    quantity. What the club runs monthly.
//  - a robot: everything the ledger says is on one robot, plus anything added
//    by hand. Added for the catalog go-live, whose per-robot allocations came
//    from a spreadsheet that put more motors on robots than the club owns.
// ---------------------------------------------------------------------------

interface CatalogProduct {
  id: string;
  name: string;
  unit: string;
  qtyInStore: number;
  locationId: string | null;
}

interface WalkProduct {
  id: string;
  name: string;
  unit: string;
  expectedQty: number;
}

interface LocationOption {
  /** null = the "no location set" bucket, real while the catalog migrates. */
  id: string | null;
  name: string;
  productCount: number;
}

interface RobotOption {
  id: string;
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
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [locationNames, setLocationNames] = useState<Map<string, string>>(new Map());
  const [robots, setRobots] = useState<{ id: string; name: string }[]>([]);
  /** robot holder id -> product id -> qty the ledger says is on it. */
  const [robotHoldings, setRobotHoldings] = useState<Map<string, Map<string, number>>>(new Map());
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [walk, setWalk] = useState<StocktakeWalk | null>(null);
  const [restored, setRestored] = useState(false);
  const [filter, setFilter] = useState("");
  const [addName, setAddName] = useState("");
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

    try {
      const [locationsRes, summary, robotsRes] = await Promise.all([
        supabase.from("locations").select("id, name").order("name"),
        // stock_summary already filters to active products and gives the
        // store-held quantity, which is exactly the `expected` shown for
        // reference. It is a reference only: admin_commit_stocktake recomputes
        // expected from the ledger at commit time and ignores this number.
        fetchAllRows((from, to) =>
          supabase
            .from("stock_summary")
            .select("product_id, name, unit, qty_in_store, location_id")
            .order("name")
            .order("product_id")
            .range(from, to),
        ),
        supabase.from("holders").select("id, name").eq("kind", "robot").eq("active", true).order("name"),
      ]);
      if (locationsRes.error) throw new Error(locationsRes.error.message);
      if (robotsRes.error) throw new Error(robotsRes.error.message);

      const robotList = robotsRes.data ?? [];
      const holdings = robotList.length
        ? await fetchAllRows((from, to) =>
            supabase
              .from("holdings")
              .select("product_id, holder_id, qty")
              .in(
                "holder_id",
                robotList.map((r) => r.id),
              )
              .order("holder_id")
              .order("product_id")
              .range(from, to),
          )
        : [];

      const byRobot = new Map<string, Map<string, number>>();
      for (const row of holdings) {
        if (!row.holder_id || !row.product_id || !row.qty) continue;
        const held = byRobot.get(row.holder_id) ?? new Map<string, number>();
        held.set(row.product_id, row.qty);
        byRobot.set(row.holder_id, held);
      }

      setLocationNames(new Map((locationsRes.data ?? []).map((l) => [l.id, l.name])));
      setCatalog(
        summary
          .filter((row) => row.product_id !== null)
          .map((row) => ({
            id: row.product_id!,
            name: row.name ?? "Unnamed product",
            unit: row.unit ?? "pcs",
            qtyInStore: row.qty_in_store ?? 0,
            locationId: row.location_id,
          })),
      );
      setRobots(robotList);
      setRobotHoldings(byRobot);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load.");
    } finally {
      setLoading(false);
    }
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

  const catalogById = useMemo(() => new Map(catalog.map((p) => [p.id, p])), [catalog]);

  const locationOptions = useMemo<LocationOption[]>(() => {
    const counts = new Map<string, number>();
    let unassigned = 0;
    for (const product of catalog) {
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
      options.push({ id: null, name: UNASSIGNED_LOCATION_NAME, productCount: unassigned });
    }
    return options;
  }, [catalog, locationNames]);

  const robotOptions = useMemo<RobotOption[]>(
    () => robots.map((r) => ({ ...r, productCount: robotHoldings.get(r.id)?.size ?? 0 })),
    [robots, robotHoldings],
  );

  const walkProducts = useMemo<WalkProduct[]>(() => {
    if (!walk) return [];
    if (walk.holderId) {
      const held = robotHoldings.get(walk.holderId) ?? new Map<string, number>();
      const ids = [...new Set([...held.keys(), ...walk.addedProductIds])];
      return ids
        .flatMap((id) => {
          const product = catalogById.get(id);
          return product ? [{ id, name: product.name, unit: product.unit, expectedQty: held.get(id) ?? 0 }] : [];
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    return catalog
      .filter((p) => p.locationId === walk.locationId)
      .map((p) => ({ id: p.id, name: p.name, unit: p.unit, expectedQty: p.qtyInStore }));
  }, [walk, catalog, catalogById, robotHoldings]);

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
  const isRobotWalk = Boolean(walk?.holderId);

  function beginWalk(next: StocktakeWalk) {
    setWalk(next);
    setRestored(false);
    setFilter("");
    setAddName("");
    setNote("");
    setReceipt(null);
    setFeedback(null);
  }

  function startWalk(option: LocationOption) {
    // One token per WALK, not per request: a commit that times out can be
    // retried with the same token and admin_commit_stocktake will return the
    // original session rather than correcting twice.
    beginWalk(newWalk({ clientToken: crypto.randomUUID(), locationId: option.id, locationName: option.name }));
  }

  function startRobotWalk(robot: RobotOption) {
    beginWalk(
      newWalk({ clientToken: crypto.randomUUID(), holderId: robot.id, locationId: null, locationName: robot.name }),
    );
  }

  function discardWalk() {
    clearStoredWalk();
    setWalk(null);
    setRestored(false);
    setFilter("");
    setAddName("");
    setNote("");
    setConfirmOpen(false);
    setFeedback(null);
  }

  function handleCountChange(productId: string, raw: string) {
    setWalk((current) => (current ? setWalkCount(current, productId, raw) : current));
  }

  function handleAddProduct(e: React.FormEvent) {
    e.preventDefault();
    if (!walk) return;
    const wanted = addName.trim().toLowerCase();
    const product = catalog.find((p) => p.name.toLowerCase() === wanted);
    if (!product) {
      setFeedback({ variant: "error", message: "Pick a product from the suggestions." });
      return;
    }
    if (walkProducts.some((p) => p.id === product.id)) {
      setFeedback({ variant: "info", message: `${product.name} is already on this count.` });
      return;
    }
    setWalk(addWalkProduct(walk, product.id));
    setAddName("");
    setFeedback(null);
  }

  async function handleCommit() {
    if (!walk) return;
    setFeedback(null);

    const payload = buildCommitPayload(walk);
    if (!payload.ok) {
      const first = payload.invalid[0];
      const name = walkProducts.find((p) => p.id === first.productId)?.name ?? "one of the products";
      setFeedback({ variant: "error", message: `${name}: ${COUNT_ERROR_MESSAGES[first.reason]}` });
      setConfirmOpen(false);
      return;
    }

    const supabase = getBrowserClient();
    const trimmedNote = note.trim();

    setCommitting(true);
    const { data, error } = await supabase.rpc("admin_commit_stocktake", {
      p_counts: payload.counts,
      ...(walk.holderId ? { p_holder_id: walk.holderId } : {}),
      ...(!walk.holderId && walk.locationId ? { p_location_id: walk.locationId } : {}),
      ...(trimmedNote ? { p_note: trimmedNote } : {}),
      p_client_token: walk.clientToken,
    });

    if (error) {
      setCommitting(false);
      setConfirmOpen(false);
      // Keep the walk, the counts AND the token. The counter is standing at
      // the shelf; making them re-walk it is the fastest way to teach them not
      // to bother. Retrying reuses the token, so a commit that actually landed
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

    const lines: CommitReceiptLine[] = (rows ?? []).map((row) => ({
      productId: row.product_id,
      productName: catalogById.get(row.product_id)?.name ?? "Unknown product",
      countedQty: row.counted_qty,
      expectedQty: row.expected_qty,
      variance: row.counted_qty - row.expected_qty,
      hadMovement: row.movement_id !== null,
    }));
    lines.sort(
      (a, b) => Math.abs(b.variance) - Math.abs(a.variance) || a.productName.localeCompare(b.productName),
    );

    clearStoredWalk();
    setReceipt({ sessionId, locationName: walk.locationName, lines });
    setWalk(null);
    setRestored(false);
    setNote("");
    setFilter("");
    setAddName("");
    setConfirmOpen(false);
    setCommitting(false);
    if (rowsError) {
      setFeedback({
        variant: "info",
        message: `Counts committed, but the summary could not be read back: ${rowsError.message}`,
      });
    }
    // Expected quantities have just moved; reload so a second walk of the
    // same shelf doesn't show pre-correction numbers, and tell every other
    // page's cache (holdings, dashboard, variance) the same.
    void revalidateStock();
    await loadData();
  }

  // The variance report is the "Variance" tab above (AdminShell), so the
  // header carries no link of its own.
  const header = (
    <PageHeader
      title="Stocktake"
      description="Count one shelf, or one robot, at a time."
      info="Committing writes the correction for you; nobody edits numbers by hand. The expected figures shown are a reference only: the database recomputes them from the ledger at commit time."
    />
  );

  // --- committed receipt ---------------------------------------------------
  if (receipt) {
    const corrected = receipt.lines.filter((l) => l.hadMovement);
    return (
      <div className="flex flex-col gap-6">
        {header}
        {feedback ? (
          <Toast variant={feedback.variant} message={feedback.message} onDismiss={() => setFeedback(null)} />
        ) : null}
        <Card title={`Counted: ${receipt.locationName}`}>
          <p className="text-sm text-neutral-300">
            {receipt.lines.length} product
            {receipt.lines.length === 1 ? "" : "s"} counted, {corrected.length} corrected.{" "}
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
                  <span className="min-w-0 flex-1 truncate text-sm text-neutral-100">{line.productName}</span>
                  <span className="text-xs text-neutral-400 tabular-nums">
                    counted {line.countedQty} · ledger said {line.expectedQty}
                  </span>
                  <StatusPill tone="warning">{formatVariance(line.variance)}</StatusPill>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="mt-3 text-xs text-neutral-400">
            Variance is a diagnostic, not an accusation — a part that drifts every time is one people aren&apos;t
            logging, which is a flow to fix rather than a person to chase.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => setReceipt(null)}>Count something else</Button>
            <Link
              href="/admin/stocktake/variance"
              className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-medium text-neutral-300 hover:bg-neutral-800 hover:text-neutral-100"
            >
              Variance report →
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  // --- what to count -------------------------------------------------------
  if (!walk) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        {feedback ? (
          <Toast variant={feedback.variant} message={feedback.message} onDismiss={() => setFeedback(null)} />
        ) : null}
        <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card title="Count a store shelf" padded={false}>
          {loading ? (
            <TableSkeleton rows={5} />
          ) : loadError ? (
            <p className="p-4 text-sm text-red-400">{loadError}</p>
          ) : locationOptions.length === 0 ? (
            <EmptyState message="No active products have a location yet. Set locations on the products page first — a stocktake walks a shelf, so it needs to know what lives on one." />
          ) : (
            <ul>
              {locationOptions.map((option) => (
                <li key={option.id ?? "unassigned"} className="border-b border-neutral-800 last:border-0">
                  <button
                    type="button"
                    onClick={() => startWalk(option)}
                    className="flex min-h-tap w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium text-neutral-100">{option.name}</span>
                      <span className="block text-xs text-neutral-400">
                        {option.productCount} product{option.productCount === 1 ? "" : "s"}
                      </span>
                    </span>
                    <IconChevronRight size={18} className="text-neutral-500" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Count a robot" padded={false}>
          {loading ? (
            <TableSkeleton rows={5} />
          ) : loadError ? null : robotOptions.length === 0 ? (
            <EmptyState message="No robots yet." />
          ) : (
            <ul>
              {robotOptions.map((robot) => (
                <li key={robot.id} className="border-b border-neutral-800 last:border-0">
                  <button
                    type="button"
                    onClick={() => startRobotWalk(robot)}
                    className="flex min-h-tap w-full items-center gap-3 px-4 py-3 text-left hover:bg-neutral-800/50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-medium text-neutral-100">{robot.name}</span>
                      <span className="block text-xs text-neutral-400">
                        {robot.productCount === 0
                          ? "Nothing on the ledger — add what's on it"
                          : `${robot.productCount} product${robot.productCount === 1 ? "" : "s"} on the ledger`}
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
        <Toast variant={feedback.variant} message={feedback.message} onDismiss={() => setFeedback(null)} />
      ) : null}

      <Card padded={false}>
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-4 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-neutral-100">
              {isRobotWalk ? `Robot: ${walk.locationName}` : walk.locationName}
            </h2>
            <p className="text-xs text-neutral-400">
              {entered} of {walkProducts.length} entered · blanks are skipped, not counted as zero
            </p>
          </div>
          <Button variant="ghost" size="sm" onClick={discardWalk}>
            Discard count
          </Button>
        </div>

        {isRobotWalk ? (
          <form onSubmit={handleAddProduct} className="flex gap-2 border-b border-neutral-800 px-4 py-2">
            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              list="stocktake-products"
              placeholder="Something on the robot that isn't listed? Add it…"
              className="min-h-tap min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-base text-neutral-100 placeholder:text-neutral-500"
            />
            <datalist id="stocktake-products">
              {catalog.map((p) => (
                <option key={p.id} value={p.name} />
              ))}
            </datalist>
            <Button type="submit" variant="secondary" disabled={!addName.trim()}>
              Add
            </Button>
          </form>
        ) : null}

        {walkProducts.length > 8 ? (
          <div className="border-b border-neutral-800 px-4 py-2">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={isRobotWalk ? "Filter this robot…" : "Filter this shelf…"}
              className="min-h-tap w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-base text-neutral-100 placeholder:text-neutral-500"
            />
          </div>
        ) : null}

        {loading ? (
          <TableSkeleton rows={5} />
        ) : visibleProducts.length === 0 ? (
          <EmptyState
            message={
              walkProducts.length > 0
                ? "Nothing here matches that filter."
                : isRobotWalk
                  ? "The ledger has nothing on this robot. Add each part you find on it above."
                  : "Nothing active is assigned to this location any more. Discard the count and pick another shelf."
            }
          />
        ) : (
          // A list, not a DataTable: this is a form walked one row at a time
          // on a phone, and a table's cells fight the 44px inputs.
          <ul>
            {visibleProducts.map((product) => {
              const raw = walk.counts[product.id] ?? "";
              const parsed = parseCountInput(raw);
              const variance = parsed.ok ? varianceOf(parsed.value, product.expectedQty) : null;
              const direction = variance === null ? null : varianceDirection(variance);
              return (
                <li
                  key={product.id}
                  className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2 last:border-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-neutral-100">{product.name}</p>
                    <p className="text-xs text-neutral-400 tabular-nums">
                      Ledger says {product.expectedQty} {product.unit}
                    </p>
                  </div>
                  <div className="w-12 shrink-0 text-right">
                    {direction === "match" ? (
                      <IconCheck size={16} className="ml-auto text-neutral-500" aria-label="Matches the ledger" />
                    ) : direction ? (
                      <StatusPill tone="warning">{formatVariance(variance!)}</StatusPill>
                    ) : !parsed.ok && parsed.reason !== "empty" ? (
                      <span className="text-xs text-amber-400">check</span>
                    ) : null}
                  </div>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    value={raw}
                    onChange={(e) => handleCountChange(product.id, e.target.value)}
                    aria-label={`Counted quantity for ${product.name}`}
                    placeholder="—"
                    className="min-h-tap w-20 shrink-0 rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-right text-base tabular-nums text-neutral-100 placeholder:text-neutral-600"
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
          className="min-h-tap rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-base text-neutral-100 placeholder:text-neutral-500"
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

      <Sheet open={confirmOpen} onClose={() => setConfirmOpen(false)} title="Commit this count?">
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
            <StatusPill tone="warning">{(summary?.gains ?? 0) + (summary?.losses ?? 0)} to correct</StatusPill>
          </div>
          <p className="text-xs text-neutral-400">
            Provisional. Expected quantities are recomputed from the ledger at the moment you commit — if someone
            borrowed while you were counting, the correction uses their movement, not the number on your screen.
            Products that match write no movement at all.
          </p>
          <div className="flex gap-2">
            <Button onClick={handleCommit} disabled={committing}>
              {committing ? "Committing…" : "Commit count"}
            </Button>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={committing}>
              Keep counting
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
