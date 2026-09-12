import { describe, expect, it } from "vitest";

import {
  daysBetween,
  dueForNudge,
  outstandingLots,
  selectOverdue,
  shouldNudge,
  type LedgerRow,
} from "@/lib/reports/overdue";

const STORE = "holder-store";
const ALEX = "holder-alex";
const PRIYA = "holder-priya";
const HERO = "holder-hero";
const GM6020 = "product-gm6020";
const M3508 = "product-m3508";

function borrow(
  productId: string,
  toHolderId: string,
  qty: number,
  createdAt: string,
  fromHolderId = STORE,
): LedgerRow {
  return { productId, fromHolderId, toHolderId, qty, createdAt };
}

describe("outstandingLots", () => {
  it("returns one lot per un-returned borrow, dated from the borrow", () => {
    const lots = outstandingLots(
      [borrow(GM6020, ALEX, 1, "2026-08-01T00:00:00Z")],
      [ALEX],
    );
    expect(lots).toEqual([
      { productId: GM6020, holderId: ALEX, qty: 1, since: "2026-08-01T00:00:00Z" },
    ]);
  });

  it("ignores holders outside the allow-list", () => {
    const lots = outstandingLots(
      [borrow(GM6020, HERO, 4, "2026-08-01T00:00:00Z"), borrow(M3508, ALEX, 1, "2026-08-02T00:00:00Z")],
      [ALEX],
    );
    expect(lots).toHaveLength(1);
    expect(lots[0].holderId).toBe(ALEX);
  });

  it("keeps two borrows of the same product as two separately dated lots", () => {
    const lots = outstandingLots(
      [
        borrow(GM6020, ALEX, 1, "2026-01-10T00:00:00Z"),
        borrow(GM6020, ALEX, 1, "2026-09-01T00:00:00Z"),
      ],
      [ALEX],
    );
    expect(lots.map((lot) => lot.since)).toEqual([
      "2026-01-10T00:00:00Z",
      "2026-09-01T00:00:00Z",
    ]);
  });

  it("consumes the OLDEST lot first on a return", () => {
    const lots = outstandingLots(
      [
        borrow(GM6020, ALEX, 1, "2026-01-10T00:00:00Z"),
        borrow(GM6020, ALEX, 1, "2026-09-01T00:00:00Z"),
        // Returns one of the two.
        borrow(GM6020, STORE, 1, "2026-09-05T00:00:00Z", ALEX),
      ],
      [ALEX],
    );
    expect(lots).toEqual([
      { productId: GM6020, holderId: ALEX, qty: 1, since: "2026-09-01T00:00:00Z" },
    ]);
  });

  it("splits a partial return out of a single lot, keeping its original date", () => {
    const lots = outstandingLots(
      [
        borrow(M3508, ALEX, 5, "2026-08-01T00:00:00Z"),
        borrow(M3508, STORE, 2, "2026-08-20T00:00:00Z", ALEX),
      ],
      [ALEX],
    );
    expect(lots).toEqual([
      { productId: M3508, holderId: ALEX, qty: 3, since: "2026-08-01T00:00:00Z" },
    ]);
  });

  it("drains to nothing when everything is returned", () => {
    expect(
      outstandingLots(
        [
          borrow(GM6020, ALEX, 2, "2026-08-01T00:00:00Z"),
          borrow(GM6020, STORE, 2, "2026-08-02T00:00:00Z", ALEX),
        ],
        [ALEX],
      ),
    ).toEqual([]);
  });

  it("nets out a borrow and a return sharing one timestamp (a single cart)", () => {
    // Same `created_at` is normal: submit_cart writes a whole cart in one
    // transaction. The outbound leg has to be applied first or a phantom lot
    // survives.
    expect(
      outstandingLots(
        [
          borrow(GM6020, ALEX, 1, "2026-08-01T00:00:00Z"),
          borrow(GM6020, STORE, 1, "2026-08-01T00:00:00Z", ALEX),
        ],
        [ALEX],
      ),
    ).toEqual([]);
  });

  it("never produces a negative lot when more went out than came in", () => {
    // Possible for real: borrows are not blocked on insufficient stock.
    expect(
      outstandingLots([borrow(GM6020, STORE, 3, "2026-08-01T00:00:00Z", ALEX)], [ALEX]),
    ).toEqual([]);
  });

  it("keeps different holders' lots apart", () => {
    const lots = outstandingLots(
      [
        borrow(GM6020, ALEX, 1, "2026-08-01T00:00:00Z"),
        borrow(GM6020, PRIYA, 2, "2026-08-02T00:00:00Z"),
      ],
      [ALEX, PRIYA],
    );
    expect(lots).toHaveLength(2);
    expect(lots.find((lot) => lot.holderId === PRIYA)?.qty).toBe(2);
  });

  it("is insensitive to the order rows arrive in", () => {
    const rows = [
      borrow(GM6020, STORE, 1, "2026-09-05T00:00:00Z", ALEX),
      borrow(GM6020, ALEX, 1, "2026-09-01T00:00:00Z"),
      borrow(GM6020, ALEX, 1, "2026-01-10T00:00:00Z"),
    ];
    expect(outstandingLots(rows, [ALEX])).toEqual([
      { productId: GM6020, holderId: ALEX, qty: 1, since: "2026-09-01T00:00:00Z" },
    ]);
  });
});

describe("daysBetween", () => {
  it("floors partial days", () => {
    expect(daysBetween("2026-09-01T00:00:00Z", new Date("2026-09-02T23:59:00Z"))).toBe(1);
  });

  it("returns 0 rather than NaN for an unparseable timestamp", () => {
    expect(daysBetween("not-a-date", new Date("2026-09-02T00:00:00Z"))).toBe(0);
  });
});

describe("selectOverdue (threshold boundary)", () => {
  const lots = [
    { productId: GM6020, holderId: ALEX, qty: 1, since: "2026-09-01T00:00:00Z" },
  ];

  it("is NOT overdue one day short of the threshold", () => {
    // 20 days out, threshold 21.
    expect(selectOverdue(lots, new Date("2026-09-21T00:00:00Z"), 21)).toEqual([]);
  });

  it("IS overdue exactly on the threshold day", () => {
    const overdue = selectOverdue(lots, new Date("2026-09-22T00:00:00Z"), 21);
    expect(overdue).toHaveLength(1);
    expect(overdue[0].daysOut).toBe(21);
  });

  it("stays overdue past the threshold, longest first", () => {
    const overdue = selectOverdue(
      [
        { productId: GM6020, holderId: ALEX, qty: 1, since: "2026-09-01T00:00:00Z" },
        { productId: M3508, holderId: ALEX, qty: 1, since: "2026-06-01T00:00:00Z" },
      ],
      new Date("2026-10-01T00:00:00Z"),
      21,
    );
    expect(overdue.map((lot) => lot.productId)).toEqual([M3508, GM6020]);
  });
});

describe("shouldNudge (suppression window, no stored state)", () => {
  it("says nothing before the threshold", () => {
    expect(shouldNudge(20, 21, 7)).toBe(false);
    expect(shouldNudge(0, 21, 7)).toBe(false);
  });

  it("fires on the threshold day", () => {
    expect(shouldNudge(21, 21, 7)).toBe(true);
  });

  it("stays quiet on the six days after a nudge", () => {
    for (let day = 22; day <= 27; day++) {
      expect(shouldNudge(day, 21, 7), `day ${day}`).toBe(false);
    }
  });

  it("re-nudges exactly one cadence later, and again after that", () => {
    expect(shouldNudge(28, 21, 7)).toBe(true);
    expect(shouldNudge(35, 21, 7)).toBe(true);
    expect(shouldNudge(42, 21, 7)).toBe(true);
  });

  it("degenerates to a single one-off nudge when the cadence is zero", () => {
    expect(shouldNudge(21, 21, 0)).toBe(true);
    expect(shouldNudge(22, 21, 0)).toBe(false);
    expect(shouldNudge(28, 21, 0)).toBe(false);
  });
});

describe("dueForNudge", () => {
  it("keeps only the lots whose age lands on the cadence", () => {
    const now = new Date("2026-10-01T00:00:00Z");
    const lots = [
      // 30 days out -> overdue, but not a nudge day (21 + 9).
      { productId: GM6020, holderId: ALEX, qty: 1, since: "2026-09-01T00:00:00Z" },
      // 28 days out -> 21 + 7, a nudge day.
      { productId: M3508, holderId: ALEX, qty: 1, since: "2026-09-03T00:00:00Z" },
    ];
    const due = dueForNudge(selectOverdue(lots, now, 21), 21, 7);
    expect(due.map((lot) => lot.productId)).toEqual([M3508]);
  });
});
