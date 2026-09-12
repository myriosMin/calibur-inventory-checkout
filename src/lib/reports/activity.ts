/**
 * The dashboard's activity rollups — `architecture.md` §Observability's
 * "minimum useful set", as pure functions over rows the page has already
 * fetched.
 *
 * The interesting one is the scan-vs-search ratio. It is not a vanity
 * metric: `qr-labels.md` and `operations.md` both say a product consistently
 * reached by search almost certainly has a missing or damaged sticker, which
 * makes `stock_movements.entry_method` the feedback loop for the *physical*
 * layer of this system. That column has been written on every cart line
 * since Phase 3 and nothing has ever read it.
 */

import { dateInZone, REPORT_TIME_ZONE } from "./schedule";

// ---------------------------------------------------------------------------
// Sessions per day, by mode
// ---------------------------------------------------------------------------

export interface SessionLike {
  mode: string;
  startedAt: string;
}

export interface DailySessionCount {
  /** `YYYY-MM-DD` in the club's zone. */
  date: string;
  byMode: Record<string, number>;
  total: number;
}

/**
 * One row per calendar day in the window, **including days with no
 * sessions** — a gap is the interesting part of a usage chart, and dropping
 * empty days would quietly redraw a dead week as a busy one.
 */
export function sessionsPerDay(
  sessions: readonly SessionLike[],
  options: { days: number; now: Date; timeZone?: string },
): DailySessionCount[] {
  const timeZone = options.timeZone ?? REPORT_TIME_ZONE;
  const buckets = new Map<string, DailySessionCount>();

  for (let i = options.days - 1; i >= 0; i--) {
    const date = dateInZone(new Date(options.now.getTime() - i * 86_400_000), timeZone);
    buckets.set(date, { date, byMode: {}, total: 0 });
  }

  for (const session of sessions) {
    const at = new Date(session.startedAt);
    if (Number.isNaN(at.getTime())) continue;
    const date = dateInZone(at, timeZone);
    const bucket = buckets.get(date);
    if (!bucket) continue; // outside the window
    bucket.byMode[session.mode] = (bucket.byMode[session.mode] ?? 0) + 1;
    bucket.total += 1;
  }

  return [...buckets.values()];
}

/** Every mode that actually appears, so the chart legend has no empty rows. */
export function modesPresent(rows: readonly DailySessionCount[]): string[] {
  const modes = new Set<string>();
  for (const row of rows) for (const mode of Object.keys(row.byMode)) modes.add(mode);
  return [...modes].sort();
}

// ---------------------------------------------------------------------------
// Scan vs. search
// ---------------------------------------------------------------------------

export interface EntryLike {
  entryMethod: string | null;
}

export interface EntryMethodBreakdown {
  scan: number;
  groupPick: number;
  search: number;
  admin: number;
  unknown: number;
  /** scan + group_pick + search. Excludes admin — see below. */
  memberEntries: number;
  /** (scan + group_pick) / memberEntries, or null when there is no data. */
  scanRatio: number | null;
}

/**
 * `admin` entries are excluded from the ratio on purpose. A restock or a
 * stocktake correction is typed in at a desk by someone who never walked to
 * the shelf, so counting it as "not scanned" would blame the labels for a
 * flow that has no labels in it. `group_pick` counts as *scanned*: the
 * member did scan a sticker, it was just the resistor book's rather than the
 * individual part's.
 */
export function entryMethodBreakdown(entries: readonly EntryLike[]): EntryMethodBreakdown {
  let scan = 0;
  let groupPick = 0;
  let search = 0;
  let admin = 0;
  let unknown = 0;

  for (const entry of entries) {
    switch (entry.entryMethod) {
      case "scan":
        scan += 1;
        break;
      case "group_pick":
        groupPick += 1;
        break;
      case "search":
        search += 1;
        break;
      case "admin":
        admin += 1;
        break;
      default:
        unknown += 1;
    }
  }

  const memberEntries = scan + groupPick + search;
  return {
    scan,
    groupPick,
    search,
    admin,
    unknown,
    memberEntries,
    scanRatio: memberEntries === 0 ? null : (scan + groupPick) / memberEntries,
  };
}

export function formatRatio(ratio: number | null): string {
  if (ratio === null) return "—";
  return `${Math.round(ratio * 100)}%`;
}

// ---------------------------------------------------------------------------
// Scan misses
// ---------------------------------------------------------------------------

export interface ScanMissLike {
  code: string;
  outcome: string;
  createdAt: string;
}

export interface ScanMissGroup {
  code: string;
  /** Every outcome recorded for this code, most common first. */
  outcomes: string[];
  count: number;
  lastSeen: string;
}

/**
 * Grouped by code, because the actionable unit is a label, not an event: one
 * sticker that 14 people have scanned to no effect is one job (reprint it),
 * and 14 separate rows would hide that behind scrolling.
 */
export function summariseScanMisses(misses: readonly ScanMissLike[]): ScanMissGroup[] {
  const byCode = new Map<string, { count: number; lastSeen: string; outcomes: Map<string, number> }>();

  for (const miss of misses) {
    const existing = byCode.get(miss.code);
    if (!existing) {
      byCode.set(miss.code, {
        count: 1,
        lastSeen: miss.createdAt,
        outcomes: new Map([[miss.outcome, 1]]),
      });
      continue;
    }
    existing.count += 1;
    if (miss.createdAt > existing.lastSeen) existing.lastSeen = miss.createdAt;
    existing.outcomes.set(miss.outcome, (existing.outcomes.get(miss.outcome) ?? 0) + 1);
  }

  return [...byCode.entries()]
    .map(([code, entry]) => ({
      code,
      count: entry.count,
      lastSeen: entry.lastSeen,
      outcomes: [...entry.outcomes.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .map(([outcome]) => outcome),
    }))
    .sort((a, b) => b.count - a.count || b.lastSeen.localeCompare(a.lastSeen));
}
