import { describe, expect, it } from "vitest";

import {
  addLine,
  describeRestock,
  removeLine,
  setLineQty,
  totalUnits,
  validateRestockLines,
  type RestockLine,
} from "@/app/admin/restock/lines";
import {
  PRODUCT_SEARCH_COLUMNS,
  buildProductSearchFilter,
  escapeLikePattern,
  matchProducts,
  quoteOrFilterValue,
} from "@/app/admin/restock/product-search";

const gm6020 = { id: "p1", name: "GM6020", unit: "pcs" };
const xt30 = { id: "p2", name: "XT30 right angle M", unit: "pcs" };

describe("addLine", () => {
  it("appends a new product with qty 1", () => {
    const lines = addLine([], gm6020);
    expect(lines).toEqual([
      { productId: "p1", name: "GM6020", unit: "pcs", qty: 1 },
    ]);
  });

  it("bumps the existing line instead of appending a duplicate", () => {
    const lines = addLine(addLine([], gm6020), gm6020);
    expect(lines).toHaveLength(1);
    expect(lines[0].qty).toBe(2);
  });

  it("does not mutate the input array", () => {
    const before: RestockLine[] = [
      { productId: "p1", name: "GM6020", unit: "pcs", qty: 3 },
    ];
    const after = addLine(before, gm6020);
    expect(before[0].qty).toBe(3);
    expect(after[0].qty).toBe(4);
  });

  it("defaults a missing unit to pcs rather than writing null into the UI", () => {
    const lines = addLine([], { id: "p3", name: "Heat shrink", unit: null });
    expect(lines[0].unit).toBe("pcs");
  });

  it("honours an explicit starting quantity", () => {
    expect(addLine([], gm6020, 25)[0].qty).toBe(25);
  });
});

describe("setLineQty", () => {
  it("sets the quantity of the named line only", () => {
    const lines = addLine(addLine([], gm6020), xt30);
    const next = setLineQty(lines, "p2", 40);
    expect(next[0].qty).toBe(1);
    expect(next[1].qty).toBe(40);
  });

  it("removes the line when the quantity drops to zero or below", () => {
    const lines = addLine([], gm6020);
    expect(setLineQty(lines, "p1", 0)).toEqual([]);
    expect(setLineQty(lines, "p1", -5)).toEqual([]);
  });
});

describe("removeLine", () => {
  it("drops only the named line", () => {
    const lines = addLine(addLine([], gm6020), xt30);
    expect(removeLine(lines, "p1").map((l) => l.productId)).toEqual(["p2"]);
  });
});

describe("validateRestockLines", () => {
  it("rejects an empty delivery", () => {
    const result = validateRestockLines([]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/at least one product/i);
  });

  it("reduces valid lines to the RPC payload shape", () => {
    const lines = setLineQty(addLine(addLine([], gm6020), xt30), "p2", 50);
    const result = validateRestockLines(lines);
    expect(result).toEqual({
      ok: true,
      lines: [
        { productId: "p1", qty: 1 },
        { productId: "p2", qty: 50 },
      ],
    });
  });

  it("rejects a non-integer quantity", () => {
    const result = validateRestockLines([
      { productId: "p1", name: "GM6020", unit: "pcs", qty: 2.5 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/whole number/i);
  });

  it("rejects a zero or negative quantity", () => {
    for (const qty of [0, -3]) {
      const result = validateRestockLines([
        { productId: "p1", name: "GM6020", unit: "pcs", qty },
      ]);
      expect(result.ok).toBe(false);
    }
  });

  it("rejects a duplicate product id even though the DB would accept it", () => {
    const result = validateRestockLines([
      { productId: "p1", name: "GM6020", unit: "pcs", qty: 1 },
      { productId: "p1", name: "GM6020", unit: "pcs", qty: 2 },
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/twice/i);
  });
});

describe("totalUnits / describeRestock", () => {
  it("sums the quantities", () => {
    const lines = setLineQty(addLine(addLine([], gm6020), xt30), "p2", 49);
    expect(totalUnits(lines)).toBe(50);
  });

  it("singularises one product and one unit", () => {
    expect(describeRestock(addLine([], gm6020))).toBe("1 product, 1 unit");
  });

  it("pluralises everything else", () => {
    const lines = setLineQty(addLine(addLine([], gm6020), xt30), "p2", 49);
    expect(describeRestock(lines)).toBe("2 products, 50 units");
  });
});

describe("buildProductSearchFilter", () => {
  it("wraps the query in wildcards across every searched column", () => {
    expect(buildProductSearchFilter("GM60")).toBe(
      'name.ilike."%GM60%",part_number.ilike."%GM60%",category.ilike."%GM60%"',
    );
  });

  it("trims surrounding whitespace", () => {
    expect(buildProductSearchFilter("  GM60  ")).toContain('"%GM60%"');
  });

  it("escapes LIKE wildcards so a literal % is not a match-everything", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("under_score")).toBe("under\\_score");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
  });

  it("quotes the value so a comma cannot split one filter into two", () => {
    // Unquoted, `name.ilike.%XT30, right%` would be parsed as two filters and
    // the second would be malformed.
    const filter = buildProductSearchFilter("XT30, right");
    expect(filter).toBe(
      'name.ilike."%XT30, right%",part_number.ilike."%XT30, right%",' +
        'category.ilike."%XT30, right%"',
    );
  });

  it("escapes quotes and backslashes inside the quoted value", () => {
    expect(quoteOrFilterValue('a"b')).toBe('"a\\"b"');
    expect(quoteOrFilterValue("a\\b")).toBe('"a\\\\b"');
  });

  it("searches name, part number and category", () => {
    expect([...PRODUCT_SEARCH_COLUMNS]).toEqual([
      "name",
      "part_number",
      "category",
    ]);
  });
});

describe("matchProducts (cached restock search)", () => {
  const products = [
    { name: "XT30 connector", part_number: "XT30-M", category: "Connectors", active: true },
    { name: "DJI M3508 motor", part_number: "M3508", category: "Motors", active: true },
    { name: "Old XT30 lead", part_number: null, category: "Cables", active: false },
    { name: "Power cable", part_number: "PC-XT30", category: "Cables", active: true },
  ];

  it("matches name, part number and category, name hits first", () => {
    expect(matchProducts(products, "xt30", 10).map((p) => p.name)).toEqual(["XT30 connector", "Power cable"]);
  });

  it("skips inactive products and empty queries", () => {
    expect(matchProducts(products, "old", 10)).toEqual([]);
    expect(matchProducts(products, "   ", 10)).toEqual([]);
  });

  it("treats wildcards and commas as plain text", () => {
    expect(matchProducts(products, "%", 10)).toEqual([]);
    expect(matchProducts(products, "motor", 1).map((p) => p.name)).toEqual(["DJI M3508 motor"]);
  });
});
