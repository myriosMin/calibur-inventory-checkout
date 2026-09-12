import { describe, expect, it } from "vitest";

import {
  cartReducer,
  initialCartState,
  mintClientToken,
  type CartProduct,
} from "@/app/store/components/cartReducer";

const RESISTOR: CartProduct = {
  id: "prod-resistor-10k",
  name: "Resistor 10kΩ 0402",
  tier: "bulk",
  unit: "pcs",
};

const GM6020: CartProduct = {
  id: "prod-gm6020",
  name: "GM6020",
  tier: "asset",
  unit: "unit",
};

const HEAT_SHRINK: CartProduct = {
  id: "prod-heat-shrink",
  name: "Heat shrink assorted",
  tier: "loose",
  unit: "lot",
};

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("cartReducer", () => {
  it("starts with a null destination and an empty cart", () => {
    const state = initialCartState();
    expect(state.destHolderId).toBeNull();
    expect(state.lines.size).toBe(0);
    expect(state.mode).toBe("borrow");
  });

  it("adds a new line for a product not already in the cart", () => {
    const state = cartReducer(initialCartState(), {
      type: "ADD_ITEM",
      product: RESISTOR,
      qty: 10,
      scanCode: "abc123",
      entryMethod: "scan",
    });
    expect(state.lines.size).toBe(1);
    expect(state.lines.get(RESISTOR.id)).toEqual({
      product: RESISTOR,
      qty: 10,
      scanCode: "abc123",
      entryMethod: "scan",
    });
  });

  it("scanning the same product twice increments the existing line instead of duplicating it", () => {
    let state = initialCartState();
    state = cartReducer(state, {
      type: "ADD_ITEM",
      product: GM6020,
      qty: 1,
      scanCode: "code-1",
      entryMethod: "scan",
    });
    state = cartReducer(state, {
      type: "ADD_ITEM",
      product: GM6020,
      qty: 1,
      scanCode: "code-1",
      entryMethod: "scan",
    });

    expect(state.lines.size).toBe(1);
    expect(state.lines.get(GM6020.id)?.qty).toBe(2);
  });

  it("increments by the newly added quantity, not just by one, for repeated bulk adds", () => {
    let state = initialCartState();
    state = cartReducer(state, {
      type: "ADD_ITEM",
      product: RESISTOR,
      qty: 5,
      entryMethod: "search",
    });
    state = cartReducer(state, {
      type: "ADD_ITEM",
      product: RESISTOR,
      qty: 3,
      entryMethod: "scan",
    });

    expect(state.lines.get(RESISTOR.id)?.qty).toBe(8);
    // The original entryMethod/scanCode (from the first add) is preserved.
    expect(state.lines.get(RESISTOR.id)?.entryMethod).toBe("search");
  });

  it("keeps two different products as two separate lines", () => {
    let state = initialCartState();
    state = cartReducer(state, { type: "ADD_ITEM", product: RESISTOR, qty: 10, entryMethod: "scan" });
    state = cartReducer(state, { type: "ADD_ITEM", product: GM6020, qty: 1, entryMethod: "scan" });
    expect(state.lines.size).toBe(2);
  });

  it("sets the destination exactly once and ignores later SET_DEST actions", () => {
    let state = initialCartState();
    state = cartReducer(state, { type: "SET_DEST", destHolderId: "hero-id", destHolderName: "Hero" });
    expect(state.destHolderId).toBe("hero-id");

    // A second SET_DEST (should never be dispatched by the UI, but the
    // reducer defends against it anyway) must not change the fixed choice.
    state = cartReducer(state, { type: "SET_DEST", destHolderId: "sentry-id", destHolderName: "Sentry" });
    expect(state.destHolderId).toBe("hero-id");
    expect(state.destHolderName).toBe("Hero");
  });

  it("CHANGE_DEST overrides an already-set destination (unlike SET_DEST)", () => {
    let state = initialCartState();
    state = cartReducer(state, { type: "SET_DEST", destHolderId: "hero-id", destHolderName: "Hero" });
    state = cartReducer(state, { type: "CHANGE_DEST", destHolderId: "sentry-id", destHolderName: "Sentry" });
    expect(state.destHolderId).toBe("sentry-id");
    expect(state.destHolderName).toBe("Sentry");
  });

  it("SET_LINE_QTY updates an existing line's quantity", () => {
    let state = initialCartState();
    state = cartReducer(state, { type: "ADD_ITEM", product: RESISTOR, qty: 10, entryMethod: "scan" });
    state = cartReducer(state, { type: "SET_LINE_QTY", productId: RESISTOR.id, qty: 25 });
    expect(state.lines.get(RESISTOR.id)?.qty).toBe(25);
  });

  it("SET_LINE_QTY ignores a qty below 1", () => {
    let state = initialCartState();
    state = cartReducer(state, { type: "ADD_ITEM", product: RESISTOR, qty: 10, entryMethod: "scan" });
    state = cartReducer(state, { type: "SET_LINE_QTY", productId: RESISTOR.id, qty: 0 });
    expect(state.lines.get(RESISTOR.id)?.qty).toBe(10);
  });

  it("REMOVE_LINE drops a line", () => {
    let state = initialCartState();
    state = cartReducer(state, { type: "ADD_ITEM", product: RESISTOR, qty: 10, entryMethod: "scan" });
    state = cartReducer(state, { type: "REMOVE_LINE", productId: RESISTOR.id });
    expect(state.lines.size).toBe(0);
  });

  it("CLEAR resets the whole cart, including the destination", () => {
    let state = initialCartState();
    state = cartReducer(state, { type: "SET_DEST", destHolderId: "hero-id", destHolderName: "Hero" });
    state = cartReducer(state, { type: "ADD_ITEM", product: RESISTOR, qty: 10, entryMethod: "scan" });
    state = cartReducer(state, { type: "CLEAR" });

    expect(state.destHolderId).toBeNull();
    expect(state.lines.size).toBe(0);
  });

  it("does not mutate the previous state object (referential immutability for React)", () => {
    const prev = initialCartState();
    const next = cartReducer(prev, { type: "ADD_ITEM", product: RESISTOR, qty: 1, entryMethod: "scan" });
    expect(next).not.toBe(prev);
    expect(next.lines).not.toBe(prev.lines);
    expect(prev.lines.size).toBe(0);
  });
});

describe("cartReducer -- client idempotency token", () => {
  it("mints a v4 UUID with the cart, and a different one per cart", () => {
    const a = initialCartState();
    const b = initialCartState();
    expect(a.clientToken).toMatch(UUID_V4);
    expect(b.clientToken).toMatch(UUID_V4);
    expect(a.clientToken).not.toBe(b.clientToken);
  });

  it("mintClientToken produces a valid v4 UUID", () => {
    expect(mintClientToken()).toMatch(UUID_V4);
  });

  it("survives every cart mutation -- a retry must re-send the same token", () => {
    const initial = initialCartState();
    const token = initial.clientToken;

    let state = cartReducer(initial, {
      type: "SET_DEST",
      destHolderId: "hero-id",
      destHolderName: "Hero",
    });
    state = cartReducer(state, { type: "ADD_ITEM", product: RESISTOR, qty: 10, entryMethod: "scan" });
    state = cartReducer(state, { type: "ADD_ITEM", product: RESISTOR, qty: 5, entryMethod: "scan" });
    state = cartReducer(state, { type: "SET_LINE_QTY", productId: RESISTOR.id, qty: 3 });
    state = cartReducer(state, { type: "ADD_ITEM", product: GM6020, qty: 1, entryMethod: "search" });
    state = cartReducer(state, { type: "REMOVE_LINE", productId: GM6020.id });
    state = cartReducer(state, {
      type: "CHANGE_DEST",
      destHolderId: "sentry-id",
      destHolderName: "Sentry",
    });

    expect(state.clientToken).toBe(token);
  });

  it("CLEAR mints a fresh token, so the next cart is a genuinely new write", () => {
    const initial = initialCartState();
    const token = initial.clientToken;

    let state = cartReducer(initial, { type: "ADD_ITEM", product: RESISTOR, qty: 2, entryMethod: "scan" });
    state = cartReducer(state, { type: "CLEAR" });

    expect(state.clientToken).toMatch(UUID_V4);
    expect(state.clientToken).not.toBe(token);
  });
});

describe("cartReducer -- 'took the last of it' (loose tier)", () => {
  it("does not set tookLast for an ordinary add", () => {
    let state = initialCartState();
    state = cartReducer(state, { type: "ADD_ITEM", product: HEAT_SHRINK, qty: 1, entryMethod: "scan" });
    expect(state.lines.get(HEAT_SHRINK.id)?.tookLast).toBeUndefined();
  });

  it("carries tookLast onto the line", () => {
    let state = initialCartState();
    state = cartReducer(state, {
      type: "ADD_ITEM",
      product: HEAT_SHRINK,
      qty: 1,
      entryMethod: "scan",
      tookLast: true,
    });
    expect(state.lines.get(HEAT_SHRINK.id)?.tookLast).toBe(true);
  });

  it("is sticky across a later plain add to the same line", () => {
    let state = initialCartState();
    state = cartReducer(state, {
      type: "ADD_ITEM",
      product: HEAT_SHRINK,
      qty: 1,
      entryMethod: "scan",
      tookLast: true,
    });
    state = cartReducer(state, { type: "ADD_ITEM", product: HEAT_SHRINK, qty: 1, entryMethod: "scan" });

    const line = state.lines.get(HEAT_SHRINK.id);
    expect(line?.qty).toBe(2);
    expect(line?.tookLast).toBe(true);
  });

  it("can be raised by a later add to an existing plain line", () => {
    let state = initialCartState();
    state = cartReducer(state, { type: "ADD_ITEM", product: HEAT_SHRINK, qty: 1, entryMethod: "scan" });
    state = cartReducer(state, {
      type: "ADD_ITEM",
      product: HEAT_SHRINK,
      qty: 1,
      entryMethod: "scan",
      tookLast: true,
    });
    expect(state.lines.get(HEAT_SHRINK.id)?.tookLast).toBe(true);
  });
});
