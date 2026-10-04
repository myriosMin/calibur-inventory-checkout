import { describe, expect, it } from "vitest";

import {
  cleanSupplierUrl,
  expectedProductNames,
  normalizeCategory,
  parseBuildSheet,
  productPrices,
  type SheetRow,
  splitSupplier,
} from "../../scripts/build-lists/rules";
import { buildSql } from "../../scripts/import-build-lists";

/** A sheet row from columns B..G (A is always blank on these sheets). */
const row = (n: number, b = "", c = "", d = "", e = "", f = "", g = ""): SheetRow => ({
  row: n,
  cells: ["", b, c, d, e, f, g, "N/A"],
});
const HEADER = row(1, "Category", "Part Name", "Unit Price", "Qty", "Price (Est.)", "Link");

describe("parseBuildSheet", () => {
  it("reads parts, sub-assemblies and referee-kit lines", () => {
    const { lines, warnings } = parseBuildSheet("2627 Hero", [
      HEADER,
      row(2, "Chassis"),
      row(3, "Electronics", "C620 Motor Controller", "80", "5", "400"),
      row(21, "Gimbal"),
      row(22, "Motor", "gm6020", "241.65000000000003", "1", "241.65000000000003", "Yindividual LLC"),
      row(49, "Referee"),
      row(52, "Referee", "Speed monitor module", "Ref Sys", "1", "Ref Sys"),
    ]);
    expect(warnings).toEqual([]);
    expect(lines.map((l) => [l.position, l.section, l.partName, l.productName, l.qty, l.sourcing, l.unitPriceSgd])).toEqual([
      [1, "Chassis", "C620 Motor Controller", "DJI C620 ESC", 5, "buy", 80],
      [2, "Gimbal", "GM6020", "DJI GM6020 motor", 1, "buy", 241.65],
      // Hero fires 42 mm.
      [3, "Referee", "Speed monitor module", "DJI referee Speed Monitor Module 42mm SM11", 1, "referee_kit", null],
    ]);
    expect(lines[1]).toMatchObject({ supplier: "Yindividual LLC", supplierUrl: null, sourceText: "gm6020", sourceRow: 22 });
  });

  it("leaves ambiguous parts unlinked", () => {
    const { lines } = parseBuildSheet("2627 Double Yaw Sentry", [
      HEADER,
      row(5, "Electronics", "ESC centre board", "40", "1", "40"),
      row(18, "Ref Sys", "DJI Battery", "Ref Sys", "1", "Ref Sys"),
      row(54, "Ref Sys", "VTM Transmitter", "Ref Sys", "1", "Ref Sys"),
    ]);
    expect(lines.map((l) => l.productName)).toEqual([null, null, null]);
    expect(lines[1].category).toBe("Referee");
  });

  it("keeps TBD quantities as null with a note, and warns on nameless rows", () => {
    const { lines, warnings } = parseBuildSheet("2627 Hero", [
      HEADER,
      row(16, "Alu", "", "", "", "TBD"),
      row(35, "Aluminum", "CNC 9 pieces", "", "", "TBD"),
      row(78, "", "", "", "Total", "7161.28"),
      row(79, "", "", "", "", "486.85"),
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ category: "Aluminium", qty: null, unitPriceSgd: null });
    expect(lines[0].notes).toBe("Price TBD on the sheet. Quantity TBD on the sheet.");
    expect(warnings).toEqual(['2627 Hero!16: quantity or price with no part name (category "Alu"); skipped']);
  });

  it("applies the per-row fix for the duplicated Rail Steel line", () => {
    const { lines } = parseBuildSheet("2627 Double Yaw Standard", [
      HEADER,
      row(10, "Other", "MGN12C Linear Rail - Rail Steel", "2.7", "8", "21.6"),
      row(11, "Other", "MGN12C Linear Rail - Rail Steel", "1.65", "8", "13.2"),
    ]);
    expect(lines.map((l) => l.partName)).toEqual(["MGN12C Linear Rail", "MGN12C Linear Rail - Rail Steel"]);
    expect(lines[0].notes).toMatch(/carriage price/);
    expect(lines[0].sourceText).toBe("MGN12C Linear Rail - Rail Steel");
  });

  it("warns when unit price × qty disagrees with the sheet total", () => {
    const { warnings } = parseBuildSheet("x", [HEADER, row(4, "Other", "Hinge", "0.5", "6", "4")]);
    expect(warnings).toEqual(["x!4: 0.5 × 6 ≠ sheet total 4"]);
  });

  it("refuses a fractional or non-numeric quantity", () => {
    expect(() => parseBuildSheet("x", [HEADER, row(4, "Other", "Hinge", "0.5", "1.5", "")])).toThrow(/whole number/);
    expect(() => parseBuildSheet("x", [HEADER, row(4, "Other", "Hinge", "abc", "1", "")])).toThrow(/not a number/);
  });
});

describe("productPrices", () => {
  it("takes the highest bought price per product, and prices ambiguous lines' candidates", () => {
    const hero = parseBuildSheet("2627 Hero", [
      HEADER,
      row(5, "Electronics", "ESC centre board", "40", "2", "80"),
      row(9, "Motor", "DM-J4310P-2EC", "155.28", "1", "155.28"),
      row(23, "Motor", "DM-J4310-2EC V1.1 （24V）", "118.66", "1", "118.66"),
      row(54, "Referee", "Power Management Module", "Ref Sys", "1", "Ref Sys"),
      row(40, "Other", "Hinge", "0.5", "6", "3"),
    ]);
    expect(productPrices([{ name: "Hero", lines: hero.lines }])).toEqual([
      { productName: "Damiao DM4310 motor", unitPriceSgd: 155.28, from: "Hero!9" },
      { productName: "ESC center board 1", unitPriceSgd: 40, from: "Hero!5" },
      { productName: "ESC center board 2", unitPriceSgd: 40, from: "Hero!5" },
    ]);
  });
});

describe("suppliers", () => {
  it("strips Taobao and Tmall tracking down to the listing and variant", () => {
    expect(
      cleanSupplierUrl(
        "https://item.taobao.com/item.htm?app=chrome&bxsign=abc&id=662151468935&price=7&un=e863&skuId=4954008507845",
      ),
    ).toBe("https://item.taobao.com/item.htm?id=662151468935&skuId=4954008507845");
    expect(cleanSupplierUrl("https://detail.tmall.com/item.htm?abbucket=9&id=557065302363&spm=x")).toBe(
      "https://detail.tmall.com/item.htm?id=557065302363",
    );
    expect(cleanSupplierUrl("https://www.taobao.com/list/item/L0sv.htm?spm=a21wu")).toBe(
      "https://www.taobao.com/list/item/L0sv.htm",
    );
    // Short links need their token.
    expect(cleanSupplierUrl("https://e.tb.cn/h.hL48yqZkEz0t3ew?tk=OVeI4TG68Mk")).toBe(
      "https://e.tb.cn/h.hL48yqZkEz0t3ew?tk=OVeI4TG68Mk",
    );
  });

  it("splits a link from a supplier name", () => {
    expect(splitSupplier("https://sg.misumi-ec.com/vona2/detail/1")).toEqual({
      supplier: "MISUMI",
      supplierUrl: "https://sg.misumi-ec.com/vona2/detail/1",
    });
    expect(splitSupplier("Pro Workshop")).toEqual({ supplier: "Pro Workshop", supplierUrl: null });
    expect(splitSupplier("N/A")).toEqual({ supplier: null, supplierUrl: null });
  });

  it("normalises categories", () => {
    expect(normalizeCategory("Electronic")).toBe("Electronics");
    expect(normalizeCategory("Ref Sys")).toBe("Referee");
    expect(normalizeCategory("CF")).toBe("Carbon fibre");
    expect(normalizeCategory("Bearing")).toBe("Bearing");
    expect(normalizeCategory(" ")).toBeNull();
  });
});

describe("buildSql", () => {
  const plans = [
    {
      name: "Hero",
      sheet: "2627 Hero",
      lines: parseBuildSheet("2627 Hero", [HEADER, row(3, "Electronics", "C620 Motor Controller", "80", "5", "400")]).lines,
    },
  ];

  it("pins the schema, checks every linked product, and replaces only the season's lists", () => {
    const sql = buildSql(plans, { schema: "test", rehearse: false });
    expect(sql).toContain("set local search_path = test;");
    expect(sql).toContain("to_regclass('test.build_list_lines')");
    for (const name of expectedProductNames()) expect(sql).toContain(`'${name}'`);
    expect(sql).toContain("delete from build_lists where season = 'AY2627' and name in ('Hero');");
    expect(sql).toContain("(select id from products where name = 'DJI C620 ESC')");
    expect(sql).not.toMatch(/stock_movements|review_items/);
    // Prices fill gaps only; a price set on the product page wins.
    expect(sql).toContain("update products set unit_cost_sgd = 80 where name = 'DJI C620 ESC' and unit_cost_sgd is null;");
    expect(sql).toContain("migration 0028 is not applied");
    expect(sql.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("rolls back a rehearsal", () => {
    const sql = buildSql(plans, { schema: "public", rehearse: true });
    expect(sql).toContain("raise exception 'BUILD LISTS REHEARSAL OK");
    expect(sql).not.toContain("commit;");
  });
});
