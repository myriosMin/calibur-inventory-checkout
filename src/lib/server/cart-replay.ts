/**
 * "Did this submit actually write anything, or was it a replay?"
 *
 * `submit_cart` (supabase/migrations/0019_submit_cart_idempotent.sql) returns
 * the ORIGINAL session id when a client re-sends a token it has already
 * committed, and deliberately returns nothing else — the client cannot tell a
 * replay from a first write, and must not have to.
 *
 * The route, though, does two best-effort things AFTER the commit that are
 * only correct once per cart: it sends a Telegram receipt, and it records the
 * "took the last of it" empty-level flags. On a replay the receipt would
 * arrive a second time for one cart, which reads to the member as a second
 * borrow they did not make.
 *
 * Rather than change the RPC's signature to report it, the route re-reads the
 * session's `committed_at` (set by the function to `now()` at insert) and
 * compares it to when this request started: a session committed BEFORE this
 * request began cannot have been written by it.
 *
 * Pure so the clock-skew rule below is testable without a database.
 */

/**
 * How far the database clock is allowed to run behind the app server's before
 * a genuinely-new session would be misread as an old one.
 *
 * The comparison is cross-machine (Vercel's clock vs. Postgres's), so it
 * needs slack, and the two failure modes are not symmetric:
 *
 *  - Too little slack: a fresh commit looks like a replay and the member
 *    silently loses their receipt.
 *  - Too much slack: a replay that arrives very quickly is treated as fresh
 *    and sends a duplicate receipt — exactly today's behaviour, i.e. no
 *    regression.
 *
 * So: be generous. The case this exists for is a retry after a request timed
 * out on the wire, which is tens of seconds later, far outside this window.
 */
export const REPLAY_CLOCK_SKEW_MS = 5_000;

export function isReplayCommit(
  committedAt: string | null | undefined,
  requestStartedAt: Date,
  skewMs: number = REPLAY_CLOCK_SKEW_MS,
): boolean {
  // No timestamp to compare (an unexpectedly NULL committed_at, or a session
  // that vanished): assume a fresh write. Sending a receipt that might be a
  // duplicate beats silently swallowing a real one.
  if (!committedAt) return false;
  const committedMs = Date.parse(committedAt);
  if (Number.isNaN(committedMs)) return false;
  return committedMs < requestStartedAt.getTime() - skewMs;
}
