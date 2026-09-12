import { describe, expect, it } from "vitest";

import {
  countNegativeLines,
  groupHoldingsByHolder,
  type HolderRef,
  type HoldingRow,
  type ProductRef,
} from "@/app/admin/holdings/group";

const holders: HolderRef[] = [
  { id: "h-store", name: "Store", kind: "store" },
  { id: "h-hero", name: "Hero", kind: "robot" },
  { id: "h-dark", name: "DarkNUS", kind: "robot" },
  { id: "h-mem", name: "Alice", kind: "member" },
  { id: "h-cons", name: "Consumed", kind: "consumed" },
  { id: "h-adj", name: "Adjustment", kind: "adjustment" },
];

const products: ProductRef[] = [
  { id: "p-m3508", name: "M3508", unit: "pcs", tier: "asset" },
  { id: "p-xt30", name: "XT30", unit: "pcs", tier: "bulk" },
  { id: "p-shrink", name: "Heat shrink", unit: null, tier: "loose" },
];

function row(product: string, holder: string, qty: number): HoldingRow {
  return { product_id: product, holder_id: holder, qty };
}

describe("groupHoldingsByHolder", () => {
  it("buckets rows by holder and joins in the product name", () => {
    const groups = groupHoldingsByHolder(
      [row("p-m3508", "h-hero", 7), row("p-xt30", "h-hero", 12)],
      holders,
      products,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].holder.name).toBe("Hero");
    expect(groups[0].lines.map((l) => l.productName)).toEqual(["M3508", "XT30"]);
    expect(groups[0].productCount).toBe(2);
    expect(groups[0].totalUnits).toBe(19);
  });

  it("orders holders store → robot → member → pseudo, then by name", () => {
    const groups = groupHoldingsByHolder(
      [
        row("p-m3508", "h-adj", -64),
        row("p-m3508", "h-mem", 1),
        row("p-m3508", "h-hero", 7),
        row("p-m3508", "h-store", 6),
        row("p-m3508", "h-dark", 15),
        row("p-m3508", "h-cons", 3),
      ],
      holders,
      products,
    );
    expect(groups.map((g) => g.holder.name)).toEqual([
      "Store",
      "DarkNUS",
      "Hero",
      "Alice",
      "Consumed",
      "Adjustment",
    ]);
  });

  it("sorts negative lines to the top of their holder", () => {
    const groups = groupHoldingsByHolder(
      [
        row("p-xt30", "h-store", 50),
        row("p-m3508", "h-store", -12),
        row("p-shrink", "h-store", 2),
      ],
      holders,
      products,
    );
    expect(groups[0].lines.map((l) => l.productName)).toEqual([
      "M3508",
      "Heat shrink",
      "XT30",
    ]);
    expect(groups[0].negativeCount).toBe(1);
    expect(groups[0].totalUnits).toBe(40);
  });

  it("skips rows whose holder is unknown rather than inventing a group", () => {
    const groups = groupHoldingsByHolder(
      [row("p-m3508", "h-ghost", 3), row("p-m3508", "h-hero", 1)],
      holders,
      products,
    );
    expect(groups.map((g) => g.holder.id)).toEqual(["h-hero"]);
  });

  it("keeps a line whose product row is missing — a dangling balance is the point", () => {
    const groups = groupHoldingsByHolder(
      [row("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "h-hero", -4)],
      holders,
      products,
    );
    expect(groups[0].lines[0].productName).toContain("unknown product");
    expect(groups[0].lines[0].qty).toBe(-4);
  });

  it("tolerates the view's nullable columns and drops zero balances", () => {
    const groups = groupHoldingsByHolder(
      [
        { product_id: null, holder_id: "h-hero", qty: 3 },
        { product_id: "p-m3508", holder_id: null, qty: 3 },
        { product_id: "p-m3508", holder_id: "h-hero", qty: null },
        row("p-xt30", "h-hero", 0),
        row("p-m3508", "h-hero", 5),
      ],
      holders,
      products,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].lines).toHaveLength(1);
    expect(groups[0].lines[0].productName).toBe("M3508");
  });

  it("defaults a null product unit to pcs", () => {
    const groups = groupHoldingsByHolder(
      [row("p-shrink", "h-hero", 1)],
      holders,
      products,
    );
    expect(groups[0].lines[0].unit).toBe("pcs");
  });

  it("returns no groups for an empty ledger", () => {
    expect(groupHoldingsByHolder([], holders, products)).toEqual([]);
  });
});

describe("countNegativeLines", () => {
  it("sums negative lines across every holder", () => {
    const groups = groupHoldingsByHolder(
      [
        row("p-m3508", "h-store", -12),
        row("p-xt30", "h-store", -130),
        row("p-m3508", "h-hero", 7),
        row("p-xt30", "h-dark", -1),
      ],
      holders,
      products,
    );
    expect(countNegativeLines(groups)).toBe(3);
  });

  it("is zero when everything balances positive", () => {
    const groups = groupHoldingsByHolder(
      [row("p-m3508", "h-store", 6)],
      holders,
      products,
    );
    expect(countNegativeLines(groups)).toBe(0);
  });
});
