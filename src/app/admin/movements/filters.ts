/**
 * Pure filter -> PostgREST query-plan mapping for /admin/movements.
 *
 * The component owns the Supabase client; this module owns the rules, so the
 * awkward parts (a holder filter is an OR across two columns, a date range is
 * half-open in *Singapore* days, not UTC days) are testable without network.
 */

export interface MovementFilters {
  productId: string;
  /** Matches either from_holder_id OR to_holder_id. */
  holderId: string;
  /** stock_movements.actor_member_id -- who did it, not where it went. */
  memberId: string;
  reason: string;
  /** "YYYY-MM-DD" from <input type="date">, inclusive. */
  dateFrom: string;
  /** "YYYY-MM-DD" from <input type="date">, inclusive of the whole day. */
  dateTo: string;
}

export const EMPTY_MOVEMENT_FILTERS: MovementFilters = {
  productId: "",
  holderId: "",
  memberId: "",
  reason: "",
  dateFrom: "",
  dateTo: "",
};

/**
 * Every value stock_movements.reason is allowed to hold, per the CHECK
 * constraint in 0017_movement_reason_constraint.sql. Kept in the same order
 * as the migration so the two are easy to diff by eye.
 */
export const MOVEMENT_REASONS = [
  "borrow",
  "consume",
  "return",
  "return_adjustment",
  "seed",
  "restock",
  "stocktake_gain",
  "stocktake_loss",
  "correction",
] as const;

export type MovementReason = (typeof MOVEMENT_REASONS)[number];

export const REASON_LABELS: Record<string, string> = {
  borrow: "Borrow",
  consume: "Consume",
  return: "Return",
  return_adjustment: "Return adjustment",
  seed: "Seed",
  restock: "Restock",
  stocktake_gain: "Stocktake gain",
  stocktake_loss: "Stocktake loss",
  correction: "Correction",
};

export function reasonLabel(reason: string | null): string {
  if (!reason) return "—";
  return REASON_LABELS[reason] ?? reason;
}

/**
 * The club, the shelves, and the Supabase region are all in Singapore, which
 * has no DST and has been +08:00 since 1982. "Movements on 3 November" means
 * a Singapore day; anchoring the range to the browser's local offset would
 * silently shift the boundary for an admin travelling, and anchoring it to
 * UTC would put 8 hours of the morning in the wrong bucket.
 */
export const LEDGER_UTC_OFFSET = "+08:00";

export interface MovementQueryPlan {
  /** Simple column = value filters. */
  eq: Array<{ column: string; value: string }>;
  /** PostgREST `.or()` argument, or null when no holder filter is set. */
  or: string | null;
  /** created_at >= this ISO timestamp, or null. */
  gte: string | null;
  /** created_at < this ISO timestamp (half-open), or null. */
  lt: string | null;
}

/** "2026-03-04" -> "2026-03-05". Pure date arithmetic, UTC-anchored so it
 *  cannot be dragged across a boundary by the runtime's local timezone. */
export function nextDay(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return next.toISOString().slice(0, 10);
}

export function buildMovementQueryPlan(
  filters: MovementFilters,
  offset: string = LEDGER_UTC_OFFSET,
): MovementQueryPlan {
  const eq: Array<{ column: string; value: string }> = [];
  if (filters.productId) eq.push({ column: "product_id", value: filters.productId });
  if (filters.memberId) eq.push({ column: "actor_member_id", value: filters.memberId });
  if (filters.reason) eq.push({ column: "reason", value: filters.reason });

  return {
    eq,
    // "This holder was involved" is the question an admin actually asks, and
    // it is a different question from "stock left here" -- so one control,
    // two columns.
    or: filters.holderId
      ? `from_holder_id.eq.${filters.holderId},to_holder_id.eq.${filters.holderId}`
      : null,
    gte: filters.dateFrom ? `${filters.dateFrom}T00:00:00${offset}` : null,
    // Half-open upper bound: `< the next midnight` includes every movement on
    // the chosen day, which `<= YYYY-MM-DDT00:00:00` would not.
    lt: filters.dateTo ? `${nextDay(filters.dateTo)}T00:00:00${offset}` : null,
  };
}

export function hasActiveFilters(filters: MovementFilters): boolean {
  return Object.values(filters).some((value) => value !== "");
}

/**
 * A movement can be reversed only if it is not itself a correction and has
 * not already been reversed. Both are also enforced server-side by
 * admin_reverse_movement plus the partial unique index from 0021 -- this is
 * the affordance, not the guarantee.
 */
export function canReverse(
  movement: { id: number; reason: string | null },
  reversedIds: ReadonlySet<number>,
): boolean {
  if (movement.reason === "correction") return false;
  return !reversedIds.has(movement.id);
}
