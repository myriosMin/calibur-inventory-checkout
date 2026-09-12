/**
 * Pure request-body construction for the return walk (docs/tele-qr/flows.md §3).
 *
 * Factored out of `page.tsx` for the same reason `cartReducer.ts` was
 * factored out of the borrow page: the return flow has its own `Stage` state
 * machine and does NOT go through the cart reducer, so the one piece of the
 * submit contract that is easy to get wrong -- the idempotency token -- has
 * nowhere to be tested unless it lives in a plain function.
 *
 * It was in fact wrong: the cart idempotency work wired `clientToken` into
 * the borrow flow only, so a return that timed out on the wire but committed
 * server-side wrote every movement twice when the member tapped Retry. That
 * is precisely the scenario `submit_cart`'s dedup
 * (supabase/migrations/0019_submit_cart_idempotent.sql) exists to prevent.
 */

export interface ReturnSubmitLine {
  productId: string;
  qty: number;
  /**
   * WP14's `entryMethod` enum ('scan' | 'group_pick' | 'search') has no
   * dedicated value for "tapped a stepper on the return checklist" -- it
   * isn't scan-sourced at all. 'search' is the closest fit: like a
   * search-added line, a checklist line is a member-initiated pick from a
   * browsable list rather than a code resolution. This applies uniformly to
   * both held-item rows and search-fallback extra rows.
   */
  entryMethod: "search";
}

export interface ReturnSubmitBody {
  mode: "return";
  sourceHolderId: string;
  /**
   * The return walk's idempotency key: minted once per walk and re-sent
   * unchanged by every retry, so `submit_cart` recognises the replay and
   * returns the original session instead of writing the movements again.
   * Omitted entirely when the client could not mint one, which restores the
   * pre-0019 behaviour (a NULL token never conflicts) rather than blocking
   * the return.
   */
  clientToken?: string;
  lines: ReturnSubmitLine[];
}

/**
 * Checklist quantities -> submit lines. Zero-qty rows are the untouched ones
 * (every held row starts at 0), so they are dropped rather than sent as
 * no-op movements, which `stock_movements`'s `check (qty > 0)` would reject
 * anyway.
 */
export function buildReturnLines(
  quantities: Readonly<Record<string, number>>,
): ReturnSubmitLine[] {
  return Object.entries(quantities)
    .filter(([, qty]) => qty > 0)
    .map(([productId, qty]) => ({ productId, qty, entryMethod: "search" as const }));
}

export function buildReturnSubmitBody(params: {
  sourceHolderId: string;
  quantities: Readonly<Record<string, number>>;
  clientToken: string | null;
}): ReturnSubmitBody {
  const body: ReturnSubmitBody = {
    mode: "return",
    sourceHolderId: params.sourceHolderId,
    lines: buildReturnLines(params.quantities),
  };
  // Absent rather than null: the route's zod schema is `.strict()` and the
  // field is `.uuid().optional()`, so a null would be a 400 while an absent
  // key is simply "dedup off for this call".
  if (params.clientToken) body.clientToken = params.clientToken;
  return body;
}
