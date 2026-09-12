"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import Card from "@/components/admin/Card";
import EmptyState from "@/components/admin/EmptyState";
import PageHeader from "@/components/admin/PageHeader";
import StatusPill from "@/components/admin/StatusPill";
import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { getBrowserClient } from "@/lib/supabase/browser";
import { createRequestSequencer } from "@/lib/utils/latest-request";

import {
  EMPTY_MOVEMENT_FILTERS,
  MOVEMENT_REASONS,
  buildMovementQueryPlan,
  canReverse,
  hasActiveFilters,
  reasonLabel,
  type MovementFilters,
} from "./filters";

const PAGE_SIZE = 50;

/**
 * Verified against the live project before being written here (the `holders`
 * embeds need explicit FK hints because stock_movements has *two* foreign
 * keys into holders, and PostgREST refuses an ambiguous embed; `products` and
 * `members` have exactly one each and resolve by relation name).
 *
 * `holdings` could not be joined this way -- it is a view over a union with
 * no declared foreign keys, so it supports no embeds at all. That is why
 * /admin/holdings joins in TypeScript and this page does not have to.
 */
const MOVEMENT_SELECT =
  "id, created_at, qty, reason, entry_method, scan_code, reverses_movement_id, " +
  "product_id, from_holder_id, to_holder_id, actor_member_id, " +
  "products(name, unit, tier), " +
  "actor:members!stock_movements_actor_member_id_fkey(full_name, display_name), " +
  "from_holder:holders!stock_movements_from_holder_id_fkey(name, kind), " +
  "to_holder:holders!stock_movements_to_holder_id_fkey(name, kind)";

interface MovementRow {
  id: number;
  created_at: string;
  qty: number;
  reason: string | null;
  entry_method: string | null;
  scan_code: string | null;
  reverses_movement_id: number | null;
  product_id: string;
  from_holder_id: string;
  to_holder_id: string;
  actor_member_id: string | null;
  products: { name: string; unit: string; tier: string } | null;
  actor: { full_name: string; display_name: string | null } | null;
  from_holder: { name: string; kind: string } | null;
  to_holder: { name: string; kind: string } | null;
}

interface OptionRow {
  id: string;
  name: string;
}

function actorLabel(row: MovementRow): string {
  if (!row.actor) return "—";
  return row.actor.display_name ?? row.actor.full_name;
}

function holderLabel(holder: { name: string; kind: string } | null): string {
  if (!holder) return "—";
  return holder.name;
}

/**
 * /admin/movements -- the ledger, read back.
 *
 * stock_movements has recorded `reason`, `scan_code`, `entry_method` and
 * `actor_member_id` on every row since the first migration and nothing in the
 * app ever read them. This page is where a discrepancy stops being a mystery.
 *
 * The ledger is append-only (0021 splits the admin FOR ALL policy into
 * SELECT + INSERT, so UPDATE and DELETE have no matching policy and RLS
 * default-denies). A mistake is therefore corrected by *writing a mirror row*
 * through admin_reverse_movement, never by editing or deleting the original.
 */
export default function AdminMovementsPage() {
  const supabase = useMemo(() => getBrowserClient(), []);

  const [filters, setFilters] = useState<MovementFilters>(EMPTY_MOVEMENT_FILTERS);
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<MovementRow[]>([]);
  const [reversedIds, setReversedIds] = useState<ReadonlySet<number>>(new Set());
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [products, setProducts] = useState<OptionRow[]>([]);
  const [holders, setHolders] = useState<OptionRow[]>([]);
  const [members, setMembers] = useState<OptionRow[]>([]);

  const [openReversalId, setOpenReversalId] = useState<number | null>(null);
  const [reversalNote, setReversalNote] = useState("");
  const [reversingId, setReversingId] = useState<number | null>(null);
  const [rowError, setRowError] = useState<Record<number, string>>({});
  const [feedback, setFeedback] = useState<{
    variant: "success" | "error" | "info";
    message: string;
  } | null>(null);

  /** One token per reversal *submission*, so an ambiguous failure can be
   *  retried without risking a second mirror row. Keyed by movement id. */
  const reversalTokens = useRef<Map<number, string>>(new Map());

  /** Request-ordering guard for loadMovements -- see latest-request.ts. The
   *  effect's `cancelled` flag cannot help here: it only fires on teardown,
   *  so two overlapping filter changes could still land out of order and
   *  paint stale rows under a newer filter. */
  const sequencer = useRef(createRequestSequencer());

  const loadMovements = useCallback(async () => {
    const ticket = sequencer.current.start();
    setLoading(true);
    setLoadError(null);
    // Never carry the previous page's reversal marks into this one: they are
    // keyed by movement id and nothing below clears them on a failed lookup.
    setReversedIds(new Set());

    const plan = buildMovementQueryPlan(filters);
    let query = supabase
      .from("stock_movements")
      .select(MOVEMENT_SELECT)
      // (created_at desc) is indexed as of 0016; `id` is the tiebreaker so a
      // batch written in one transaction (all sharing a created_at to the
      // microsecond) cannot shuffle between pages.
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    for (const { column, value } of plan.eq) query = query.eq(column, value);
    if (plan.or) query = query.or(plan.or);
    if (plan.gte) query = query.gte("created_at", plan.gte);
    if (plan.lt) query = query.lt("created_at", plan.lt);

    // Fetch one extra row instead of asking for an exact count: knowing
    // whether a next page exists is all the pager needs, and `count: exact`
    // is a full scan that gets more expensive every month.
    const from = page * PAGE_SIZE;
    const { data, error } = await query.range(from, from + PAGE_SIZE);
    if (!sequencer.current.isCurrent(ticket)) return; // superseded mid-flight

    if (error) {
      setLoadError(error.message);
      setRows([]);
      setHasNextPage(false);
      setLoading(false);
      return;
    }

    const fetched = (data ?? []) as unknown as MovementRow[];
    const pageRows = fetched.slice(0, PAGE_SIZE);
    setHasNextPage(fetched.length > PAGE_SIZE);
    setRows(pageRows);

    // "Has this row already been reversed?" is the *child* side of
    // reverses_movement_id. PostgREST can only embed the parent side of a
    // self-reference without ambiguity, so this is a second cheap query
    // scoped to the ids on screen rather than a fragile embed.
    if (pageRows.length > 0) {
      const { data: reversals, error: reversalErr } = await supabase
        .from("stock_movements")
        .select("reverses_movement_id")
        .in(
          "reverses_movement_id",
          pageRows.map((row) => row.id),
        );
      if (!sequencer.current.isCurrent(ticket)) return;
      if (!reversalErr) {
        setReversedIds(
          new Set(
            (reversals ?? [])
              .map((r) => r.reverses_movement_id)
              .filter((id): id is number => id !== null),
          ),
        );
      }
      // On an error the set stays empty (cleared above) rather than keeping
      // another page's ids: an unmarked reversed row offers a reversal that
      // the RPC will refuse, which is recoverable; a wrongly-marked row hides
      // a correction someone needs to make.
    }

    setLoading(false);
  }, [filters, page, supabase]);

  // Filter option lists. Mount-only: products, holders and members all change
  // far more slowly than this page is refreshed.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [productsRes, holdersRes, membersRes] = await Promise.all([
        supabase
          .from("products")
          .select("id, name")
          .eq("active", true)
          .order("name"),
        supabase.from("holders").select("id, name, kind").order("kind").order("name"),
        supabase.from("members").select("id, full_name, display_name").order("full_name"),
      ]);
      if (cancelled) return;
      setProducts(productsRes.data ?? []);
      setHolders(
        (holdersRes.data ?? []).map((h) => ({
          id: h.id,
          name: `${h.name} (${h.kind})`,
        })),
      );
      setMembers(
        (membersRes.data ?? []).map((m) => ({
          id: m.id,
          name: m.display_name ?? m.full_name,
        })),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!cancelled) await loadMovements();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadMovements]);

  function updateFilter<K extends keyof MovementFilters>(
    key: K,
    value: MovementFilters[K],
  ) {
    setFilters((prev) => ({ ...prev, [key]: value }));
    setPage(0);
  }

  function openReversal(id: number) {
    setOpenReversalId(id);
    setReversalNote("");
    setRowError((prev) => ({ ...prev, [id]: "" }));
  }

  async function handleReverse(row: MovementRow) {
    const trimmed = reversalNote.trim();
    if (trimmed.length < 3) {
      setRowError((prev) => ({
        ...prev,
        [row.id]: "Say briefly why this is being reversed — it goes into the ledger.",
      }));
      return;
    }

    let token = reversalTokens.current.get(row.id);
    if (!token) {
      token = crypto.randomUUID();
      reversalTokens.current.set(row.id, token);
    }

    setReversingId(row.id);
    setRowError((prev) => ({ ...prev, [row.id]: "" }));

    const { error } = await supabase.rpc("admin_reverse_movement", {
      p_movement_id: row.id,
      p_note: trimmed,
      p_client_token: token,
    });
    setReversingId(null);

    if (error) {
      setRowError((prev) => ({ ...prev, [row.id]: error.message }));
      return;
    }

    reversalTokens.current.delete(row.id);
    setOpenReversalId(null);
    setReversalNote("");
    setFeedback({
      variant: "success",
      message: `Movement #${row.id} reversed. The original stays in the ledger; a mirror row now cancels it out.`,
    });
    await loadMovements();
  }

  const filtersActive = hasActiveFilters(filters);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Movements"
        description="Every stock change ever recorded, newest first. The ledger is append-only: a mistake is corrected by writing its mirror, never by editing or deleting the original."
        actions={
          filtersActive ? (
            <Button
              variant="secondary"
              className="min-h-0 px-2 py-1 text-xs"
              onClick={() => {
                setFilters(EMPTY_MOVEMENT_FILTERS);
                setPage(0);
              }}
            >
              Clear filters
            </Button>
          ) : null
        }
      />

      {feedback ? (
        <Toast
          variant={feedback.variant}
          message={feedback.message}
          onDismiss={() => setFeedback(null)}
        />
      ) : null}

      <Card title="Filters">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm text-neutral-200">
            Product
            <select
              value={filters.productId}
              onChange={(e) => updateFilter("productId", e.target.value)}
              className="min-h-11 rounded-lg border border-neutral-700 px-3 text-base"
            >
              <option value="">Any product</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-neutral-200">
            Holder (from or to)
            <select
              value={filters.holderId}
              onChange={(e) => updateFilter("holderId", e.target.value)}
              className="min-h-11 rounded-lg border border-neutral-700 px-3 text-base"
            >
              <option value="">Any holder</option>
              {holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-neutral-200">
            Member (who did it)
            <select
              value={filters.memberId}
              onChange={(e) => updateFilter("memberId", e.target.value)}
              className="min-h-11 rounded-lg border border-neutral-700 px-3 text-base"
            >
              <option value="">Anyone</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-neutral-200">
            Reason
            <select
              value={filters.reason}
              onChange={(e) => updateFilter("reason", e.target.value)}
              className="min-h-11 rounded-lg border border-neutral-700 px-3 text-base"
            >
              <option value="">Any reason</option>
              {MOVEMENT_REASONS.map((reason) => (
                <option key={reason} value={reason}>
                  {reasonLabel(reason)}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1 text-sm text-neutral-200">
            From date
            <input
              type="date"
              value={filters.dateFrom}
              onChange={(e) => updateFilter("dateFrom", e.target.value)}
              className="min-h-11 rounded-lg border border-neutral-700 px-3 text-base"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm text-neutral-200">
            To date
            <input
              type="date"
              value={filters.dateTo}
              onChange={(e) => updateFilter("dateTo", e.target.value)}
              className="min-h-11 rounded-lg border border-neutral-700 px-3 text-base"
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-neutral-400">
          Dates are Singapore days, inclusive of both ends.
        </p>
      </Card>

      <Card
        title="Ledger"
        padded={false}
        actions={
          <span className="text-xs text-neutral-400">
            {loading
              ? "Loading…"
              : rows.length === 0
                ? "No rows"
                : `Rows ${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + rows.length}`}
          </span>
        }
      >
        {loading ? (
          <p className="p-4 text-sm text-neutral-400">Loading…</p>
        ) : loadError ? (
          <p className="p-4 text-sm text-red-400">{loadError}</p>
        ) : rows.length === 0 ? (
          <EmptyState
            message={
              filtersActive
                ? "No movements match these filters."
                : "No movements recorded yet."
            }
          />
        ) : (
          <ul>
            {rows.map((row) => {
              const reversed = reversedIds.has(row.id);
              const reversible = canReverse(row, reversedIds);
              const isOpen = openReversalId === row.id;
              return (
                <li
                  key={row.id}
                  className="border-b border-neutral-800 px-4 py-3 last:border-0"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-neutral-100">
                          {row.products?.name ?? "(deleted product)"}
                        </span>
                        <span className="tabular-nums text-neutral-300">
                          ×{row.qty}
                          {row.products?.unit ? ` ${row.products.unit}` : ""}
                        </span>
                        <StatusPill
                          tone={
                            row.reason === "correction"
                              ? "warning"
                              : row.reason === "stocktake_loss"
                                ? "danger"
                                : "inactive"
                          }
                        >
                          {reasonLabel(row.reason)}
                        </StatusPill>
                        {reversed ? (
                          <StatusPill tone="warning">Reversed</StatusPill>
                        ) : null}
                      </div>
                      <div className="mt-1 text-neutral-300">
                        {holderLabel(row.from_holder)}{" "}
                        <span className="text-neutral-500">→</span>{" "}
                        {holderLabel(row.to_holder)}
                      </div>
                      <div className="mt-1 text-xs text-neutral-400">
                        #{row.id} · {new Date(row.created_at).toLocaleString()} ·{" "}
                        {actorLabel(row)}
                        {row.entry_method ? ` · ${row.entry_method}` : ""}
                        {row.scan_code ? ` · ${row.scan_code}` : ""}
                        {row.reverses_movement_id
                          ? ` · reverses #${row.reverses_movement_id}`
                          : ""}
                      </div>
                    </div>

                    <div className="shrink-0">
                      {reversible ? (
                        isOpen ? (
                          <Button
                            variant="ghost"
                            className="min-h-0 px-2 py-1 text-xs"
                            onClick={() => setOpenReversalId(null)}
                          >
                            Cancel
                          </Button>
                        ) : (
                          <Button
                            variant="danger"
                            className="min-h-0 px-2 py-1 text-xs"
                            onClick={() => openReversal(row.id)}
                          >
                            Reverse this
                          </Button>
                        )
                      ) : (
                        <span className="text-xs text-neutral-500">
                          {row.reason === "correction"
                            ? "Correction row"
                            : "Already reversed"}
                        </span>
                      )}
                    </div>
                  </div>

                  {rowError[row.id] ? (
                    <p className="mt-2 text-sm text-red-400">{rowError[row.id]}</p>
                  ) : null}

                  {isOpen ? (
                    <div className="mt-3 border-t border-neutral-800 pt-3">
                      <label className="flex flex-col gap-1 text-sm text-neutral-200">
                        Why is this being reversed?
                        <input
                          type="text"
                          autoFocus
                          value={reversalNote}
                          onChange={(e) => setReversalNote(e.target.value)}
                          placeholder="e.g. scanned the wrong bin"
                          className="min-h-11 w-full rounded-lg border border-neutral-700 px-3 text-base text-neutral-100"
                        />
                      </label>
                      <p className="mt-2 text-xs text-neutral-400">
                        This writes a new movement with the holders swapped and
                        reason “correction”. Movement #{row.id} stays in the
                        ledger exactly as it is.
                      </p>
                      <div className="mt-3">
                        <Button
                          variant="danger"
                          disabled={reversingId === row.id}
                          onClick={() => handleReverse(row)}
                        >
                          {reversingId === row.id
                            ? "Reversing…"
                            : "Write the correction"}
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="secondary"
          disabled={page === 0 || loading}
          onClick={() => setPage((p) => Math.max(0, p - 1))}
        >
          Previous
        </Button>
        <span className="text-sm text-neutral-400">Page {page + 1}</span>
        <Button
          variant="secondary"
          disabled={!hasNextPage || loading}
          onClick={() => setPage((p) => p + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
