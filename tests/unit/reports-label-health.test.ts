import { describe, expect, it } from "vitest";

import {
  computeLabelHealth,
  needsAttention,
  type LabelHealthCode,
  type LabelHealthEntry,
  type LabelHealthProduct,
} from "@/lib/reports/label-health";

const products: LabelHealthProduct[] = [
  { id: "p-scanned", name: "GM6020", tier: "asset", active: true },
  { id: "p-searched", name: "M3508", tier: "asset", active: true },
  { id: "p-unlabelled", name: "C620 ESC", tier: "asset", active: true },
  { id: "p-quiet", name: "Damiao 4310", tier: "asset", active: true },
  { id: "p-retired", name: "Old motor", tier: "asset", active: false },
];

const codes: LabelHealthCode[] = [
  { code: "AAA111", productId: "p-scanned", kind: "product", active: true },
  { code: "BBB222", productId: "p-searched", kind: "product", active: true },
  { code: "CCC333", productId: "p-quiet", kind: "product", active: true },
  // The unlabelled product's code was retired and never reissued.
  { code: "DDD444", productId: "p-unlabelled", kind: "product", active: false },
];

function entries(productId: string, method: string, times: number): LabelHealthEntry[] {
  return Array.from({ length: times }, () => ({ productId, entryMethod: method }));
}

describe("computeLabelHealth", () => {
  const rows = computeLabelHealth(
    [
      ...entries("p-scanned", "scan", 8),
      ...entries("p-scanned", "search", 1),
      ...entries("p-searched", "search", 6),
      ...entries("p-searched", "scan", 1),
      ...entries("p-unlabelled", "search", 5),
      ...entries("p-quiet", "scan", 1),
      // Restock and stocktake entries: no label was involved.
      ...entries("p-quiet", "admin", 40),
    ],
    products,
    codes,
  );

  const byId = new Map(rows.map((row) => [row.productId, row]));

  it("passes a product people actually scan", () => {
    expect(byId.get("p-scanned")?.verdict).toBe("ok");
  });

  it("flags a product consistently reached by search", () => {
    // qr-labels.md: that "almost certainly has a missing or damaged sticker".
    const row = byId.get("p-searched");
    expect(row?.verdict).toBe("suspect");
    expect(row?.searchRatio).toBeCloseTo(6 / 7);
  });

  it("flags a product with no active code at all as the strongest signal", () => {
    expect(byId.get("p-unlabelled")?.verdict).toBe("no_label");
    expect(byId.get("p-unlabelled")?.code).toBeNull();
  });

  it("refuses to judge a product with too few entries", () => {
    expect(byId.get("p-quiet")?.verdict).toBe("insufficient_data");
  });

  it("does not count admin entries towards the sample size", () => {
    // 40 restock lines must not make one scan look like a confident verdict.
    expect(byId.get("p-quiet")?.total).toBe(1);
  });

  it("skips deactivated products entirely", () => {
    expect(byId.has("p-retired")).toBe(false);
  });

  it("carries the code to reprint", () => {
    expect(byId.get("p-searched")?.code).toBe("BBB222");
  });

  it("sorts the worst problems first", () => {
    expect(rows[0].productId).toBe("p-unlabelled");
    expect(rows[1].productId).toBe("p-searched");
  });
});

describe("computeLabelHealth thresholds", () => {
  it("treats exactly-half searched as suspect at the default threshold", () => {
    const rows = computeLabelHealth(
      [...entries("p-scanned", "scan", 3), ...entries("p-scanned", "search", 3)],
      [products[0]],
      [codes[0]],
    );
    expect(rows[0].verdict).toBe("suspect");
  });

  it("honours a stricter configured threshold", () => {
    const rows = computeLabelHealth(
      [...entries("p-scanned", "scan", 3), ...entries("p-scanned", "search", 3)],
      [products[0]],
      [codes[0]],
      { searchRatioThreshold: 0.8 },
    );
    expect(rows[0].verdict).toBe("ok");
  });

  it("honours a configured minimum sample size", () => {
    const rows = computeLabelHealth(
      [...entries("p-scanned", "search", 3)],
      [products[0]],
      [codes[0]],
      { minEntries: 10 },
    );
    expect(rows[0].verdict).toBe("insufficient_data");
  });

  it("does not flag an unlabelled product nobody has ever reached for", () => {
    const rows = computeLabelHealth([], [products[2]], codes);
    expect(rows[0].verdict).toBe("insufficient_data");
  });

  it("ignores a group code somewhere else entirely", () => {
    // A group code resolves to a LOCATION. One on a different shelf (or on
    // no shelf at all) says nothing about this product.
    const rows = computeLabelHealth(
      entries("p-unlabelled", "search", 5),
      [{ ...products[2], locationId: "loc-shelf-a" }],
      [
        { code: "GRP111", productId: null, kind: "group", active: true, locationId: "loc-shelf-b" },
        { code: "GRP222", productId: null, kind: "group", active: true, locationId: null },
      ],
    );
    expect(rows[0].verdict).toBe("no_label");
  });

  // -------------------------------------------------------------------------
  // Group-label coverage. This is the resistor book: ONE sticker on a
  // location, resolving to ~157 products that deliberately have no code of
  // their own. Counting those as "no active label" pointed the dashboard's
  // loudest signal at the arrangement working exactly as designed.
  // -------------------------------------------------------------------------
  it("counts a product covered by an active group code at its location as labelled", () => {
    const rows = computeLabelHealth(
      entries("p-unlabelled", "group_pick", 5),
      [{ ...products[2], locationId: "loc-resistor-book" }],
      [
        {
          code: "GRP111",
          productId: null,
          kind: "group",
          active: true,
          locationId: "loc-resistor-book",
        },
      ],
    );
    expect(rows[0].hasActiveCode).toBe(true);
    expect(rows[0].groupCode).toBe("GRP111");
    expect(rows[0].verdict).toBe("ok");
  });

  it("still flags a group-labelled product people cannot scan", () => {
    // The group sticker exists but is not working: every entry is a search.
    // That is `suspect` (reprint the group label), not `no_label`.
    const rows = computeLabelHealth(
      entries("p-unlabelled", "search", 5),
      [{ ...products[2], locationId: "loc-resistor-book" }],
      [
        {
          code: "GRP111",
          productId: null,
          kind: "group",
          active: true,
          locationId: "loc-resistor-book",
        },
      ],
    );
    expect(rows[0].verdict).toBe("suspect");
    expect(rows[0].groupCode).toBe("GRP111");
  });

  it("does not count a RETIRED group code as coverage", () => {
    const rows = computeLabelHealth(
      entries("p-unlabelled", "search", 5),
      [{ ...products[2], locationId: "loc-resistor-book" }],
      [
        {
          code: "GRP111",
          productId: null,
          kind: "group",
          active: false,
          locationId: "loc-resistor-book",
        },
      ],
    );
    expect(rows[0].verdict).toBe("no_label");
    expect(rows[0].groupCode).toBeNull();
  });

  it("leaves a product with no location uncovered", () => {
    const rows = computeLabelHealth(
      entries("p-unlabelled", "search", 5),
      [{ ...products[2], locationId: null }],
      [
        {
          code: "GRP111",
          productId: null,
          kind: "group",
          active: true,
          locationId: "loc-resistor-book",
        },
      ],
    );
    expect(rows[0].verdict).toBe("no_label");
  });

  it("prefers the product's own code over the group one when both exist", () => {
    const rows = computeLabelHealth(
      entries("p-scanned", "search", 5),
      [{ ...products[0], locationId: "loc-resistor-book" }],
      [
        codes[0],
        {
          code: "GRP111",
          productId: null,
          kind: "group",
          active: true,
          locationId: "loc-resistor-book",
        },
      ],
    );
    expect(rows[0].code).toBe("AAA111");
    expect(rows[0].groupCode).toBe("GRP111");
  });
});

describe("needsAttention", () => {
  it("keeps only the rows something can be done about", () => {
    const rows = computeLabelHealth(
      [
        ...entries("p-scanned", "scan", 8),
        ...entries("p-searched", "search", 6),
        ...entries("p-unlabelled", "search", 5),
      ],
      products,
      codes,
    );
    expect(needsAttention(rows).map((row) => row.productId)).toEqual([
      "p-unlabelled",
      "p-searched",
    ]);
  });
});
