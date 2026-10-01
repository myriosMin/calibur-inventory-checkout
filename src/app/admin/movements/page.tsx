"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import ActionMenu from "@/components/admin/ActionMenu";
import Card from "@/components/admin/Card";
import Drawer from "@/components/admin/Drawer";
import EmptyState from "@/components/admin/EmptyState";
import FilterMenu from "@/components/admin/FilterMenu";
import { CAPTION, FIELD, FILTER, HELP, LABEL } from "@/components/admin/form";
import PageHeader from "@/components/admin/PageHeader";
import Skeleton, { TableSkeleton } from "@/components/admin/Skeleton";
import StatusPill from "@/components/admin/StatusPill";
import { DailyStackedBar } from "@/components/admin/charts/lazy";
import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { revalidateStock, useHolders, useMembers, useProducts } from "@/lib/admin/queries";
import { MOVEMENT_GROUP_SERIES, movementsPerDay, seriesPresent } from "@/lib/reports/chart-data";
import { getBrowserClient } from "@/lib/supabase/browser";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
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
/** Window for the activity chart above the ledger. */
const CHART_DAYS = 30;

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
  const supabase = getBrowserClient();

  const [filters, setFilters] = useState<MovementFilters>(EMPTY_MOVEMENT_FILTERS);
  const [page, setPage] = useState(0);

  const [rows, setRows] = useState<MovementRow[]>([]);
  const [reversedIds, setReversedIds] = useState<ReadonlySet<number>>(new Set());
  const [hasNextPage, setHasNextPage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Filter option lists come from the shared cache instead of three more
  // unpaged reads on every visit.
  const productsQ = useProducts();
  const holdersQ = useHolders();
  const membersQ = useMembers();
  const products = useMemo(
    () => (productsQ.data ?? []).filter((p) => p.active).map((p) => ({ id: p.id, name: p.name })),
    [productsQ.data],
  );
  const holders = useMemo(
    () =>
      [...(holdersQ.data ?? [])]
        .sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name))
        .map((h) => ({ id: h.id, name: `${h.name} (${h.kind})` })),
    [holdersQ.data],
  );
  const members = useMemo(
    () => (membersQ.data ?? []).map((m) => ({ id: m.id, name: m.display_name ?? m.full_name })),
    [membersQ.data],
  );

  // The last 30 days, bucketed by kind: two narrow columns per row, paged.
  const [chartSince] = useState(() => {
    const at = new Date(Date.now() - CHART_DAYS * 86_400_000);
    at.setMinutes(0, 0, 0);
    return at.toISOString();
  });
  const activityQ = useSWR(["admin/movement-activity", chartSince], () =>
    fetchAllRows((from, to) =>
      supabase
        .from("stock_movements")
        .select("id, reason, created_at")
        .gte("created_at", chartSince)
        .order("id")
        .range(from, to),
    ),
  );
  const activity = useMemo(
    () =>
      movementsPerDay(
        (activityQ.data ?? []).map((m) => ({ reason: m.reason ?? "correction", createdAt: m.created_at })),
        { days: CHART_DAYS, now: new Date() },
      ),
    [activityQ.data],
  );
  const activitySeries = useMemo(() => {
    const present = seriesPresent(activity, MOVEMENT_GROUP_SERIES);
    return present.length > 0 ? present : MOVEMENT_GROUP_SERIES.slice(0, 2);
  }, [activity]);
  const activityTotal = activity.reduce((sum, point) => sum + point.total, 0);

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
    void revalidateStock();
    void activityQ.mutate();
    await loadMovements();
  }

  const filtersActive = hasActiveFilters(filters);
  const menuFilters = (filters.holderId ? 1 : 0) + (filters.memberId ? 1 : 0) + (filters.dateFrom || filters.dateTo ? 1 : 0);
  const reversalRow = openReversalId !== null ? rows.find((row) => row.id === openReversalId) : undefined;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Movements"
        description="Every stock change ever recorded, newest first."
        info="The ledger is append-only: a mistake is corrected by writing its mirror (Reverse), never by editing or deleting the original."
      />

      {feedback ? <Toast variant={feedback.variant} message={feedback.message} onDismiss={() => setFeedback(null)} /> : null}

      <Card title="Activity" subtitle={`Movements per day by kind, last ${CHART_DAYS} days. Click a day to see it.`}>
        {activityQ.isLoading ? (
          <Skeleton className="h-[200px] w-full" />
        ) : activityTotal === 0 ? (
          <p className="py-8 text-center text-sm text-neutral-500">Nothing moved in the last {CHART_DAYS} days.</p>
        ) : (
          <DailyStackedBar
            data={activity}
            series={activitySeries}
            unit="movements"
            height={180}
            onSelectDay={(date) => {
              setFilters((prev) => ({ ...prev, dateFrom: date, dateTo: date }));
              setPage(0);
            }}
          />
        )}
      </Card>

      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label="Product"
          value={filters.productId}
          onChange={(e) => updateFilter("productId", e.target.value)}
          className={`${FILTER} max-w-64`}
        >
          <option value="">Any product</option>
          {products.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <select
          aria-label="Reason"
          value={filters.reason}
          onChange={(e) => updateFilter("reason", e.target.value)}
          className={FILTER}
        >
          <option value="">Any reason</option>
          {MOVEMENT_REASONS.map((reason) => (
            <option key={reason} value={reason}>
              {reasonLabel(reason)}
            </option>
          ))}
        </select>
        <FilterMenu activeCount={menuFilters}>
          <label className={LABEL}>
            <span className={CAPTION}>Holder (from or to)</span>
            <select value={filters.holderId} onChange={(e) => updateFilter("holderId", e.target.value)} className={FILTER}>
              <option value="">Any holder</option>
              {holders.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name}
                </option>
              ))}
            </select>
          </label>
          <label className={LABEL}>
            <span className={CAPTION}>Who did it</span>
            <select value={filters.memberId} onChange={(e) => updateFilter("memberId", e.target.value)} className={FILTER}>
              <option value="">Anyone</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className={LABEL}>
              <span className={CAPTION}>From</span>
              <input type="date" value={filters.dateFrom} onChange={(e) => updateFilter("dateFrom", e.target.value)} className={FILTER} />
            </label>
            <label className={LABEL}>
              <span className={CAPTION}>To</span>
              <input type="date" value={filters.dateTo} onChange={(e) => updateFilter("dateTo", e.target.value)} className={FILTER} />
            </label>
          </div>
          <p className={HELP}>Singapore days, both ends included.</p>
        </FilterMenu>
        {filtersActive ? (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilters(EMPTY_MOVEMENT_FILTERS);
              setPage(0);
            }}
          >
            Clear
          </Button>
        ) : null}
        <span className="ml-auto text-sm tabular-nums text-neutral-500">
          {loading ? "" : rows.length === 0 ? "" : `${page * PAGE_SIZE + 1}–${page * PAGE_SIZE + rows.length}`}
        </span>
      </div>

      <Card padded={false}>
        {loading && rows.length === 0 ? (
          <TableSkeleton />
        ) : loadError ? (
          <p className="p-4 text-sm text-red-400">{loadError}</p>
        ) : rows.length === 0 ? (
          <EmptyState message={filtersActive ? "No movements match these filters." : "No movements recorded yet."} />
        ) : (
          <ul className={loading ? "opacity-60 transition-opacity" : ""}>
            {rows.map((row) => {
              const reversed = reversedIds.has(row.id);
              const reversible = canReverse(row, reversedIds);
              return (
                <li key={row.id} className="flex items-start gap-3 border-b border-neutral-800/70 px-4 py-3 last:border-0">
                  <div className="min-w-0 flex-1 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-neutral-100">{row.products?.name ?? "(deleted product)"}</span>
                      <span className="tabular-nums text-neutral-400">
                        ×{row.qty}
                        {row.products?.unit ? ` ${row.products.unit}` : ""}
                      </span>
                      <StatusPill
                        tone={row.reason === "correction" ? "warning" : row.reason === "stocktake_loss" ? "danger" : "inactive"}
                      >
                        {reasonLabel(row.reason)}
                      </StatusPill>
                      {reversed ? <StatusPill tone="warning">reversed</StatusPill> : null}
                    </div>
                    <p className="mt-1 text-neutral-400">
                      {holderLabel(row.from_holder)} <span className="text-neutral-600">→</span> {holderLabel(row.to_holder)}
                    </p>
                    <p className="mt-0.5 text-xs text-neutral-600">
                      #{row.id} · {new Date(row.created_at).toLocaleString()} · {actorLabel(row)}
                      {row.entry_method ? ` · ${row.entry_method}` : ""}
                      {row.scan_code ? ` · ${row.scan_code}` : ""}
                      {row.reverses_movement_id ? ` · reverses #${row.reverses_movement_id}` : ""}
                    </p>
                  </div>
                  {reversible ? (
                    <ActionMenu
                      ariaLabel={`Actions for movement ${row.id}`}
                      items={[
                        {
                          label: "Reverse…",
                          hint: "Write a mirror row that cancels this one",
                          tone: "danger",
                          onSelect: () => openReversal(row.id),
                        },
                      ]}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {page > 0 || hasNextPage ? (
        <div className="flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" disabled={page === 0 || loading} onClick={() => setPage((p) => Math.max(0, p - 1))}>
            ← Newer
          </Button>
          <span className="text-sm text-neutral-500">Page {page + 1}</span>
          <Button variant="ghost" size="sm" disabled={!hasNextPage || loading} onClick={() => setPage((p) => p + 1)}>
            Older →
          </Button>
        </div>
      ) : null}

      <Drawer
        open={reversalRow !== undefined}
        onClose={() => setOpenReversalId(null)}
        title={reversalRow ? `Reverse movement #${reversalRow.id}` : "Reverse movement"}
        description={
          reversalRow
            ? `${reversalRow.products?.name ?? "Product"} ×${reversalRow.qty}: ${holderLabel(reversalRow.from_holder)} → ${holderLabel(reversalRow.to_holder)}`
            : undefined
        }
        footer={
          reversalRow ? (
            <>
              <Button variant="danger" size="sm" disabled={reversingId === reversalRow.id} onClick={() => handleReverse(reversalRow)}>
                {reversingId === reversalRow.id ? "Reversing…" : "Write the correction"}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpenReversalId(null)}>
                Cancel
              </Button>
            </>
          ) : null
        }
      >
        {reversalRow ? (
          <div className="flex flex-col gap-4">
            <label className={LABEL}>
              <span className={CAPTION}>Why is this being reversed?</span>
              <input
                type="text"
                value={reversalNote}
                onChange={(e) => setReversalNote(e.target.value)}
                placeholder="e.g. scanned the wrong bin"
                className={FIELD}
              />
              <span className={HELP}>It goes into the ledger with the correction.</span>
            </label>
            {rowError[reversalRow.id] ? <p className="text-sm text-red-400">{rowError[reversalRow.id]}</p> : null}
            <p className="text-sm text-neutral-400">
              This writes a new movement with the holders swapped and reason &ldquo;correction&rdquo;. Movement #
              {reversalRow.id} stays in the ledger exactly as it is.
            </p>
          </div>
        ) : null}
      </Drawer>
    </div>
  );
}
