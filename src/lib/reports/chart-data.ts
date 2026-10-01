/**
 * Shapes report data for the /admin charts. Pure, like the rest of
 * src/lib/reports: the numbers come from ./activity, ./stock etc., and
 * this only decides how they are drawn (series order, labels, folding).
 */

import { sessionsPerDay, type DailySessionCount } from "./activity";

// ---------------------------------------------------------------------------
// Series identity
// ---------------------------------------------------------------------------

export interface SeriesDef {
  key: string;
  label: string;
  /** 1-based slot in the categorical palette (globals.css --color-chart-N). */
  slot: 1 | 2 | 3 | 4 | 5;
}

/**
 * Session modes, in a FIXED slot order. Colour follows the mode, never its
 * rank or which modes happen to be present this fortnight. A quiet week
 * with only returns still draws returns in slot 2.
 */
export const SESSION_MODE_SERIES: SeriesDef[] = [
  { key: "borrow", label: "Borrow", slot: 1 },
  { key: "return", label: "Return", slot: 2 },
  { key: "restock", label: "Restock", slot: 3 },
  { key: "stocktake", label: "Stocktake", slot: 4 },
  { key: "correction", label: "Correction", slot: 5 },
];

/**
 * Movement reasons fold to five groups: the nine raw reasons would need more
 * colours than can be told apart, and "consume" vs "borrow" is one question
 * here (stock went out).
 */
export const MOVEMENT_GROUP_SERIES: SeriesDef[] = [
  { key: "out", label: "Out", slot: 1 },
  { key: "returned", label: "Returned", slot: 2 },
  { key: "restock", label: "Restock", slot: 3 },
  { key: "stocktake", label: "Stocktake", slot: 4 },
  { key: "correction", label: "Correction", slot: 5 },
];

const REASON_GROUP: Record<string, string> = {
  borrow: "out",
  consume: "out",
  return: "returned",
  return_adjustment: "returned",
  restock: "restock",
  seed: "restock",
  stocktake_gain: "stocktake",
  stocktake_loss: "stocktake",
  correction: "correction",
};

export function movementGroup(reason: string): string {
  return REASON_GROUP[reason] ?? "correction";
}

// ---------------------------------------------------------------------------
// Daily stacked series
// ---------------------------------------------------------------------------

export interface DailyPoint {
  /** `YYYY-MM-DD` in the club's zone. */
  date: string;
  /** Axis label, "3 Oct". */
  label: string;
  total: number;
  [series: string]: number | string;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function dayLabel(date: string): string {
  const [, month, day] = date.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? month}`;
}

/** One row per day with a zero-filled count for every series key. */
export function toDailySeries(daily: readonly DailySessionCount[], series: readonly SeriesDef[]): DailyPoint[] {
  return daily.map((day) => {
    const point: DailyPoint = { date: day.date, label: dayLabel(day.date), total: day.total };
    for (const def of series) point[def.key] = day.byMode[def.key] ?? 0;
    return point;
  });
}

/** Movements per day, grouped by reason. Reuses the sessions bucketing. */
export function movementsPerDay(
  movements: readonly { reason: string; createdAt: string }[],
  options: { days: number; now: Date },
): DailyPoint[] {
  const daily = sessionsPerDay(
    movements.map((movement) => ({ mode: movementGroup(movement.reason), startedAt: movement.createdAt })),
    options,
  );
  return toDailySeries(daily, MOVEMENT_GROUP_SERIES);
}

/** Only the series that have any data in the window, still in slot order. */
export function seriesPresent(points: readonly DailyPoint[], series: readonly SeriesDef[]): SeriesDef[] {
  return series.filter((def) => points.some((point) => Number(point[def.key]) > 0));
}

// ---------------------------------------------------------------------------
// Ranked lists and proportions
// ---------------------------------------------------------------------------

export interface Segment {
  key: string;
  label: string;
  value: number;
  /** 0..1 of the total. */
  share: number;
}

/** Parts of a whole, zero parts dropped, shares summing to 1. */
export function toSegments(parts: readonly { key: string; label: string; value: number }[]): Segment[] {
  const total = parts.reduce((sum, part) => sum + Math.max(0, part.value), 0);
  if (total === 0) return [];
  return parts
    .filter((part) => part.value > 0)
    .map((part) => ({ ...part, share: part.value / total }));
}

/**
 * The top `n` by value, plus how many were left out, for a bar list that
 * shows the head and links to the full table for the tail.
 */
export function topN<T>(rows: readonly T[], n: number, value: (row: T) => number): { shown: T[]; rest: number } {
  const sorted = [...rows].sort((a, b) => value(b) - value(a));
  return { shown: sorted.slice(0, n), rest: Math.max(0, sorted.length - n) };
}
