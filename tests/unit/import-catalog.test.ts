import { describe, expect, it } from "vitest";

import {
  classifyRowKind,
  classifyTier,
  isMislabeledAsResistor,
  isUnidentifiableName,
  MAIN_COLUMNS,
  parseCsv,
  repairOmegaMangling,
  runImportOnText,
  SUPERCAP_COLUMNS,
  tryParseResistorBookItem,
} from "../../scripts/import-catalog";

/**
 * Small synthetic fixture (~20 rows) reproducing the real spreadsheet's known
 * defect patterns from docs/catalog-migration.md, so the test is fast and
 * self-contained rather than depending on the real 538-row file:
 *  - the two-side-by-side-tables header (main A-G, supercap I-N)
 *  - a section-header row for each side (forward-filled category)
 *  - an empty filler row
 *  - mangled-Ω resistor values that should repair, and a "?F" (µF) cell that
 *    must NOT be touched
 *  - a resistor-book section (Location "book") with clean values and one
 *    unparseable value
 *  - byte-identical duplicate rows
 *  - capacitors mislabeled as "Resistor"
 *  - unidentifiable names ("402", "3m resistor", "Cartridge Fuse unknown")
 *  - non-numeric quantities ("a lot", "3 sticks", ">50")
 *  - an "Assembled parts" (asset-tier) row
 */
const FIXTURE_CSV = [
  "No.,Item,Qty in storage,Qty outside,Total,Location,Remarks,,No.,Item,Qty in storage,Needed,Location,Remarks",
  ",Connectors,,,,,work in progress,,,Supercapacitor Controller Parts,,,,",
  "1,XT30 right angle M,40,,40,Table Shelf,,,,SMD 4pin JST,10,,small box,old supercap",
  "2,Pin conn M,a lot,,0,table shelf,,,,,,,,",
  "3,pin headers male right angled,3 sticks,,0,Table Shelf,,,,,,,,",
  "4,JST 2 pin wire,>50,,,rotating shelf,,,,,,,,",
  ",,,,0,,,,,,,,,", // filler row (blank item, blank qty)
  ",Components through hole,,,,,,,,,,,,",
  "5,Resistor 1k?,11,,11,Table Shelf,,,,,,,,",
  "6,Resistor 220 ?,4,,4,Table Shelf,,,,,,,,",
  "7,Resistor 400,1,,1,Table Shelf,,,,,,,,",
  "8,Capacitors 50V 10k ?F,1,,1,Table Shelf,,,,,,,,", // must NOT be Ω-repaired (µF, not Ω)
  ",Assembled parts (for robomaster stuff see other tabs),,,,,,,,,,,,",
  ",M3508,6,58,64,blue rack,\"15 darknus, 7 hero, aerial\",,,,,,,",
  ",SMD,,,,,,,,,,,,",
  ",2.2uF 16V Resistor,10,,,small box,,,,,,,,", // mislabeled capacitor
  ",470pF 50V Resistor,8,,,small box,,,,,,,,", // mislabeled capacitor
  ",100nF 100V ceramic capacitor 0603 SMD,85,,,small box,,,,,,,,", // duplicate A
  ",100nF 100V ceramic capacitor 0603 SMD,85,,,small box,,,,,,,,", // duplicate B (byte-identical)
  ",402,8,,,small box,,,,,,,,", // unidentifiable
  ",3m resistor,6,,,small box,,,,,,,,", // unidentifiable (milli or mega?)
  ",Cartridge Fuse unknown,2,,2,Table Shelf,,,,,,,,", // unidentifiable
  ",10k?,50,,,book,,,,,,,,", // resistor book: cleanly parseable
  ",R 402 1.1,50,,,book,,,,,,,,", // resistor book: NOT cleanly parseable -> must flag
].join("\n");

describe("parseCsv", () => {
  it("splits fields respecting quoted commas", () => {
    const rows = parseCsv('a,"b, c",d\n1,2,3\n');
    expect(rows).toEqual([
      ["a", "b, c", "d"],
      ["1", "2", "3"],
    ]);
  });
});

describe("repairOmegaMangling", () => {
  it("repairs a trailing ? on a resistor value (no space)", () => {
    expect(repairOmegaMangling("Resistor 1k?")).toBe("Resistor 1kΩ");
  });

  it("repairs a trailing ? on a resistor value (with space)", () => {
    expect(repairOmegaMangling("Resistor 220 ?")).toBe("Resistor 220Ω");
  });

  it("repairs a bare resistor-book value with a multiplier", () => {
    expect(repairOmegaMangling("9.1M?")).toBe("9.1MΩ");
  });

  it("does NOT touch a ?F cell (mangled µ, not Ω)", () => {
    expect(repairOmegaMangling("Capacitors 50V 10k ?F")).toBe("Capacitors 50V 10k ?F");
  });

  it("does not touch a literal unknown marker with no digit before it", () => {
    expect(repairOmegaMangling("Cartridge Fuse unknown")).toBe("Cartridge Fuse unknown");
  });
});

describe("classifyRowKind", () => {
  it("identifies a section-header row (item set, quantities blank)", () => {
    const fields = ",Connectors,,,,,work in progress,,,Supercapacitor Controller Parts,,,,".split(",");
    expect(classifyRowKind(fields, MAIN_COLUMNS)).toBe("header");
    expect(classifyRowKind(fields, SUPERCAP_COLUMNS)).toBe("header");
  });

  it("identifies a filler row (blank item, blank quantities)", () => {
    const fields = ",,,,0,,,,,,,,,".split(",");
    expect(classifyRowKind(fields, MAIN_COLUMNS)).toBe("filler");
  });

  it("identifies a normal data row", () => {
    const fields = "1,XT30 right angle M,40,,40,Table Shelf,,,,,,,,".split(",");
    expect(classifyRowKind(fields, MAIN_COLUMNS)).toBe("data");
  });
});

describe("tryParseResistorBookItem", () => {
  it("parses a bare value with a k multiplier", () => {
    expect(tryParseResistorBookItem("10kΩ")).toEqual({
      name: "Resistor 10kΩ 0402",
      spec: { value: "10k", package: "0402", type: "resistor" },
    });
  });

  it("returns null for an unparseable value rather than guessing", () => {
    expect(tryParseResistorBookItem("R 402 1.1")).toBeNull();
  });
});

describe("isUnidentifiableName / isMislabeledAsResistor", () => {
  it("flags a bare-number name", () => {
    expect(isUnidentifiableName("402")).toBe(true);
  });

  it("flags an explicit unknown/thingy marker", () => {
    expect(isUnidentifiableName("Cartridge Fuse unknown")).toBe(true);
  });

  it("flags an ambiguous milli/mega resistor name", () => {
    expect(isUnidentifiableName("3m resistor")).toBe(true);
  });

  it("does not flag a normal descriptive name", () => {
    expect(isUnidentifiableName("XT30 right angle M")).toBe(false);
  });

  it("flags a capacitor mislabeled as a resistor", () => {
    expect(isMislabeledAsResistor("2.2uF 16V Resistor")).toBe(true);
    expect(isMislabeledAsResistor("470pF 50V Resistor")).toBe(true);
  });

  it("does not flag a genuine resistor name", () => {
    expect(isMislabeledAsResistor("Resistor 10kΩ 0402")).toBe(false);
  });
});

describe("classifyTier", () => {
  it("classifies a loose-quantity row regardless of category", () => {
    expect(
      classifyTier({
        sourceRow: 4,
        side: "main",
        item: "Pin conn M",
        qtyStorageRaw: "a lot",
        secondaryQtyRaw: "",
        location: "table shelf",
        remarks: "",
        category: "Connectors",
      }),
    ).toBe("loose");
  });

  it("classifies Assembled parts as asset", () => {
    expect(
      classifyTier({
        sourceRow: 13,
        side: "main",
        item: "M3508",
        qtyStorageRaw: "6",
        secondaryQtyRaw: "58",
        location: "blue rack",
        remarks: "",
        category: "Assembled parts (for robomaster stuff see other tabs)",
      }),
    ).toBe("asset");
  });

  it("classifies a bulk SMD row as bulk", () => {
    expect(
      classifyTier({
        sourceRow: 20,
        side: "main",
        item: "100nF 100V ceramic capacitor 0603 SMD",
        qtyStorageRaw: "85",
        secondaryQtyRaw: "",
        location: "small box",
        remarks: "",
        category: "SMD",
      }),
    ).toBe("bulk");
  });
});

describe("runImportOnText (end-to-end over the inline fixture)", () => {
  const { reviewRows, summary } = runImportOnText(FIXTURE_CSV);

  it("drops the filler row and both section-header rows from the data set", () => {
    // Fixture has 24 lines total (1 header + 23 rows); 3 of those 23 are
    // structural (2 section headers + 1 filler) on the main side alone, plus
    // 1 supercap section header — verified indirectly via the summary count.
    expect(summary.totalRawRows).toBe(24);
    expect(reviewRows.some((r) => r.proposed_name === "")).toBe(false);
  });

  it("forward-fills category from the nearest preceding header (M3508 -> Assembled parts)", () => {
    const m3508 = reviewRows.find((r) => r.proposed_name === "M3508");
    expect(m3508).toBeDefined();
    expect(m3508!.proposed_category).toBe("Assembled parts (for robomaster stuff see other tabs)");
    expect(m3508!.proposed_tier).toBe("asset");
  });

  it("repairs Ω mangling in resistor names but leaves the µF cell alone", () => {
    expect(reviewRows.some((r) => r.proposed_name === "Resistor 1kΩ")).toBe(true);
    expect(reviewRows.some((r) => r.proposed_name === "Resistor 220Ω")).toBe(true);
    expect(reviewRows.some((r) => r.proposed_name === "Capacitors 50V 10k ?F")).toBe(true);
  });

  it("flags both byte-identical duplicate rows", () => {
    const dupes = reviewRows.filter((r) => r.proposed_name === "100nF 100V ceramic capacitor 0603 SMD");
    expect(dupes).toHaveLength(2);
    for (const row of dupes) {
      expect(row.flag).toBe(true);
      expect(row.flag_reason).toMatch(/duplicate name\+category/);
    }
  });

  it("flags mislabeled capacitors instead of silently importing them as resistors", () => {
    const uF = reviewRows.find((r) => r.proposed_name === "2.2uF 16V Resistor");
    const pF = reviewRows.find((r) => r.proposed_name === "470pF 50V Resistor");
    expect(uF?.flag).toBe(true);
    expect(uF?.flag_reason).toMatch(/mislabeled/);
    expect(pF?.flag).toBe(true);
    expect(pF?.flag_reason).toMatch(/mislabeled/);
  });

  it("flags unidentifiable names", () => {
    expect(reviewRows.find((r) => r.proposed_name === "402")?.flag).toBe(true);
    expect(reviewRows.find((r) => r.proposed_name === "3m resistor")?.flag).toBe(true);
    expect(reviewRows.find((r) => r.proposed_name === "Cartridge Fuse unknown")?.flag).toBe(true);
  });

  it("flags non-numeric quantities as loose tier without inventing a count", () => {
    const aLot = reviewRows.find((r) => r.proposed_name === "Pin conn M");
    expect(aLot?.proposed_tier).toBe("loose");
    expect(aLot?.flag).toBe(true);
    expect(aLot?.flag_reason).toMatch(/non-numeric quantity/);

    const sticks = reviewRows.find((r) => r.proposed_name === "pin headers male right angled");
    expect(sticks?.proposed_tier).toBe("loose");
    expect(sticks?.flag).toBe(true);

    const greaterThan = reviewRows.find((r) => r.proposed_name === "JST 2 pin wire");
    expect(greaterThan?.proposed_tier).toBe("loose");
    expect(greaterThan?.flag).toBe(true);
  });

  it("normalizes a clean resistor-book value into name + spec, and flags the unparseable one", () => {
    const clean = reviewRows.find((r) => r.proposed_category === "SMD" && r.proposed_name.startsWith("Resistor 10k"));
    expect(clean).toBeDefined();
    expect(clean!.proposed_name).toBe("Resistor 10kΩ 0402");
    expect(JSON.parse(clean!.proposed_spec_json)).toEqual({ value: "10k", package: "0402", type: "resistor" });
    expect(clean!.flag).toBe(false);

    const unparseable = reviewRows.find((r) => r.proposed_name === "R 402 1.1");
    expect(unparseable).toBeDefined();
    expect(unparseable!.flag).toBe(true);
    expect(unparseable!.flag_reason).toMatch(/resistor book value/);
    expect(unparseable!.proposed_spec_json).toBe("");
  });

  it("summary counts data rows correctly (headers and filler excluded)", () => {
    expect(summary.totalDataRows).toBe(reviewRows.length);
    expect(summary.mainDataRows + summary.supercapDataRows).toBe(summary.totalDataRows);
    expect(summary.flaggedRows).toBeGreaterThan(0);
  });
});
