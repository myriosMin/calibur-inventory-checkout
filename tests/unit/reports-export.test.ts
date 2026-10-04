import { describe, expect, it } from "vitest";

import { parseCsv } from "@/lib/csv/parse";
import {
  buildCatalogCsv,
  buildHoldingsCsv,
  buildMovementsCsv,
  CATALOG_CSV_HEADER,
  exportFilename,
  HOLDINGS_CSV_HEADER,
  MOVEMENTS_CSV_HEADER,
} from "@/lib/reports/export";

describe("buildCatalogCsv", () => {
  const csv = buildCatalogCsv([
    {
      id: "p1",
      name: 'Resistor 10kΩ, 0603 "thin film"',
      tier: "bulk",
      category: "SMD",
      unit: "pcs",
      partNumber: null,
      locationName: "Resistor book",
      minStock: 50,
      returnable: false,
      active: true,
      qtyInStore: 129,
      qtyOut: 1,
      code: "A3F9K2",
    },
  ]);

  it("leads with the documented header", () => {
    expect(csv.split("\n")[0]).toBe(CATALOG_CSV_HEADER.join(","));
  });

  it("survives a round trip through the repo's own CSV parser", () => {
    // Quotes and a comma in a product name is not hypothetical -- the real
    // 538-row catalog is full of them.
    const rows = parseCsv(csv);
    expect(rows[1][1]).toBe('Resistor 10kΩ, 0603 "thin film"');
    expect(rows[1][7]).toBe("50");
  });

  it("writes booleans as yes/no and nulls as empty, not 'null'", () => {
    const rows = parseCsv(csv);
    expect(rows[1][5]).toBe(""); // part_number
    expect(rows[1][8]).toBe("no"); // returnable
    expect(rows[1][9]).toBe("yes"); // active
  });

  it("ends with a newline", () => {
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("emits a header-only file for an empty catalog", () => {
    expect(buildCatalogCsv([])).toBe(`${CATALOG_CSV_HEADER.join(",")}\n`);
  });
});

describe("buildHoldingsCsv", () => {
  it("round-trips holder, product and quantity", () => {
    const csv = buildHoldingsCsv([
      {
        holderKind: "robot",
        holderName: "DarkNUS",
        productId: "p1",
        productName: "M3508",
        qty: 2,
        unit: "pcs",
        expensive: true,
      },
    ]);
    const rows = parseCsv(csv);
    expect(rows[0]).toEqual([...HOLDINGS_CSV_HEADER]);
    expect(rows[1]).toEqual(["robot", "DarkNUS", "p1", "M3508", "2", "pcs", "yes"]);
  });

  it("keeps a negative holding as a negative number", () => {
    // Negative balances are real data (a missing opening balance) and the
    // export is a backup, not a report -- it must not launder them.
    const rows = parseCsv(
      buildHoldingsCsv([
        {
          holderKind: "store",
          holderName: "Store",
          productId: "p1",
          productName: "Resistor",
          qty: -4,
          unit: "pcs",
        },
      ]),
    );
    expect(rows[1][4]).toBe("-4");
  });
});

describe("buildMovementsCsv", () => {
  const csv = buildMovementsCsv([
    {
      id: 183,
      createdAt: "2026-09-07T09:47:20.456447+00:00",
      productId: "p1",
      productName: "M3508",
      qty: 1,
      unit: "pcs",
      fromHolderName: "Engineer",
      toHolderName: "Store",
      reason: "return",
      entryMethod: "search",
      scanCode: null,
      actorName: "Alex",
      sessionId: "s1",
    },
  ]);

  it("leads with the documented header", () => {
    expect(parseCsv(csv)[0]).toEqual([...MOVEMENTS_CSV_HEADER]);
  });

  it("keeps the ledger row id, so an export can be reconciled against the DB", () => {
    expect(parseCsv(csv)[1][0]).toBe("183");
  });

  it("writes a null scan_code as empty", () => {
    expect(parseCsv(csv)[1][10]).toBe("");
  });
});

describe("exportFilename", () => {
  it("dates the file so successive backups do not overwrite", () => {
    expect(exportFilename("catalog", "2026-09-12")).toBe("calibur-catalog-2026-09-12.csv");
    expect(exportFilename("movements", "2026-09-12")).toBe("calibur-movements-2026-09-12.csv");
  });
});
