import { describe, expect, it } from "vitest";

import {
  DIGEST_WEEKDAY,
  dateInZone,
  isDigestDay,
  REPORT_TIME_ZONE,
  weekdayInZone,
} from "@/lib/reports/schedule";

describe("weekdayInZone", () => {
  it("resolves the weekday in the club's zone, not the server's", () => {
    // 17:00 UTC Sunday is 01:00 Monday in Singapore. A naive getUTCDay()
    // here would return Sunday and the weekly digest would never fire.
    const instant = new Date("2026-09-13T17:00:00Z");
    expect(weekdayInZone(instant, "UTC")).toBe(0);
    expect(weekdayInZone(instant, REPORT_TIME_ZONE)).toBe(1);
  });

  it("defaults to the club's zone", () => {
    expect(weekdayInZone(new Date("2026-09-13T17:00:00Z"))).toBe(1);
  });

  it("stays on Sunday one minute before the Singapore day rolls over", () => {
    expect(weekdayInZone(new Date("2026-09-13T15:59:00Z"))).toBe(0);
  });
});

describe("dateInZone", () => {
  it("formats as a sortable YYYY-MM-DD in the club's zone", () => {
    expect(dateInZone(new Date("2026-09-13T17:00:00Z"))).toBe("2026-09-14");
    expect(dateInZone(new Date("2026-09-13T17:00:00Z"), "UTC")).toBe("2026-09-13");
  });
});

describe("isDigestDay (weekday gating for the one daily cron)", () => {
  // The cron fires at 01:00 UTC = 09:00 SGT. These are the real instants the
  // job would see across one week.
  const runs = [
    { iso: "2026-09-07T01:00:00Z", label: "Mon" },
    { iso: "2026-09-08T01:00:00Z", label: "Tue" },
    { iso: "2026-09-09T01:00:00Z", label: "Wed" },
    { iso: "2026-09-10T01:00:00Z", label: "Thu" },
    { iso: "2026-09-11T01:00:00Z", label: "Fri" },
    { iso: "2026-09-12T01:00:00Z", label: "Sat" },
    { iso: "2026-09-13T01:00:00Z", label: "Sun" },
  ];

  it("fires on exactly one day of the week", () => {
    const firing = runs.filter((run) => isDigestDay(new Date(run.iso)));
    expect(firing.map((run) => run.label)).toEqual(["Mon"]);
  });

  it("uses Monday by default", () => {
    expect(DIGEST_WEEKDAY).toBe(1);
    expect(isDigestDay(new Date("2026-09-07T01:00:00Z"), 1)).toBe(true);
  });

  it("honours a different configured weekday", () => {
    expect(isDigestDay(new Date("2026-09-11T01:00:00Z"), 5)).toBe(true);
    expect(isDigestDay(new Date("2026-09-11T01:00:00Z"), 1)).toBe(false);
  });

  it("would have fired on the wrong day if the zone were ignored", () => {
    // Sunday 17:00 UTC is Monday in Singapore: the club's Monday morning
    // digest, and a demonstration that the zone is load-bearing.
    const instant = new Date("2026-09-13T17:00:00Z");
    expect(isDigestDay(instant, 1, "UTC")).toBe(false);
    expect(isDigestDay(instant, 1, REPORT_TIME_ZONE)).toBe(true);
  });
});
