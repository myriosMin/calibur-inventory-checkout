import { describe, expect, it } from "vitest";

import { createRequestSequencer } from "@/lib/utils/latest-request";

// /admin/movements refetches on every filter change, and its effect's
// `cancelled` flag only fires on teardown -- it cannot stop an in-flight
// request that a newer one has already superseded. Two quick filter changes
// could therefore paint the FIRST query's rows after the second's, showing a
// stale ledger under a fresh filter.

describe("createRequestSequencer", () => {
  it("treats the only in-flight request as current", () => {
    const seq = createRequestSequencer();
    const ticket = seq.start();
    expect(seq.isCurrent(ticket)).toBe(true);
  });

  it("drops a response whose request has been superseded", () => {
    const seq = createRequestSequencer();
    const first = seq.start();
    const second = seq.start();

    // The slow first response comes back last -- and must be ignored.
    expect(seq.isCurrent(first)).toBe(false);
    expect(seq.isCurrent(second)).toBe(true);
  });

  it("survives a burst of filter changes, keeping only the last", () => {
    const seq = createRequestSequencer();
    const tickets = [seq.start(), seq.start(), seq.start(), seq.start()];
    expect(tickets.map((t) => seq.isCurrent(t))).toEqual([false, false, false, true]);
  });

  it("gives each sequencer its own counter", () => {
    const a = createRequestSequencer();
    const b = createRequestSequencer();
    const ticketA = a.start();
    b.start();
    b.start();
    expect(a.isCurrent(ticketA)).toBe(true);
  });
});
