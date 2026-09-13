/** Filtering and ordering for the review queue. Pure, so it is tested. */

export interface ReviewFilterable {
  id: number;
  severity: string;
  entity: string;
  subject: string;
  issue: string;
  status: string;
}

export interface ReviewFilters {
  status: "open" | "closed" | "all";
  severity: "all" | "blocker" | "check" | "info";
  entity: string;
  query: string;
}

export const DEFAULT_REVIEW_FILTERS: ReviewFilters = { status: "open", severity: "all", entity: "all", query: "" };

const SEVERITY_RANK: Record<string, number> = { blocker: 0, check: 1, info: 2 };

/** Blockers first, then checks, then info; oldest first within each. */
export function filterReviewItems<T extends ReviewFilterable>(items: T[], filters: ReviewFilters): T[] {
  const needle = filters.query.trim().toLowerCase();
  return items
    .filter((item) => {
      if (filters.status === "open" && item.status !== "open") return false;
      if (filters.status === "closed" && item.status === "open") return false;
      if (filters.severity !== "all" && item.severity !== filters.severity) return false;
      if (filters.entity !== "all" && item.entity !== filters.entity) return false;
      if (!needle) return true;
      return item.subject.toLowerCase().includes(needle) || item.issue.toLowerCase().includes(needle);
    })
    .sort((a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || a.id - b.id);
}

export function openCountsBySeverity(items: ReviewFilterable[]): Record<"blocker" | "check" | "info", number> {
  const counts = { blocker: 0, check: 0, info: 0 };
  for (const item of items) {
    if (item.status === "open" && item.severity in counts) counts[item.severity as keyof typeof counts] += 1;
  }
  return counts;
}
