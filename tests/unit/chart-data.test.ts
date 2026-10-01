import { describe, expect, it } from "vitest";

import {
  dayLabel,
  movementGroup,
  movementsPerDay,
  SESSION_MODE_SERIES,
  seriesPresent,
  toDailySeries,
  topN,
  toSegments,
} from "@/lib/reports/chart-data";

describe("chart data", () => {
  it("labels days for an axis", () => {
    expect(dayLabel("2026-10-03")).toBe("3 Oct");
  });

  it("zero-fills every series so stacked bars line up", () => {
    const points = toDailySeries(
      [{ date: "2026-10-01", byMode: { borrow: 2 }, total: 2 }],
      SESSION_MODE_SERIES,
    );
    expect(points[0]).toMatchObject({ borrow: 2, return: 0, restock: 0, label: "1 Oct", total: 2 });
  });

  it("keeps a series' colour slot whatever else is present", () => {
    const points = toDailySeries([{ date: "2026-10-01", byMode: { return: 1 }, total: 1 }], SESSION_MODE_SERIES);
    const present = seriesPresent(points, SESSION_MODE_SERIES);
    expect(present.map((s) => [s.key, s.slot])).toEqual([["return", 2]]);
  });

  it("folds the nine movement reasons into five groups", () => {
    expect(movementGroup("consume")).toBe("out");
    expect(movementGroup("return_adjustment")).toBe("returned");
    expect(movementGroup("stocktake_loss")).toBe("stocktake");
    expect(movementGroup("seed")).toBe("restock");
  });

  it("buckets movements per day in the club's zone", () => {
    const now = new Date("2026-10-02T04:00:00Z");
    const points = movementsPerDay(
      [
        { reason: "borrow", createdAt: "2026-10-02T01:00:00Z" },
        { reason: "consume", createdAt: "2026-10-02T02:00:00Z" },
        { reason: "restock", createdAt: "2026-10-01T03:00:00Z" },
      ],
      { days: 2, now },
    );
    expect(points.map((p) => [p.date, p.out, p.restock])).toEqual([
      ["2026-10-01", 0, 1],
      ["2026-10-02", 2, 0],
    ]);
  });

  it("drops zero parts and computes shares", () => {
    const segments = toSegments([
      { key: "a", label: "A", value: 3 },
      { key: "b", label: "B", value: 0 },
      { key: "c", label: "C", value: 1 },
    ]);
    expect(segments.map((s) => [s.key, s.share])).toEqual([
      ["a", 0.75],
      ["c", 0.25],
    ]);
    expect(toSegments([{ key: "a", label: "A", value: 0 }])).toEqual([]);
  });

  it("keeps the top N and counts the rest", () => {
    expect(topN([1, 5, 3, 4], 2, (n) => n)).toEqual({ shown: [5, 4], rest: 2 });
  });
});
