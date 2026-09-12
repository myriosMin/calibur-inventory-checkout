/**
 * "Is this response still the one we want?" — a sequence number for
 * overlapping async reads.
 *
 * The `let cancelled = false` cleanup used across /admin is the wrong tool
 * for a page that refetches on every filter change: the flag only fires when
 * the effect is torn down, and it cannot stop an in-flight request that a
 * NEWER request has already superseded. Change a filter twice quickly and the
 * two queries race — if the first resolves last, the page renders stale rows
 * over fresh ones, with the filter controls showing the newer filter. That is
 * a wrong ledger presented as a right one.
 *
 * Usage, in a component:
 *
 *   const seq = useRef(createRequestSequencer());
 *   const mine = seq.current.start();
 *   const { data } = await query;
 *   if (!seq.current.isCurrent(mine)) return;   // superseded; drop it
 *
 * A plain counter rather than AbortController on purpose: supabase-js has no
 * abort signal on a query builder, and "ignore the answer" is the part that
 * matters for correctness.
 */
export interface RequestSequencer {
  /** Claim the next ticket. Every request that can render must call this. */
  start(): number;
  /** True only for the most recently started request. */
  isCurrent(ticket: number): boolean;
}

export function createRequestSequencer(): RequestSequencer {
  let latest = 0;
  return {
    start() {
      latest += 1;
      return latest;
    },
    isCurrent(ticket: number) {
      return ticket === latest;
    },
  };
}
