import { describe, expect, it } from "vitest";

import {
  entryMethodBreakdown,
  formatRatio,
  modesPresent,
  sessionsPerDay,
  summariseScanMisses,
} from "@/lib/reports/activity";

describe("sessionsPerDay", () => {
  const now = new Date("2026-09-14T02:00:00Z"); // 10:00 SGT, Monday

  it("emits one row per day in the window, oldest first", () => {
    const rows = sessionsPerDay([], { days: 3, now, timeZone: "Asia/Singapore" });
    expect(rows.map((row) => row.date)).toEqual(["2026-09-12", "2026-09-13", "2026-09-14"]);
  });

  it("keeps days with no sessions rather than dropping them", () => {
    // A gap is the interesting part of a usage chart; compacting it would
    // redraw a dead week as a busy one.
    const rows = sessionsPerDay(
      [{ mode: "borrow", startedAt: "2026-09-14T01:00:00Z" }],
      { days: 3, now, timeZone: "Asia/Singapore" },
    );
    expect(rows).toHaveLength(3);
    expect(rows[0].total).toBe(0);
    expect(rows[2].total).toBe(1);
  });

  it("buckets by mode", () => {
    const rows = sessionsPerDay(
      [
        { mode: "borrow", startedAt: "2026-09-14T01:00:00Z" },
        { mode: "borrow", startedAt: "2026-09-14T03:00:00Z" },
        { mode: "return", startedAt: "2026-09-14T04:00:00Z" },
      ],
      { days: 2, now, timeZone: "Asia/Singapore" },
    );
    const today = rows[rows.length - 1];
    expect(today.byMode).toEqual({ borrow: 2, return: 1 });
    expect(today.total).toBe(3);
  });

  it("buckets by the club's calendar day, not UTC's", () => {
    // 2026-09-13T17:30Z is already Monday morning in Singapore.
    const rows = sessionsPerDay(
      [{ mode: "borrow", startedAt: "2026-09-13T17:30:00Z" }],
      { days: 3, now, timeZone: "Asia/Singapore" },
    );
    expect(rows.find((row) => row.date === "2026-09-14")?.total).toBe(1);
    expect(rows.find((row) => row.date === "2026-09-13")?.total).toBe(0);
  });

  it("ignores sessions outside the window and unparseable timestamps", () => {
    const rows = sessionsPerDay(
      [
        { mode: "borrow", startedAt: "2020-01-01T00:00:00Z" },
        { mode: "borrow", startedAt: "nonsense" },
      ],
      { days: 3, now, timeZone: "Asia/Singapore" },
    );
    expect(rows.reduce((sum, row) => sum + row.total, 0)).toBe(0);
  });

  it("lists only the modes that actually appear", () => {
    const rows = sessionsPerDay(
      [
        { mode: "return", startedAt: "2026-09-14T01:00:00Z" },
        { mode: "borrow", startedAt: "2026-09-14T01:00:00Z" },
      ],
      { days: 2, now, timeZone: "Asia/Singapore" },
    );
    expect(modesPresent(rows)).toEqual(["borrow", "return"]);
  });
});

describe("entryMethodBreakdown (scan vs. search)", () => {
  it("counts a group pick as a scan", () => {
    // The member DID scan a sticker -- the resistor book's, not the part's.
    const breakdown = entryMethodBreakdown([
      { entryMethod: "scan" },
      { entryMethod: "group_pick" },
      { entryMethod: "search" },
      { entryMethod: "search" },
    ]);
    expect(breakdown.scan).toBe(1);
    expect(breakdown.groupPick).toBe(1);
    expect(breakdown.scanRatio).toBe(0.5);
  });

  it("excludes admin entries from the ratio", () => {
    // A restock is typed in at a desk; counting it as "not scanned" would
    // blame the labels for a flow that has no labels in it.
    const breakdown = entryMethodBreakdown([
      { entryMethod: "scan" },
      { entryMethod: "admin" },
      { entryMethod: "admin" },
    ]);
    expect(breakdown.admin).toBe(2);
    expect(breakdown.memberEntries).toBe(1);
    expect(breakdown.scanRatio).toBe(1);
  });

  it("returns a null ratio rather than 0 when there is no data", () => {
    expect(entryMethodBreakdown([]).scanRatio).toBeNull();
    expect(entryMethodBreakdown([{ entryMethod: "admin" }]).scanRatio).toBeNull();
  });

  it("counts a null/unknown entry_method separately", () => {
    const breakdown = entryMethodBreakdown([{ entryMethod: null }, { entryMethod: "weird" }]);
    expect(breakdown.unknown).toBe(2);
    expect(breakdown.memberEntries).toBe(0);
  });

  it("formats a ratio as a whole percent, and nothing as an em dash", () => {
    expect(formatRatio(0.834)).toBe("83%");
    expect(formatRatio(null)).toBe("—");
  });
});

describe("summariseScanMisses", () => {
  it("groups by code, because the actionable unit is a label", () => {
    const groups = summariseScanMisses([
      { code: "A3F9K2", outcome: "retired", createdAt: "2026-09-01T00:00:00Z" },
      { code: "A3F9K2", outcome: "retired", createdAt: "2026-09-03T00:00:00Z" },
      { code: "ZZZZZZ", outcome: "unknown", createdAt: "2026-09-02T00:00:00Z" },
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ code: "A3F9K2", count: 2, lastSeen: "2026-09-03T00:00:00Z" });
  });

  it("orders by how often the code has been scanned", () => {
    const groups = summariseScanMisses([
      { code: "ONCE", outcome: "unknown", createdAt: "2026-09-05T00:00:00Z" },
      { code: "OFTEN", outcome: "retired", createdAt: "2026-09-01T00:00:00Z" },
      { code: "OFTEN", outcome: "retired", createdAt: "2026-09-02T00:00:00Z" },
    ]);
    expect(groups.map((group) => group.code)).toEqual(["OFTEN", "ONCE"]);
  });

  it("keeps every distinct outcome a code produced, most common first", () => {
    const groups = summariseScanMisses([
      { code: "MIXED", outcome: "retired", createdAt: "2026-09-01T00:00:00Z" },
      { code: "MIXED", outcome: "inactive_product", createdAt: "2026-09-02T00:00:00Z" },
      { code: "MIXED", outcome: "retired", createdAt: "2026-09-03T00:00:00Z" },
    ]);
    expect(groups[0].outcomes).toEqual(["retired", "inactive_product"]);
  });

  it("returns nothing for no misses", () => {
    expect(summariseScanMisses([])).toEqual([]);
  });
});
