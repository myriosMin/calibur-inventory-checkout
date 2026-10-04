/** Filtering and ordering for the review queue. Pure, so it is tested. */

import { isHighPriorityReview } from "@/lib/expensive";

export interface ReviewFilterable {
  id: number;
  severity: string;
  entity: string;
  subject: string;
  issue: string;
  status: string;
  product_id: string | null;
  about_expensive: boolean;
}

export interface ReviewFilters {
  status: "open" | "closed" | "all";
  severity: "all" | "blocker" | "check" | "info";
  /** "high" = about expensive items (0028): the ones to settle first. */
  priority: "all" | "high" | "normal";
  entity: string;
  query: string;
}

export const DEFAULT_REVIEW_FILTERS: ReviewFilters = {
  status: "open",
  severity: "all",
  priority: "all",
  entity: "all",
  query: "",
};

const SEVERITY_RANK: Record<string, number> = { blocker: 0, check: 1, info: 2 };

/**
 * Items about expensive things first, whatever their severity: the club
 * settles those before anything else (2026-10-04). Then blockers, checks,
 * info; oldest first within each.
 */
export function filterReviewItems<T extends ReviewFilterable>(
  items: T[],
  filters: ReviewFilters,
  expensiveProductIds: ReadonlySet<string> = new Set(),
): T[] {
  const needle = filters.query.trim().toLowerCase();
  const high = (item: T) => isHighPriorityReview(item, expensiveProductIds);
  return items
    .filter((item) => {
      if (filters.status === "open" && item.status !== "open") return false;
      if (filters.status === "closed" && item.status === "open") return false;
      if (filters.severity !== "all" && item.severity !== filters.severity) return false;
      if (filters.priority === "high" && !high(item)) return false;
      if (filters.priority === "normal" && high(item)) return false;
      if (filters.entity !== "all" && item.entity !== filters.entity) return false;
      if (!needle) return true;
      return item.subject.toLowerCase().includes(needle) || item.issue.toLowerCase().includes(needle);
    })
    .sort(
      (a, b) =>
        Number(high(b)) - Number(high(a)) ||
        (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) ||
        a.id - b.id,
    );
}

export function openCountsBySeverity(items: ReviewFilterable[]): Record<"blocker" | "check" | "info", number> {
  const counts = { blocker: 0, check: 0, info: 0 };
  for (const item of items) {
    if (item.status === "open" && item.severity in counts) counts[item.severity as keyof typeof counts] += 1;
  }
  return counts;
}

/** Open items split by priority, for the chips and the dashboard. */
export function openCountsByPriority(
  items: ReviewFilterable[],
  expensiveProductIds: ReadonlySet<string>,
): { high: number; normal: number } {
  const counts = { high: 0, normal: 0 };
  for (const item of items) {
    if (item.status !== "open") continue;
    if (isHighPriorityReview(item, expensiveProductIds)) counts.high += 1;
    else counts.normal += 1;
  }
  return counts;
}

/** Product ids that are expensive, from the cached products list. */
export function expensiveIds(products: readonly { id: string; expensive: boolean | null }[]): Set<string> {
  return new Set(products.filter((p) => p.expensive === true).map((p) => p.id));
}
