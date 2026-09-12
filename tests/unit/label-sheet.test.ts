import { describe, expect, it } from "vitest";

import {
  ALL_LOCATIONS,
  buildLabelSpec,
  GROUP_LABEL_HINT,
  locationPath,
  matchesLocation,
  NO_LOCATION,
  sortForPrinting,
  type LabelLocation,
  type LabelProduct,
  type ScanCode,
} from "@/app/admin/labels/label-spec";
import { sheetPrintCss } from "@/app/admin/labels/print-css";
import {
  A4_HEIGHT_MM,
  A4_WIDTH_MM,
  checkGeometry,
  DEFAULT_SHEET_ID,
  findSheetGeometry,
  labelsPerSheet,
  measureSheet,
  paginate,
  SHEET_GEOMETRIES,
  textAreaHeightMm,
} from "@/app/admin/labels/sheet-geometry";
import { qrModuleCount } from "@/lib/codes/label-url";

const BOT = "calibur_checkout_bot";
const APP = "s";

const LOCATIONS: LabelLocation[] = [
  { id: "loc-shelf", name: "Table Shelf", parent_id: null },
  { id: "loc-smd", name: "SMD", parent_id: "loc-box" },
  { id: "loc-box", name: "Small box", parent_id: null },
  { id: "loc-book", name: "Resistor book", parent_id: null },
];

const PRODUCTS: LabelProduct[] = [
  {
    id: "p-1",
    name: "XT60 connector, male",
    location_id: "loc-shelf",
    tier: "bulk",
    active: true,
    part_number: null,
  },
  {
    id: "p-2",
    name: "Resistor 10kΩ 0402",
    location_id: "loc-smd",
    tier: "loose",
    active: true,
    part_number: null,
  },
  {
    id: "p-3",
    name: "Unfiled thing",
    location_id: null,
    tier: "bulk",
    active: true,
    part_number: null,
  },
];

const locationsById = new Map(LOCATIONS.map((l) => [l.id, l]));
const productsById = new Map(PRODUCTS.map((p) => [p.id, p]));
const ctx = { productsById, locationsById, botUsername: BOT, appName: APP };

function code(overrides: Partial<ScanCode>): ScanCode {
  return {
    code: "A3F9K2z",
    kind: "product",
    product_id: "p-1",
    location_id: null,
    label: null,
    active: true,
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as ScanCode;
}

describe("locationPath", () => {
  it("joins the ancestry", () => {
    expect(locationPath("loc-smd", locationsById)).toBe("Small box / SMD");
    expect(locationPath("loc-shelf", locationsById)).toBe("Table Shelf");
  });

  it("returns empty for no location and for an unknown id", () => {
    expect(locationPath(null, locationsById)).toBe("");
    expect(locationPath("nope", locationsById)).toBe("");
  });

  it("terminates on a cyclic parent chain", () => {
    const cyclic = new Map<string, LabelLocation>([
      ["a", { id: "a", name: "A", parent_id: "b" }],
      ["b", { id: "b", name: "B", parent_id: "a" }],
    ]);
    expect(locationPath("a", cyclic)).toBe("B / A");
  });
});

describe("buildLabelSpec", () => {
  it("builds a product label with name, location and code", () => {
    const spec = buildLabelSpec(code({}), ctx);
    expect(spec.kind).toBe("product");
    expect(spec.title).toBe("XT60 connector, male");
    expect(spec.meta).toBe("Table Shelf · A3F9K2z");
    expect(spec.hint).toBeNull();
    expect(spec.locationId).toBe("loc-shelf");
    expect(spec.url).toBe("https://t.me/calibur_checkout_bot/s?startapp=A3F9K2z");
  });

  it("builds a group label from the location, with a pick-one hint", () => {
    const spec = buildLabelSpec(
      code({
        code: "Bk3Page2",
        kind: "group",
        product_id: null,
        location_id: "loc-book",
        label: "Page 3 — 1kΩ to 10kΩ",
      }),
      ctx,
    );
    expect(spec.kind).toBe("group");
    // The free-text label wins as the title: "Page 3 — 1kΩ to 10kΩ" is what
    // is useful on the sticker, not the bare book name.
    expect(spec.title).toBe("Page 3 — 1kΩ to 10kΩ");
    expect(spec.meta).toBe("Resistor book · Bk3Page2");
    expect(spec.hint).toBe(GROUP_LABEL_HINT);
    expect(spec.locationId).toBe("loc-book");
  });

  it("falls back to the location name when a group label has no free text", () => {
    const spec = buildLabelSpec(
      code({ kind: "group", product_id: null, location_id: "loc-book", label: null }),
      ctx,
    );
    expect(spec.title).toBe("Resistor book");
  });

  it("still prints a legible label when the product row is gone", () => {
    const spec = buildLabelSpec(code({ product_id: "missing" }), ctx);
    expect(spec.title).toBe("Unknown product");
    // The code survives, which is what makes the sticker recoverable.
    expect(spec.meta).toBe("A3F9K2z");
  });

  it("omits the location from meta when the product has none", () => {
    const spec = buildLabelSpec(code({ product_id: "p-3" }), ctx);
    expect(spec.meta).toBe("A3F9K2z");
    expect(spec.locationId).toBeNull();
  });

  it("propagates an unusable bot/app configuration as a throw", () => {
    expect(() =>
      buildLabelSpec(code({}), { ...ctx, appName: "" }),
    ).toThrow(/NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME/);
  });
});

describe("matchesLocation", () => {
  it("passes everything for the all-locations sentinel", () => {
    expect(matchesLocation("loc-shelf", ALL_LOCATIONS)).toBe(true);
    expect(matchesLocation(null, ALL_LOCATIONS)).toBe(true);
  });

  it("isolates the unfiled rows", () => {
    expect(matchesLocation(null, NO_LOCATION)).toBe(true);
    expect(matchesLocation("loc-shelf", NO_LOCATION)).toBe(false);
  });

  it("matches one location exactly", () => {
    expect(matchesLocation("loc-shelf", "loc-shelf")).toBe(true);
    expect(matchesLocation("loc-smd", "loc-shelf")).toBe(false);
  });
});

describe("sortForPrinting", () => {
  it("orders by location path, then name, then code", () => {
    const specs = [
      buildLabelSpec(code({ code: "zzzzzzz", product_id: "p-2" }), ctx),
      buildLabelSpec(code({ code: "aaaaaaa", product_id: "p-1" }), ctx),
      buildLabelSpec(code({ code: "mmmmmmm", product_id: "p-3" }), ctx),
    ];
    const sorted = sortForPrinting(specs, locationsById);
    // "" (unfiled) < "Small box / SMD" < "Table Shelf"
    expect(sorted.map((s) => s.title)).toEqual([
      "Unfiled thing",
      "Resistor 10kΩ 0402",
      "XT60 connector, male",
    ]);
  });

  it("does not mutate its input", () => {
    const specs = [
      buildLabelSpec(code({ code: "zzzzzzz", product_id: "p-2" }), ctx),
      buildLabelSpec(code({ code: "aaaaaaa", product_id: "p-1" }), ctx),
    ];
    const before = specs.map((s) => s.code);
    sortForPrinting(specs, locationsById);
    expect(specs.map((s) => s.code)).toEqual(before);
  });
});

describe("paginate", () => {
  it("splits into full pages plus a remainder", () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns no pages for no labels", () => {
    expect(paginate([], 21)).toEqual([]);
  });
});

describe("sheet geometry presets", () => {
  it.each(SHEET_GEOMETRIES.map((g) => [g.id, g] as const))(
    "%s lays out exactly on A4",
    (_id, geometry) => {
      const fit = measureSheet(geometry);
      expect(fit.usedWidthMm).toBeCloseTo(A4_WIDTH_MM, 1);
      expect(fit.usedHeightMm).toBeCloseTo(A4_HEIGHT_MM, 1);
      expect(fit.fitsA4).toBe(true);
    },
  );

  it.each(SHEET_GEOMETRIES.map((g) => [g.id, g] as const))(
    "%s prints a >=20 mm symbol with room for the text lines",
    (_id, geometry) => {
      // Checked at version 3 (the target) and version 4 (what an
      // over-budget link would force) so a preset can't be quietly fine at
      // one and broken at the other.
      expect(checkGeometry(geometry, qrModuleCount(3))).toEqual([]);
      expect(checkGeometry(geometry, qrModuleCount(4))).toEqual([]);
      expect(textAreaHeightMm(geometry)).toBeGreaterThan(0);
    },
  );

  it("flags a sheet that does not tile A4", () => {
    const broken = { ...SHEET_GEOMETRIES[0], columns: 4 };
    expect(checkGeometry(broken, qrModuleCount(3)).map((w) => w.id)).toContain("a4");
  });

  it("flags a QR box too small for a 20 mm symbol", () => {
    const broken = { ...SHEET_GEOMETRIES[0], qrBoxMm: 18 };
    expect(checkGeometry(broken, qrModuleCount(3)).map((w) => w.id)).toContain("qr-size");
  });

  it("flags a QR box that leaves no room for the human-readable text", () => {
    const broken = { ...SHEET_GEOMETRIES[0], qrBoxMm: 36 };
    expect(checkGeometry(broken, qrModuleCount(3)).map((w) => w.id)).toContain(
      "text-room",
    );
  });

  it("resolves the default and falls back for an unknown id", () => {
    expect(findSheetGeometry(DEFAULT_SHEET_ID).id).toBe(DEFAULT_SHEET_ID);
    expect(findSheetGeometry("no-such-sheet").id).toBe(SHEET_GEOMETRIES[0].id);
    expect(labelsPerSheet(findSheetGeometry("avery-l7160"))).toBe(21);
  });
});

describe("sheetPrintCss", () => {
  const css = sheetPrintCss(findSheetGeometry(DEFAULT_SHEET_ID));

  it("carries the chosen geometry in millimetres", () => {
    expect(css).toContain("repeat(3, 63.5mm)");
    expect(css).toContain("grid-auto-rows: 38.1mm");
    expect(css).toContain("width: 25.8mm");
  });

  it("keeps backgrounds and stops a label splitting across pages", () => {
    expect(css).toContain("print-color-adjust: exact");
    expect(css).toContain("break-inside: avoid");
  });

  it("hides the admin chrome only under the page's own body class", () => {
    expect(css).toContain("body.labels-printing header");
    expect(css).toContain("body.labels-printing .labels-screen-only");
  });
});
