import { describe, expect, it } from "vitest";

import { buildTotals, groupBySection, inStoreFor, isShort, lineCost } from "@/app/admin/builds/build-summary";

const line = (over: Partial<Parameters<typeof lineCost>[0]> = {}) => ({
  section: "Chassis",
  qty: 4,
  sourcing: "buy",
  unit_price_sgd: 80,
  product_id: null as string | null,
  ...over,
});

describe("build summary", () => {
  const stock = new Map([["c620", 3]]);

  it("costs only lines with both a quantity and a price", () => {
    expect(lineCost(line())).toBe(320);
    expect(lineCost(line({ qty: null }))).toBeNull();
    expect(lineCost(line({ unit_price_sgd: null }))).toBeNull();
  });

  it("compares linked lines with the store", () => {
    expect(inStoreFor(line(), stock)).toBeNull();
    expect(inStoreFor(line({ product_id: "c620" }), stock)).toBe(3);
    expect(inStoreFor(line({ product_id: "unknown" }), stock)).toBe(0);
    expect(isShort(line({ product_id: "c620" }), stock)).toBe(true);
    expect(isShort(line({ product_id: "c620", qty: 3 }), stock)).toBe(false);
    expect(isShort(line({ product_id: "c620", qty: null }), stock)).toBe(false);
  });

  it("totals a list, keeping referee-kit and unpriced lines out of the cost", () => {
    const totals = buildTotals(
      [
        line({ product_id: "c620" }),
        line({ qty: 1, unit_price_sgd: 70.745 }),
        line({ sourcing: "referee_kit", unit_price_sgd: null, product_id: "pm02" }),
        line({ qty: null, unit_price_sgd: null }),
      ],
      stock,
    );
    expect(totals).toEqual({ lines: 4, estCostSgd: 390.75, unpriced: 1, refereeKit: 1, linked: 2, short: 2 });
  });

  it("groups by section in sheet order", () => {
    const groups = groupBySection([line({ section: "Gimbal" }), line(), line({ section: null }), line({ section: "Gimbal" })]);
    expect(groups.map((g) => [g.section, g.lines.length])).toEqual([
      ["Gimbal", 2],
      ["Chassis", 1],
      ["Other", 1],
    ]);
  });
});
