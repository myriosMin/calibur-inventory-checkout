import { describe, expect, it } from "vitest";

import {
  buildReturnLines,
  buildReturnSubmitBody,
} from "@/app/store/return/submit";

// The return walk does not go through cartReducer -- it has its own Stage
// machine -- and that is exactly how it shipped WITHOUT the cart's
// idempotency token: `submit_cart`'s dedup never applied to returns, so a
// request that timed out but committed wrote every return movement twice
// when the member tapped the page's own Retry.

describe("buildReturnLines", () => {
  it("keeps only the rows the member actually gave a quantity", () => {
    expect(buildReturnLines({ "p-1": 2, "p-2": 0, "p-3": 1 })).toEqual([
      { productId: "p-1", qty: 2, entryMethod: "search" },
      { productId: "p-3", qty: 1, entryMethod: "search" },
    ]);
  });

  it("has nothing to submit when nothing was ticked", () => {
    expect(buildReturnLines({ "p-1": 0 })).toEqual([]);
    expect(buildReturnLines({})).toEqual([]);
  });
});

describe("buildReturnSubmitBody", () => {
  const quantities = { "p-1": 1 };

  it("sends the walk's idempotency token so submit_cart can dedup a retry", () => {
    const body = buildReturnSubmitBody({
      sourceHolderId: "h-robot",
      quantities,
      clientToken: "11111111-2222-4333-8444-555555555555",
    });

    expect(body).toEqual({
      mode: "return",
      sourceHolderId: "h-robot",
      clientToken: "11111111-2222-4333-8444-555555555555",
      lines: [{ productId: "p-1", qty: 1, entryMethod: "search" }],
    });
  });

  it("re-sends the SAME token on a retry -- that is the whole mechanism", () => {
    const token = "11111111-2222-4333-8444-555555555555";
    const first = buildReturnSubmitBody({ sourceHolderId: "h", quantities, clientToken: token });
    const retry = buildReturnSubmitBody({ sourceHolderId: "h", quantities, clientToken: token });
    expect(retry.clientToken).toBe(first.clientToken);
  });

  it("omits the key entirely rather than sending null (the route's schema is strict)", () => {
    const body = buildReturnSubmitBody({
      sourceHolderId: "h",
      quantities,
      clientToken: null,
    });
    expect("clientToken" in body).toBe(false);
  });
});
