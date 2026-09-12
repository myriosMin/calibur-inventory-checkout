import { describe, expect, it } from "vitest";

import {
  buildLowStockAlertText,
  buildNegativeStockAlertText,
  buildOverdueNudgeText,
  buildWeeklyDigestMessages,
  buildWeeklyDigestText,
  formatDays,
  TELEGRAM_MESSAGE_LIMIT,
  formatDuration,
} from "@/lib/reports/messages";

// Nothing the bot sends may contain an emoji (the app's no-emoji convention
// applies to the bot too) or Markdown syntax -- the send path sets no
// parse_mode, so a stray `_` in a part number would render as italics or
// 400 the API.
const EMOJI = /\p{Extended_Pictographic}/u;

describe("formatDays / formatDuration", () => {
  it("agrees with its own noun", () => {
    expect(formatDays(1)).toBe("1 day");
    expect(formatDays(3)).toBe("3 days");
  });

  it("says weeks when it is a whole number of them", () => {
    expect(formatDuration(21)).toBe("3 weeks");
    expect(formatDuration(7)).toBe("1 week");
  });

  it("falls back to days when weeks would be a lie", () => {
    expect(formatDuration(22)).toBe("22 days");
    expect(formatDuration(6)).toBe("6 days");
  });
});

describe("buildOverdueNudgeText", () => {
  const single = buildOverdueNudgeText({
    memberName: "Alex",
    items: [{ productName: "GM6020", qty: 1, unit: "pcs", daysOut: 21 }],
  });

  it("names the member, the part and how long", () => {
    expect(single).toContain("Alex");
    expect(single).toContain("GM6020");
    expect(single).toContain("3 weeks");
  });

  it("offers a way out rather than making a demand", () => {
    expect(single).toContain("Still using it? Nothing to do.");
  });

  it("uses one message for several parts, not one each", () => {
    const many = buildOverdueNudgeText({
      memberName: "Priya",
      items: [
        { productName: "GM6020", qty: 1, unit: "pcs", daysOut: 28 },
        { productName: "C620 ESC", qty: 2, unit: "pcs", daysOut: 21 },
      ],
    });
    expect(many.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(2);
    expect(many).toContain("these out");
    expect(single).toContain("this out");
  });

  it("carries no emoji", () => {
    expect(EMOJI.test(single)).toBe(false);
  });
});

describe("buildLowStockAlertText", () => {
  it("reads like flows.md's example", () => {
    const text = buildLowStockAlertText([
      { name: "XT30 straight M", qtyInStore: 2, minStock: 20, unit: "pcs" },
    ]);
    expect(text).toContain("XT30 straight M is down to 2 pcs");
    expect(text).toContain("(min 20)");
  });

  it("counts the items when there are several", () => {
    const text = buildLowStockAlertText([
      { name: "A", qtyInStore: 1, minStock: 5, unit: "pcs" },
      { name: "B", qtyInStore: 0, minStock: 5, unit: "pcs" },
    ]);
    expect(text.startsWith("Low stock (2 items):")).toBe(true);
  });

  it("omits the threshold when there is none", () => {
    const text = buildLowStockAlertText([
      { name: "A", qtyInStore: 1, minStock: null, unit: "lot" },
    ]);
    expect(text).not.toContain("min");
  });
});

describe("buildNegativeStockAlertText", () => {
  const text = buildNegativeStockAlertText([
    { name: "Resistor 10k", qtyInStore: -4, unit: "pcs" },
  ]);

  it("says explicitly that it is not a shortage", () => {
    // The whole reason this is a separate message from low stock: filing it
    // under "low stock" would send the club shopping for parts already on
    // the shelf.
    expect(text).toContain("not a shortage");
    expect(text).toContain("missing opening balance");
  });

  it("points at the actual fix", () => {
    expect(text).toContain("/admin/restock");
    expect(text).toContain("stocktake");
  });

  it("never uses the words 'low stock'", () => {
    expect(text.toLowerCase()).not.toContain("low stock");
  });
});

describe("buildWeeklyDigestText", () => {
  const full = buildWeeklyDigestText({
    date: "2026-09-14",
    outstanding: [{ name: "M3508", qtyOut: 2, unit: "pcs" }],
    lowStock: [{ name: "XT60 male", qtyInStore: 4, minStock: 10, unit: "pcs" }],
    negative: [{ name: "Resistor 10k", qtyInStore: -4, unit: "pcs" }],
    overdue: [
      { memberName: "Alex", productName: "GM6020", qty: 1, unit: "pcs", daysOut: 28 },
    ],
    sectionLimit: 15,
  });

  it("is dated and covers all four sections", () => {
    expect(full).toContain("Weekly inventory digest — 2026-09-14");
    expect(full).toContain("Out of the store (1)");
    expect(full).toContain("Out with a member past the threshold (1)");
    expect(full).toContain("Low stock (1)");
    expect(full).toContain("Reading below zero");
  });

  it("still sends when nothing is wrong -- that is how the club knows the job runs", () => {
    const quiet = buildWeeklyDigestText({
      date: "2026-09-14",
      outstanding: [],
      lowStock: [],
      negative: [],
      overdue: [],
      sectionLimit: 15,
    });
    expect(quiet).toContain("Out of the store: none");
    expect(quiet).toContain("Low stock: none");
  });

  it("omits the below-zero section entirely when there is nothing below zero", () => {
    const quiet = buildWeeklyDigestText({
      date: "2026-09-14",
      outstanding: [],
      lowStock: [],
      negative: [],
      overdue: [],
      sectionLimit: 15,
    });
    expect(quiet).not.toContain("Reading below zero");
  });

  it("truncates a long section with an honest count of what it dropped", () => {
    const many = buildWeeklyDigestText({
      date: "2026-09-14",
      outstanding: Array.from({ length: 20 }, (_, i) => ({
        name: `Part ${i}`,
        qtyOut: 1,
        unit: "pcs",
      })),
      lowStock: [],
      negative: [],
      overdue: [],
      sectionLimit: 3,
    });
    expect(many).toContain("Out of the store (20):");
    expect(many).toContain("- and 17 more");
  });

  it("carries no emoji", () => {
    expect(EMOJI.test(full)).toBe(false);
  });

  it("stays well inside Telegram's 4096-character message limit", () => {
    const many = buildWeeklyDigestText({
      date: "2026-09-14",
      outstanding: Array.from({ length: 500 }, (_, i) => ({
        name: `Part ${i}`,
        qtyOut: 1,
        unit: "pcs",
      })),
      lowStock: Array.from({ length: 500 }, (_, i) => ({
        name: `Low ${i}`,
        qtyInStore: 0,
        minStock: 5,
        unit: "pcs",
      })),
      negative: [],
      overdue: [],
      sectionLimit: 15,
    });
    expect(many.length).toBeLessThan(4096);
  });
});

// ---------------------------------------------------------------------------
// The digest has to FIT. `sectionLimit` bounds the number of lines, not their
// length: four sections of 15 real-length part names pass Telegram's 4096
// characters, the send 400s, sendMessageSafely swallows it, and the cron
// still reports the digest as sent -- so it stops arriving and nothing looks
// wrong. buildWeeklyDigestMessages is what makes that impossible.
// ---------------------------------------------------------------------------

const LONG_NAME = "DJI M3508 P19 brushless motor with C620 electronic speed controller";

function hugeDigestParams(sectionLimit = 15) {
  return {
    date: "2026-09-14",
    outstanding: Array.from({ length: 40 }, (_, i) => ({
      name: `${LONG_NAME} rev ${i}`,
      qtyOut: 2,
      unit: "pcs",
    })),
    lowStock: Array.from({ length: 40 }, (_, i) => ({
      name: `${LONG_NAME} spare ${i}`,
      qtyInStore: 1,
      minStock: 10,
      unit: "pcs",
    })),
    negative: Array.from({ length: 40 }, (_, i) => ({
      name: `${LONG_NAME} variant ${i}`,
      qtyInStore: -3,
      unit: "pcs",
    })),
    overdue: Array.from({ length: 40 }, (_, i) => ({
      memberName: `Member With A Fairly Long Name ${i}`,
      productName: `${LONG_NAME} unit ${i}`,
      qty: 1,
      unit: "pcs",
      daysOut: 30 + i,
    })),
    sectionLimit,
  };
}

describe("buildWeeklyDigestMessages", () => {
  it("proves the single-string builder really can overflow", () => {
    // The bug, stated as a test: this is what used to be handed to Telegram.
    expect(buildWeeklyDigestText(hugeDigestParams()).length).toBeGreaterThan(
      TELEGRAM_MESSAGE_LIMIT,
    );
  });

  it("keeps every message inside Telegram's limit", () => {
    const messages = buildWeeklyDigestMessages(hugeDigestParams());
    expect(messages.length).toBeGreaterThan(1);
    for (const message of messages) {
      expect(message.length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    }
  });

  it("numbers the parts and dates every one of them", () => {
    const messages = buildWeeklyDigestMessages(hugeDigestParams());
    messages.forEach((message, index) => {
      expect(message).toContain(
        `Weekly inventory digest — 2026-09-14 (${index + 1}/${messages.length})`,
      );
    });
  });

  it("sends the ordinary digest as exactly one unnumbered message", () => {
    const messages = buildWeeklyDigestMessages({
      date: "2026-09-14",
      outstanding: [{ name: "M3508", qtyOut: 2, unit: "pcs" }],
      lowStock: [{ name: "XT60 male", qtyInStore: 4, minStock: 10, unit: "pcs" }],
      negative: [],
      overdue: [],
      sectionLimit: 15,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toBe(
      buildWeeklyDigestText({
        date: "2026-09-14",
        outstanding: [{ name: "M3508", qtyOut: 2, unit: "pcs" }],
        lowStock: [{ name: "XT60 male", qtyInStore: 4, minStock: 10, unit: "pcs" }],
        negative: [],
        overdue: [],
        sectionLimit: 15,
      }),
    );
  });

  it("still sends the quiet digest -- that is how the club knows the job runs", () => {
    const messages = buildWeeklyDigestMessages({
      date: "2026-09-14",
      outstanding: [],
      lowStock: [],
      negative: [],
      overdue: [],
      sectionLimit: 15,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain("Out of the store: none");
  });

  it("shrinks a single oversized section rather than dropping it, and says how much", () => {
    // One section, far too big for any message on its own: it must come back
    // truncated with an honest count, not silently cut or omitted.
    const messages = buildWeeklyDigestMessages({
      date: "2026-09-14",
      outstanding: Array.from({ length: 100 }, (_, i) => ({
        name: `${LONG_NAME} rev ${i}`,
        qtyOut: 2,
        unit: "pcs",
      })),
      lowStock: [],
      negative: [],
      overdue: [],
      // No per-section cap worth speaking of: the message limit is the only
      // thing standing between this and a 400 from Telegram.
      sectionLimit: 500,
    });
    expect(messages).toHaveLength(1);
    expect(messages[0].length).toBeLessThanOrEqual(TELEGRAM_MESSAGE_LIMIT);
    expect(messages[0]).toContain("Out of the store (100):");
    expect(messages[0]).toMatch(/- and \d+ more/);
  });

  it("carries no emoji, in any part", () => {
    for (const message of buildWeeklyDigestMessages(hugeDigestParams())) {
      expect(EMOJI.test(message)).toBe(false);
    }
  });
});
