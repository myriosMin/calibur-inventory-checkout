import { describe, expect, it } from "vitest";

import {
  summariseByLocation,
  summariseByProduct,
  UNASSIGNED_LOCATION_NAME,
  type LocationRef,
  type ProductRef,
  type StockCountRow,
} from "@/app/admin/stocktake/variance";

const LOCATIONS: LocationRef[] = [
  { id: "loc-book", name: "Resistor book" },
  { id: "loc-shelf", name: "Rotating shelf" },
];

const PRODUCTS: ProductRef[] = [
  { id: "p-10k", name: "Resistor 10kΩ 0603", locationId: "loc-book" },
  { id: "p-4k7", name: "Resistor 4.7kΩ 0402", locationId: "loc-book" },
  { id: "p-gm6020", name: "GM6020", locationId: "loc-shelf" },
  { id: "p-orphan", name: "Cable ties assorted", locationId: null },
];

let nextId = 0;
function count(
  productId: string,
  countedQty: number,
  expectedQty: number,
  createdAt: string,
): StockCountRow {
  nextId += 1;
  return {
    id: `sc-${nextId}`,
    productId,
    countedQty,
    expectedQty,
    createdAt,
    // Mirrors the RPC: zero variance writes no movement, so no movement id.
    movementId: countedQty === expectedQty ? null : nextId,
    sessionId: "sess-1",
  };
}

describe("summariseByProduct", () => {
  it("collapses a product's counts into one row keyed on the latest", () => {
    const rows = [
      count("p-10k", 480, 500, "2026-03-01T10:00:00Z"),
      count("p-10k", 495, 500, "2026-01-01T10:00:00Z"),
    ];
    const [summary] = summariseByProduct(rows, PRODUCTS, LOCATIONS);
    expect(summary.productName).toBe("Resistor 10kΩ 0603");
    expect(summary.locationName).toBe("Resistor book");
    expect(summary.timesCounted).toBe(2);
    expect(summary.timesWithVariance).toBe(2);
    expect(summary.lastVariance).toBe(-20);
    expect(summary.lastCountedQty).toBe(480);
    expect(summary.lastExpectedQty).toBe(500);
    expect(summary.lastCountedAt).toBe("2026-03-01T10:00:00Z");
    expect(summary.netVariance).toBe(-25);
    expect(summary.absVariance).toBe(25);
  });

  it("picks the latest count by timestamp, not by row order", () => {
    const rows = [
      count("p-10k", 495, 500, "2026-01-01T10:00:00Z"),
      count("p-10k", 480, 500, "2026-03-01T10:00:00Z"),
    ];
    const [summary] = summariseByProduct(rows, PRODUCTS, LOCATIONS);
    expect(summary.lastVariance).toBe(-20);
    expect(summary.lastCountedAt).toBe("2026-03-01T10:00:00Z");
  });

  it("counts a match as counted-but-not-drifted", () => {
    const rows = [count("p-gm6020", 12, 12, "2026-03-01T10:00:00Z")];
    const [summary] = summariseByProduct(rows, PRODUCTS, LOCATIONS);
    expect(summary.timesCounted).toBe(1);
    expect(summary.timesWithVariance).toBe(0);
    expect(summary.lastVariance).toBe(0);
    expect(summary.absVariance).toBe(0);
  });

  it("keeps gains and losses from cancelling out in absVariance", () => {
    const rows = [
      count("p-4k7", 110, 100, "2026-01-01T10:00:00Z"),
      count("p-4k7", 90, 100, "2026-02-01T10:00:00Z"),
    ];
    const [summary] = summariseByProduct(rows, PRODUCTS, LOCATIONS);
    expect(summary.netVariance).toBe(0);
    expect(summary.absVariance).toBe(20);
    expect(summary.timesWithVariance).toBe(2);
  });

  it("orders the loudest signal first", () => {
    const rows = [
      count("p-gm6020", 12, 12, "2026-03-01T10:00:00Z"),
      count("p-4k7", 95, 100, "2026-03-01T10:00:00Z"),
      count("p-10k", 400, 500, "2026-03-01T10:00:00Z"),
    ];
    expect(
      summariseByProduct(rows, PRODUCTS, LOCATIONS).map((p) => p.productId),
    ).toEqual(["p-10k", "p-4k7", "p-gm6020"]);
  });

  it("buckets a product with no location under the unassigned name", () => {
    const rows = [count("p-orphan", 3, 5, "2026-03-01T10:00:00Z")];
    const [summary] = summariseByProduct(rows, PRODUCTS, LOCATIONS);
    expect(summary.locationId).toBeNull();
    expect(summary.locationName).toBe(UNASSIGNED_LOCATION_NAME);
  });

  it("does not drop a count whose product is no longer in the catalog", () => {
    const rows = [count("p-deleted", 1, 2, "2026-03-01T10:00:00Z")];
    const [summary] = summariseByProduct(rows, PRODUCTS, LOCATIONS);
    expect(summary.productName).toBe("Unknown product");
    expect(summary.lastVariance).toBe(-1);
  });

  it("returns nothing when no counts exist yet", () => {
    expect(summariseByProduct([], PRODUCTS, LOCATIONS)).toEqual([]);
  });
});

describe("summariseByLocation", () => {
  it("rolls products up to the shelf, which is the unit of work", () => {
    const rows = [
      count("p-10k", 480, 500, "2026-03-01T10:00:00Z"),
      count("p-4k7", 100, 100, "2026-03-01T10:00:00Z"),
      count("p-gm6020", 13, 12, "2026-02-01T10:00:00Z"),
    ];
    const byLocation = summariseByLocation(
      summariseByProduct(rows, PRODUCTS, LOCATIONS),
    );
    expect(byLocation).toEqual([
      {
        locationId: "loc-book",
        locationName: "Resistor book",
        productsCounted: 2,
        productsWithVariance: 1,
        netVariance: -20,
        absVariance: 20,
        lastCountedAt: "2026-03-01T10:00:00Z",
      },
      {
        locationId: "loc-shelf",
        locationName: "Rotating shelf",
        productsCounted: 1,
        productsWithVariance: 1,
        netVariance: 1,
        absVariance: 1,
        lastCountedAt: "2026-02-01T10:00:00Z",
      },
    ]);
  });

  it("keeps the unassigned bucket separate from real locations", () => {
    const rows = [
      count("p-orphan", 3, 5, "2026-03-01T10:00:00Z"),
      count("p-10k", 500, 500, "2026-03-01T10:00:00Z"),
    ];
    const byLocation = summariseByLocation(
      summariseByProduct(rows, PRODUCTS, LOCATIONS),
    );
    expect(byLocation.map((l) => l.locationName)).toEqual([
      UNASSIGNED_LOCATION_NAME,
      "Resistor book",
    ]);
    expect(byLocation[1].productsWithVariance).toBe(0);
  });
});
