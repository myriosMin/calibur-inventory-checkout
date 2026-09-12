import { describe, expect, it } from "vitest";

import {
  EMPTY_MOVEMENT_FILTERS,
  LEDGER_UTC_OFFSET,
  MOVEMENT_REASONS,
  REASON_LABELS,
  buildMovementQueryPlan,
  canReverse,
  hasActiveFilters,
  nextDay,
  reasonLabel,
  type MovementFilters,
} from "@/app/admin/movements/filters";

function filters(overrides: Partial<MovementFilters> = {}): MovementFilters {
  return { ...EMPTY_MOVEMENT_FILTERS, ...overrides };
}

describe("buildMovementQueryPlan", () => {
  it("produces an empty plan for empty filters", () => {
    expect(buildMovementQueryPlan(EMPTY_MOVEMENT_FILTERS)).toEqual({
      eq: [],
      or: null,
      gte: null,
      lt: null,
    });
  });

  it("maps product, member and reason to simple eq filters", () => {
    const plan = buildMovementQueryPlan(
      filters({ productId: "p1", memberId: "m1", reason: "borrow" }),
    );
    expect(plan.eq).toEqual([
      { column: "product_id", value: "p1" },
      { column: "actor_member_id", value: "m1" },
      { column: "reason", value: "borrow" },
    ]);
  });

  it("maps a holder to an OR across both holder columns", () => {
    // "This holder was involved" is a different question from "stock left
    // here", and it is the one an admin actually asks.
    const plan = buildMovementQueryPlan(filters({ holderId: "h1" }));
    expect(plan.or).toBe("from_holder_id.eq.h1,to_holder_id.eq.h1");
    expect(plan.eq).toEqual([]);
  });

  it("anchors the date range to Singapore days, not UTC days", () => {
    const plan = buildMovementQueryPlan(filters({ dateFrom: "2026-03-04" }));
    expect(plan.gte).toBe(`2026-03-04T00:00:00${LEDGER_UTC_OFFSET}`);
    expect(LEDGER_UTC_OFFSET).toBe("+08:00");
  });

  it("makes the upper bound half-open so the whole end day is included", () => {
    const plan = buildMovementQueryPlan(filters({ dateTo: "2026-03-04" }));
    expect(plan.lt).toBe("2026-03-05T00:00:00+08:00");
  });

  it("covers exactly one day when both ends are the same date", () => {
    const plan = buildMovementQueryPlan(
      filters({ dateFrom: "2026-03-04", dateTo: "2026-03-04" }),
    );
    expect(plan.gte).toBe("2026-03-04T00:00:00+08:00");
    expect(plan.lt).toBe("2026-03-05T00:00:00+08:00");
  });

  it("accepts an explicit offset so the rule is testable, not ambient", () => {
    const plan = buildMovementQueryPlan(
      filters({ dateFrom: "2026-03-04" }),
      "+00:00",
    );
    expect(plan.gte).toBe("2026-03-04T00:00:00+00:00");
  });
});

describe("nextDay", () => {
  it("advances a normal date", () => {
    expect(nextDay("2026-03-04")).toBe("2026-03-05");
  });

  it("rolls over a month boundary", () => {
    expect(nextDay("2026-01-31")).toBe("2026-02-01");
  });

  it("rolls over a year boundary", () => {
    expect(nextDay("2025-12-31")).toBe("2026-01-01");
  });

  it("handles a leap day", () => {
    expect(nextDay("2028-02-28")).toBe("2028-02-29");
    expect(nextDay("2028-02-29")).toBe("2028-03-01");
  });
});

describe("hasActiveFilters", () => {
  it("is false for the empty filter set", () => {
    expect(hasActiveFilters(EMPTY_MOVEMENT_FILTERS)).toBe(false);
  });

  it("is true as soon as any field is set", () => {
    expect(hasActiveFilters(filters({ reason: "consume" }))).toBe(true);
    expect(hasActiveFilters(filters({ dateTo: "2026-03-04" }))).toBe(true);
  });
});

describe("canReverse", () => {
  it("allows reversing an ordinary movement", () => {
    expect(canReverse({ id: 1, reason: "borrow" }, new Set())).toBe(true);
  });

  it("refuses to reverse a correction row", () => {
    // admin_reverse_movement raises on this too; the UI just must not offer it.
    expect(canReverse({ id: 1, reason: "correction" }, new Set())).toBe(false);
  });

  it("refuses to reverse something already reversed", () => {
    expect(canReverse({ id: 7, reason: "consume" }, new Set([7]))).toBe(false);
  });

  it("treats a null reason as reversible", () => {
    expect(canReverse({ id: 2, reason: null }, new Set())).toBe(true);
  });
});

describe("reason vocabulary", () => {
  it("matches the CHECK constraint in 0017_movement_reason_constraint.sql", () => {
    expect([...MOVEMENT_REASONS]).toEqual([
      "borrow",
      "consume",
      "return",
      "return_adjustment",
      "seed",
      "restock",
      "stocktake_gain",
      "stocktake_loss",
      "correction",
    ]);
  });

  it("has a human label for every reason", () => {
    for (const reason of MOVEMENT_REASONS) {
      expect(REASON_LABELS[reason]).toBeDefined();
      expect(reasonLabel(reason)).not.toBe(reason);
    }
  });

  it("renders an em dash for a null reason and passes unknowns through", () => {
    expect(reasonLabel(null)).toBe("—");
    expect(reasonLabel("something_new")).toBe("something_new");
  });
});
