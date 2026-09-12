import { describe, expect, it } from "vitest";

import {
  buildCommitPayload,
  deserializeWalk,
  enteredCount,
  formatVariance,
  newWalk,
  parseCountInput,
  planMovement,
  serializeWalk,
  setWalkCount,
  summariseWalk,
  varianceDirection,
  varianceOf,
  WALK_VERSION,
  type StocktakeWalk,
} from "@/app/admin/stocktake/walk";

const STORE = "holder-store";
const ADJUSTMENT = "holder-adjustment";

function walkFixture(counts: Record<string, string> = {}): StocktakeWalk {
  return {
    ...newWalk({
      clientToken: "11111111-1111-4111-8111-111111111111",
      locationId: "loc-book",
      locationName: "Resistor book",
      now: "2026-03-01T09:00:00.000Z",
    }),
    counts,
  };
}

describe("parseCountInput (count validation)", () => {
  it("accepts a plain non-negative integer", () => {
    expect(parseCountInput("250")).toEqual({ ok: true, value: 250 });
  });

  it("accepts zero — 'counted, found none' is a real count", () => {
    expect(parseCountInput("0")).toEqual({ ok: true, value: 0 });
  });

  it("tolerates surrounding whitespace", () => {
    expect(parseCountInput("  12 ")).toEqual({ ok: true, value: 12 });
  });

  it("rejects a blank entry as 'empty' (skipped, not an error)", () => {
    expect(parseCountInput("")).toEqual({ ok: false, reason: "empty" });
    expect(parseCountInput("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("rejects a negative count, matching stock_counts_counted_qty_check", () => {
    expect(parseCountInput("-1")).toEqual({ ok: false, reason: "negative" });
  });

  it("rejects a fraction of a part", () => {
    expect(parseCountInput("3.5")).toEqual({ ok: false, reason: "not_an_integer" });
  });

  it("rejects keypad typos that Number() would happily coerce", () => {
    expect(parseCountInput("abc")).toEqual({ ok: false, reason: "not_a_number" });
    expect(parseCountInput("1e3")).toEqual({ ok: false, reason: "not_a_number" });
    expect(parseCountInput("0x10")).toEqual({ ok: false, reason: "not_a_number" });
    expect(parseCountInput("12 34")).toEqual({ ok: false, reason: "not_a_number" });
  });
});

describe("variance -> movement direction", () => {
  it("counted more than the ledger knew: a gain from the adjustment holder", () => {
    const variance = varianceOf(15, 12);
    expect(variance).toBe(3);
    expect(varianceDirection(variance)).toBe("gain");
    expect(planMovement(variance, { holderId: STORE, adjustmentHolderId: ADJUSTMENT }))
      .toEqual({
        reason: "stocktake_gain",
        fromHolderId: ADJUSTMENT,
        toHolderId: STORE,
        qty: 3,
      });
  });

  it("counted fewer: a loss written off to the adjustment holder", () => {
    const variance = varianceOf(9, 12);
    expect(variance).toBe(-3);
    expect(varianceDirection(variance)).toBe("loss");
    expect(planMovement(variance, { holderId: STORE, adjustmentHolderId: ADJUSTMENT }))
      .toEqual({
        reason: "stocktake_loss",
        fromHolderId: STORE,
        toHolderId: ADJUSTMENT,
        qty: 3,
      });
  });

  it("ZERO VARIANCE WRITES NO MOVEMENT — qty > 0 and no_self_move both forbid it", () => {
    const variance = varianceOf(12, 12);
    expect(variance).toBe(0);
    expect(varianceDirection(variance)).toBe("match");
    expect(
      planMovement(variance, { holderId: STORE, adjustmentHolderId: ADJUSTMENT }),
    ).toBeNull();
  });

  it("a planned movement always carries a positive qty", () => {
    for (const variance of [-7, -1, 1, 7]) {
      const planned = planMovement(variance, {
        holderId: STORE,
        adjustmentHolderId: ADJUSTMENT,
      });
      expect(planned!.qty).toBeGreaterThan(0);
      expect(planned!.fromHolderId).not.toBe(planned!.toHolderId);
    }
  });

  it("formats variance with a real minus sign", () => {
    expect(formatVariance(3)).toBe("+3");
    expect(formatVariance(-2)).toBe("−2");
    expect(formatVariance(0)).toBe("0");
  });
});

describe("walk editing", () => {
  it("stores the raw text so a half-typed number isn't coerced", () => {
    const walk = setWalkCount(walkFixture(), "p1", "1", "2026-03-01T09:05:00.000Z");
    expect(walk.counts.p1).toBe("1");
    expect(walk.updatedAt).toBe("2026-03-01T09:05:00.000Z");
  });

  it("blanking an input removes the entry — uncounted is not a counted zero", () => {
    let walk = setWalkCount(walkFixture(), "p1", "7");
    walk = setWalkCount(walk, "p1", "");
    expect(walk.counts).toEqual({});
    expect(enteredCount(walk)).toBe(0);
  });

  it("does not mutate the walk it was given", () => {
    const before = walkFixture({ p1: "7" });
    const after = setWalkCount(before, "p2", "3");
    expect(before.counts).toEqual({ p1: "7" });
    expect(after.counts).toEqual({ p1: "7", p2: "3" });
  });
});

describe("buildCommitPayload", () => {
  it("builds the p_counts array the RPC expects, deterministically ordered", () => {
    const result = buildCommitPayload(walkFixture({ p2: "4", p1: "0" }));
    expect(result).toEqual({
      ok: true,
      counts: [
        { productId: "p1", countedQty: 0 },
        { productId: "p2", countedQty: 4 },
      ],
    });
  });

  it("skips blank entries without failing the build", () => {
    const result = buildCommitPayload(walkFixture({ p1: "4", p2: "  " }));
    expect(result).toEqual({ ok: true, counts: [{ productId: "p1", countedQty: 4 }] });
  });

  it("fails the whole build on any invalid entry — the RPC is atomic", () => {
    const result = buildCommitPayload(walkFixture({ p1: "4", p2: "-3" }));
    expect(result).toEqual({
      ok: false,
      invalid: [{ productId: "p2", reason: "negative" }],
    });
  });

  it("an untouched walk commits nothing", () => {
    expect(buildCommitPayload(walkFixture())).toEqual({ ok: true, counts: [] });
  });
});

describe("summariseWalk (provisional pre-commit summary)", () => {
  it("splits entered counts into matches, gains and losses", () => {
    const walk = walkFixture({ p1: "12", p2: "15", p3: "9", p4: "" });
    expect(summariseWalk(walk, { p1: 12, p2: 12, p3: 12, p4: 12 })).toEqual({
      entered: 3,
      matched: 1,
      gains: 1,
      losses: 1,
      absVariance: 6,
    });
  });

  it("treats a product with no ledger entry as expecting zero", () => {
    expect(summariseWalk(walkFixture({ p1: "4" }), {})).toEqual({
      entered: 1,
      matched: 0,
      gains: 1,
      losses: 0,
      absVariance: 4,
    });
  });
});

describe("walk serialisation (the localStorage round trip)", () => {
  it("round-trips a walk unchanged", () => {
    const walk = walkFixture({ p1: "12", p2: "0" });
    expect(deserializeWalk(serializeWalk(walk))).toEqual(walk);
  });

  it("round-trips the null-location bucket", () => {
    const walk = {
      ...newWalk({
        clientToken: "22222222-2222-4222-8222-222222222222",
        locationId: null,
        locationName: "No location set",
        now: "2026-03-01T09:00:00.000Z",
      }),
      counts: { p1: "3" },
    };
    expect(deserializeWalk(serializeWalk(walk))).toEqual(walk);
  });

  it("returns null for nothing stored", () => {
    expect(deserializeWalk(null)).toBeNull();
    expect(deserializeWalk("")).toBeNull();
  });

  it("returns null rather than throwing on corrupt JSON", () => {
    expect(deserializeWalk("{not json")).toBeNull();
    expect(deserializeWalk('"a string"')).toBeNull();
    expect(deserializeWalk("[]")).toBeNull();
  });

  it("refuses a walk written by a different version", () => {
    const walk = { ...walkFixture({ p1: "1" }), version: WALK_VERSION + 1 };
    expect(deserializeWalk(JSON.stringify(walk))).toBeNull();
  });

  it("refuses a walk with the wrong shape rather than inventing counts", () => {
    const base = walkFixture({ p1: "1" });
    expect(deserializeWalk(JSON.stringify({ ...base, clientToken: "" }))).toBeNull();
    expect(
      deserializeWalk(JSON.stringify({ ...base, counts: { p1: 12 } })),
    ).toBeNull();
    expect(
      deserializeWalk(JSON.stringify({ ...base, locationName: undefined })),
    ).toBeNull();
    expect(deserializeWalk(JSON.stringify({ ...base, counts: null }))).toBeNull();
  });

  it("keeps the client token across a restore, so a retry can't double-correct", () => {
    const walk = walkFixture({ p1: "5" });
    const restored = deserializeWalk(serializeWalk(walk))!;
    expect(restored.clientToken).toBe(walk.clientToken);
  });
});
