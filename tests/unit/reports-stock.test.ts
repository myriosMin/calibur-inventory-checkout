import { describe, expect, it } from "vitest";

import {
  classifyStockLevel,
  classifyStockLevels,
  selectNewlyLow,
  selectNewlyNegative,
  shortfall,
  type StockLevelRow,
} from "@/lib/reports/stock";

function row(overrides: Partial<StockLevelRow> & { productId: string }): StockLevelRow {
  return {
    name: overrides.productId,
    tier: "bulk",
    unit: "pcs",
    minStock: null,
    qtyInStore: 0,
    qtyOut: 0,
    ...overrides,
  };
}

describe("classifyStockLevel", () => {
  it("calls a healthy quantity ok", () => {
    expect(classifyStockLevel({ minStock: 10, qtyInStore: 40 })).toBe("ok");
  });

  it("calls below-minimum low", () => {
    expect(classifyStockLevel({ minStock: 10, qtyInStore: 9 })).toBe("low");
  });

  it("treats exactly the minimum as ok, not low", () => {
    expect(classifyStockLevel({ minStock: 10, qtyInStore: 10 })).toBe("ok");
  });

  it("never alerts on a product with no threshold configured", () => {
    expect(classifyStockLevel({ minStock: null, qtyInStore: 0 })).toBe("ok");
  });

  it("calls a negative quantity a data-integrity warning, NOT low stock", () => {
    // migrations/0015: "Treat `< 0` as a data-integrity warning, NOT a
    // low-stock alert" -- it means a missing opening balance, not a shortage.
    expect(classifyStockLevel({ minStock: 50, qtyInStore: -4 })).toBe("negative");
  });

  it("flags a negative even with no threshold set", () => {
    expect(classifyStockLevel({ minStock: null, qtyInStore: -1 })).toBe("negative");
  });

  it("treats zero as low (when a threshold exists), not negative", () => {
    expect(classifyStockLevel({ minStock: 5, qtyInStore: 0 })).toBe("low");
  });
});

describe("classifyStockLevels", () => {
  const rows = [
    row({ productId: "healthy", minStock: 10, qtyInStore: 40 }),
    row({ productId: "slightly-low", name: "slightly-low", minStock: 10, qtyInStore: 9 }),
    row({ productId: "very-low", name: "very-low", minStock: 100, qtyInStore: 2 }),
    row({ productId: "broken", name: "broken", minStock: 50, qtyInStore: -4 }),
    row({ productId: "no-threshold", minStock: null, qtyInStore: 0 }),
  ];

  it("separates the two problems into two lists", () => {
    const report = classifyStockLevels(rows);
    expect(report.low.map((r) => r.productId)).toEqual(["very-low", "slightly-low"]);
    expect(report.negative.map((r) => r.productId)).toEqual(["broken"]);
  });

  it("never puts a negative row in the low list", () => {
    const report = classifyStockLevels(rows);
    expect(report.low.some((r) => r.qtyInStore < 0)).toBe(false);
  });

  it("sorts low stock by how far below the minimum it is", () => {
    const report = classifyStockLevels(rows);
    expect(shortfall(report.low[0])).toBeGreaterThan(shortfall(report.low[1]));
  });

  it("reports no shortfall for a product with no threshold", () => {
    expect(shortfall(row({ productId: "x", minStock: null, qtyInStore: -5 }))).toBe(0);
  });
});

describe("selectNewlyLow (edge-triggered alerting)", () => {
  const lowRow = row({ productId: "xt30", name: "XT30", minStock: 20, qtyInStore: 15 });

  it("alerts on the run where the product crossed below the minimum", () => {
    // Was 25 (ok), 10 went out, now 15.
    const deltas = new Map([["xt30", -10]]);
    expect(selectNewlyLow([lowRow], deltas).map((r) => r.productId)).toEqual(["xt30"]);
  });

  it("stays silent on a product that was already low yesterday", () => {
    // Was 18 (already low), 3 more went out, now 15.
    const deltas = new Map([["xt30", -3]]);
    expect(selectNewlyLow([lowRow], deltas)).toEqual([]);
  });

  it("stays silent when nothing moved at all", () => {
    // The standing-low case: no movement, so no crossing. This is the one
    // that would otherwise nag the club chat every single morning.
    expect(selectNewlyLow([lowRow], new Map())).toEqual([]);
  });

  it("alerts again after a restock pushed it back over and it fell again", () => {
    // Was 21 (ok, just above min) after a delivery, 6 went out, now 15.
    const deltas = new Map([["xt30", -6]]);
    expect(selectNewlyLow([lowRow], deltas)).toHaveLength(1);
  });
});

describe("selectNewlyNegative", () => {
  const negativeRow = row({ productId: "res", name: "Resistor", minStock: 50, qtyInStore: -3 });

  it("alerts the first time a product goes below zero", () => {
    const deltas = new Map([["res", -5]]); // was 2
    expect(selectNewlyNegative([negativeRow], deltas)).toHaveLength(1);
  });

  it("stays silent while it merely gets more negative", () => {
    const deltas = new Map([["res", -1]]); // was -2
    expect(selectNewlyNegative([negativeRow], deltas)).toEqual([]);
  });

  it("stays silent when it has been negative for weeks with no movement", () => {
    expect(selectNewlyNegative([negativeRow], new Map())).toEqual([]);
  });
});
