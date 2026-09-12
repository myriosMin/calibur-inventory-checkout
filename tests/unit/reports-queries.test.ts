import { describe, expect, it } from "vitest";

import { REPORT_ROW_LIMIT, truncationNotice } from "@/lib/reports/queries";

// The bug this guards: /admin/holdings and /admin/labels fetched without any
// `.limit()`, so PostgREST capped them at its 1000-row default and said
// nothing. On a stock page that is worse than a slow page -- the balances are
// wrong and look right. Every such read now asks for an explicit limit AND
// tells the admin when it came back at it.

describe("truncationNotice", () => {
  it("says nothing when the result fits", () => {
    expect(truncationNotice("holding lines", 0, 1000)).toBeNull();
    expect(truncationNotice("holding lines", 999, 1000)).toBeNull();
  });

  it("speaks up as soon as the result lands ON the limit", () => {
    // At exactly the limit there is no way to tell "exactly N" from
    // "N and more", so it warns -- one wasted sentence beats hidden stock.
    const notice = truncationNotice("holding lines", 1000, 1000);
    expect(notice).toContain("1000");
    expect(notice).toContain("holding lines");
  });

  it("names what was truncated, so two reads on one page are distinguishable", () => {
    expect(truncationNotice("scan codes", 5, 5)).toContain("scan codes");
    expect(truncationNotice("products", 5, 5)).toContain("products");
  });

  it("defaults to the shared report row limit, not PostgREST's implicit 1000", () => {
    expect(REPORT_ROW_LIMIT).toBeGreaterThan(1000);
    expect(truncationNotice("products", 1000)).toBeNull();
    expect(truncationNotice("products", REPORT_ROW_LIMIT)).not.toBeNull();
  });
});
