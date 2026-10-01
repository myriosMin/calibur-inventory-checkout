import { describe, expect, it } from "vitest";

import { fetchScanCodes, fetchStockLevels, type ReportClient } from "@/lib/reports/queries";

// The bug this guards: report reads used to ask for `.limit(20000)`, but
// PostgREST clamps every limit to the project's max_rows (1000) and says
// nothing. `holdings` passed 1000 rows in production, so the page showed a
// confident, wrong balance sheet. Every report read now pages until a short
// page comes back.

/**
 * A stand-in for the PostgREST builder: every chained call returns itself,
 * and `.range(from, to)` resolves to that slice of `rows`, capped at
 * `maxRows` exactly like the real server.
 */
function stubClient(rows: Record<string, unknown>[], maxRows = 1000) {
  const ranges: [number, number][] = [];
  const orders: string[] = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "gte", "or", "is", "in"]) {
    builder[method] = () => builder;
  }
  builder.order = (column: string) => {
    orders.push(column);
    return builder;
  };
  builder.range = (from: number, to: number) => {
    ranges.push([from, to]);
    const end = Math.min(to + 1, from + maxRows);
    return Promise.resolve({ data: rows.slice(from, end), error: null });
  };
  const client = { from: () => builder } as unknown as ReportClient;
  return { client, ranges, orders };
}

describe("report reads page past PostgREST's max_rows", () => {
  it("returns every row when the table is bigger than one page", async () => {
    const rows = Array.from({ length: 2345 }, (_, i) => ({
      product_id: `p${i}`,
      name: `Part ${i}`,
      tier: "bulk",
      unit: "pcs",
      min_stock: null,
      qty_in_store: i,
      qty_out: 0,
    }));
    const { client, ranges } = stubClient(rows);

    const levels = await fetchStockLevels(client);

    expect(levels).toHaveLength(2345);
    expect(ranges).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("orders on a unique key so pages cannot skip or repeat rows", async () => {
    const { client, orders } = stubClient([{ code: "ABC123", kind: "product", product_id: "p", location_id: null, active: true }]);
    await fetchScanCodes(client);
    expect(orders).toContain("code");
  });

  it("names the read that failed", async () => {
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "order"]) builder[method] = () => builder;
    builder.range = () => Promise.resolve({ data: null, error: { message: "permission denied" } });
    const client = { from: () => builder } as unknown as ReportClient;

    await expect(fetchScanCodes(client)).rejects.toThrow("scan_codes: permission denied");
  });
});
