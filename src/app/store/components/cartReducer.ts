/**
 * Pure cart-state reducer for the borrow flow (docs/tele-qr/flows.md §2).
 *
 * Deliberately factored out of `borrow/page.tsx` so the increment-on-
 * duplicate-scan behaviour (WP16's DoD: "scanning the same code twice
 * results in one cart line with qty incremented") can be exercised by a
 * plain unit test rather than only by manual click-through.
 *
 * This is client-side cart *state* only. It does not talk to the network;
 * the server-side `submit_cart` RPC does NOT merge duplicate `productId`
 * lines itself (see WP14's DoD) -- that merging is this reducer's job.
 */

export type EntryMethod = "scan" | "group_pick" | "search";

/** Product shape shared with SearchSheet's SearchProduct and the /api/store/resolve
 * response -- a superset covering every field either caller might supply. */
export interface CartProduct {
  id: string;
  name: string;
  tier: "asset" | "bulk" | "loose";
  unit: string;
  category?: string | null;
  spec?: Record<string, unknown> | null;
  returnable?: boolean;
  /** products.expensive (0028): S$20+ or critical. Always a borrow, never consumed. */
  expensive?: boolean | null;
}

export interface CartLine {
  product: CartProduct;
  qty: number;
  scanCode?: string;
  entryMethod: EntryMethod;
  /**
   * `loose`-tier only: the member tapped "Took the last of it" rather than
   * "Took some" (docs/tele-qr/flows.md §4 -- "loose items never get an exact
   * count; 'took the last of it' sets the level to empty and raises a
   * restock flag"). Both still submit qty=1; this is the level signal, which
   * a count cannot carry.
   */
  tookLast?: boolean;
}

export interface CartState {
  mode: "borrow";
  destHolderId: string | null;
  destHolderName: string | null;
  /** Keyed by productId so duplicate adds can be found in O(1). */
  lines: Map<string, CartLine>;
  /**
   * Idempotency key for this cart, minted once when the cart is created and
   * reused by every submit attempt until the cart is cleared.
   *
   * It lives in cart state, not in the submit function, precisely because a
   * token minted per `fetch` would buy nothing: the case it exists for is a
   * request that timed out on the wire but committed server-side, whose
   * retry must carry the SAME token so `submit_cart` recognises the replay
   * (supabase/migrations/0019_submit_cart_idempotent.sql) and returns the
   * original session instead of writing every movement twice. CLEAR mints a
   * fresh one, so the next cart is a genuinely new write.
   */
  clientToken: string;
}

export type CartAction =
  | {
      type: "ADD_ITEM";
      product: CartProduct;
      qty: number;
      scanCode?: string;
      entryMethod: EntryMethod;
      tookLast?: boolean;
    }
  | { type: "SET_DEST"; destHolderId: string; destHolderName: string }
  /** Explicit member-initiated override of an already-set destination (the
   * "Change" link in Cart, shown when the destination was auto-filled from a
   * remembered last choice). Unlike SET_DEST, this always applies -- SET_DEST
   * stays a one-shot guard for the auto-fill-on-first-item path. */
  | { type: "CHANGE_DEST"; destHolderId: string; destHolderName: string }
  | { type: "SET_LINE_QTY"; productId: string; qty: number }
  | { type: "REMOVE_LINE"; productId: string }
  | { type: "CLEAR" };

/**
 * A RFC-4122 v4 UUID, which is what `sessions.client_token` is typed as and
 * what the submit route's zod schema validates.
 *
 * `crypto.randomUUID()` is the whole story inside Telegram (an HTTPS secure
 * context) and under Node during SSR; the `getRandomValues` branch covers
 * the older WebViews where `randomUUID` is missing but WebCrypto is not.
 * There is deliberately no Math.random fallback: `sessions.client_token` is
 * globally unique, so a weak token that collided with another member's would
 * hand them back someone else's session id -- failing loudly at cart
 * creation is far better than that.
 */
export function mintClientToken(): string {
  const webCrypto = globalThis.crypto;
  if (webCrypto?.randomUUID) return webCrypto.randomUUID();

  if (webCrypto?.getRandomValues) {
    const bytes = webCrypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
    bytes[8] = (bytes[8] & 0x3f) | 0x80; // variant 10x
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return [
      hex.slice(0, 8),
      hex.slice(8, 12),
      hex.slice(12, 16),
      hex.slice(16, 20),
      hex.slice(20),
    ].join("-");
  }

  throw new Error("No WebCrypto available to mint a cart idempotency token.");
}

export function initialCartState(): CartState {
  return {
    mode: "borrow",
    destHolderId: null,
    destHolderName: null,
    lines: new Map(),
    clientToken: mintClientToken(),
  };
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case "ADD_ITEM": {
      const lines = new Map(state.lines);
      const existing = lines.get(action.product.id);
      if (existing) {
        // Same product scanned/searched/picked again: increment the
        // existing line in place rather than creating a duplicate --
        // "maps onto the physical act of grabbing another one" (flows.md).
        // The original entryMethod/scanCode (from the first add) is kept,
        // since that's what identified the line for diagnostics.
        // `tookLast` is sticky rather than last-write-wins: "took some, then
        // came back and took the last of it" is one cart line that ends
        // empty, and a later plain "took some" must not un-say it.
        lines.set(action.product.id, {
          ...existing,
          qty: existing.qty + action.qty,
          tookLast: existing.tookLast || action.tookLast || undefined,
        });
      } else {
        lines.set(action.product.id, {
          product: action.product,
          qty: action.qty,
          scanCode: action.scanCode,
          entryMethod: action.entryMethod,
          tookLast: action.tookLast || undefined,
        });
      }
      return { ...state, lines };
    }
    case "SET_DEST": {
      if (state.destHolderId !== null) return state; // fixed for the session, never re-asked
      return { ...state, destHolderId: action.destHolderId, destHolderName: action.destHolderName };
    }
    case "CHANGE_DEST": {
      return { ...state, destHolderId: action.destHolderId, destHolderName: action.destHolderName };
    }
    case "SET_LINE_QTY": {
      const lines = new Map(state.lines);
      const existing = lines.get(action.productId);
      if (!existing || action.qty < 1) return state;
      lines.set(action.productId, { ...existing, qty: action.qty });
      return { ...state, lines };
    }
    case "REMOVE_LINE": {
      const lines = new Map(state.lines);
      lines.delete(action.productId);
      return { ...state, lines };
    }
    case "CLEAR":
      return initialCartState();
    default:
      return state;
  }
}
