import { describe, expect, it } from "vitest";

import { REPLAY_CLOCK_SKEW_MS, isReplayCommit } from "@/lib/server/cart-replay";

// `submit_cart` returns the original session id on an idempotent replay and
// says nothing about it, so the submit route used to send a SECOND Telegram
// receipt for one cart -- the member reads that as a second borrow they did
// not make. The route now compares the session's committed_at against when
// the request started; this is that comparison.

const requestStartedAt = new Date("2026-09-12T10:00:00.000Z");

function iso(offsetMs: number): string {
  return new Date(requestStartedAt.getTime() + offsetMs).toISOString();
}

describe("isReplayCommit", () => {
  it("calls a session committed well before this request a replay", () => {
    expect(isReplayCommit(iso(-60_000), requestStartedAt)).toBe(true);
  });

  it("does not call a session committed by this very request a replay", () => {
    expect(isReplayCommit(iso(+40), requestStartedAt)).toBe(false);
    expect(isReplayCommit(iso(0), requestStartedAt)).toBe(false);
  });

  it("tolerates the DB clock running slightly behind the app server's", () => {
    // Cross-machine comparison: a fresh commit stamped a second early must
    // not cost the member their receipt.
    expect(isReplayCommit(iso(-(REPLAY_CLOCK_SKEW_MS - 1)), requestStartedAt)).toBe(false);
    expect(isReplayCommit(iso(-(REPLAY_CLOCK_SKEW_MS + 1)), requestStartedAt)).toBe(true);
  });

  it("assumes a fresh write when there is nothing to compare", () => {
    // A possibly-duplicate receipt beats silently swallowing a real one.
    expect(isReplayCommit(null, requestStartedAt)).toBe(false);
    expect(isReplayCommit(undefined, requestStartedAt)).toBe(false);
    expect(isReplayCommit("not a timestamp", requestStartedAt)).toBe(false);
  });
});
