import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  EXPENSIVE_THRESHOLD_SGD,
  expenseBasis,
  isExpensive,
  isHighPriorityReview,
  needsPrice,
} from "@/lib/expensive";

describe("expensive rule", () => {
  it("matches the generated column in migration 0028", () => {
    const sql = readFileSync(path.resolve(process.cwd(), "supabase/migrations/0028_expensive_items.sql"), "utf-8");
    expect(sql).toContain(`coalesce(unit_cost_sgd >= ${EXPENSIVE_THRESHOLD_SGD}, criticality = 'critical')`);
  });

  it("lets a price decide, and assumes critical items are expensive when unpriced", () => {
    expect(expenseBasis({ unitCostSgd: 20, criticality: "expendable" })).toBe("priced");
    expect(expenseBasis({ unitCostSgd: 19.99, criticality: "critical" })).toBe("cheap");
    expect(expenseBasis({ unitCostSgd: null, criticality: "critical" })).toBe("assumed");
    expect(expenseBasis({ unitCostSgd: null, criticality: "standard" })).toBe("unpriced");
    expect(isExpensive({ unitCostSgd: 20, criticality: "standard" })).toBe(true);
    expect(isExpensive({ unitCostSgd: 19.99, criticality: "critical" })).toBe(false);
    expect(isExpensive({ unitCostSgd: null, criticality: "critical" })).toBe(true);
    expect(isExpensive({ unitCostSgd: null, criticality: "expendable" })).toBe(false);
  });

  it("asks for a price only on active reusable kit", () => {
    expect(needsPrice({ unitCostSgd: null, criticality: "standard" })).toBe(true);
    expect(needsPrice({ unitCostSgd: null, criticality: "standard", active: false })).toBe(false);
    expect(needsPrice({ unitCostSgd: 5, criticality: "standard" })).toBe(false);
    expect(needsPrice({ unitCostSgd: null, criticality: "expendable" })).toBe(false);
  });

  it("ranks a review item high when its product is expensive or staff marked it", () => {
    const expensive = new Set(["gm6020"]);
    expect(isHighPriorityReview({ product_id: "gm6020", about_expensive: false }, expensive)).toBe(true);
    expect(isHighPriorityReview({ product_id: "resistor", about_expensive: false }, expensive)).toBe(false);
    expect(isHighPriorityReview({ product_id: null, about_expensive: true }, expensive)).toBe(true);
    expect(isHighPriorityReview({ product_id: null, about_expensive: false }, expensive)).toBe(false);
  });
});
