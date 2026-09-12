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

  it("ignores a group code when deciding whether a product has its own label", () => {
    // A group code resolves to a location and offers a list; it is not the
    // product's own sticker, and reprinting it is a different job.
    const rows = computeLabelHealth(
      entries("p-unlabelled", "search", 5),
      [products[2]],
      [{ code: "GRP111", productId: null, kind: "group", active: true }],
    );
    expect(rows[0].verdict).toBe("no_label");
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
