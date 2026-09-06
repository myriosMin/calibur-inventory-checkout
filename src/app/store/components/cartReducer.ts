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
}

export interface CartLine {
  product: CartProduct;
  qty: number;
  scanCode?: string;
  entryMethod: EntryMethod;
}

export interface CartState {
  mode: "borrow";
  destHolderId: string | null;
  destHolderName: string | null;
  /** Keyed by productId so duplicate adds can be found in O(1). */
  lines: Map<string, CartLine>;
}

export type CartAction =
  | {
      type: "ADD_ITEM";
      product: CartProduct;
      qty: number;
      scanCode?: string;
      entryMethod: EntryMethod;
    }
  | { type: "SET_DEST"; destHolderId: string; destHolderName: string }
  | { type: "SET_LINE_QTY"; productId: string; qty: number }
  | { type: "REMOVE_LINE"; productId: string }
  | { type: "CLEAR" };

export function initialCartState(): CartState {
  return {
    mode: "borrow",
    destHolderId: null,
    destHolderName: null,
    lines: new Map(),
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
        lines.set(action.product.id, { ...existing, qty: existing.qty + action.qty });
      } else {
        lines.set(action.product.id, {
          product: action.product,
          qty: action.qty,
          scanCode: action.scanCode,
          entryMethod: action.entryMethod,
        });
      }
      return { ...state, lines };
    }
    case "SET_DEST": {
      if (state.destHolderId !== null) return state; // fixed for the session, never re-asked
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
