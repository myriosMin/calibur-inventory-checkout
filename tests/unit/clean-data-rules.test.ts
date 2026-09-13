import { describe, expect, it } from "vitest";

import { resolveHolder, resolveLocation } from "../../scripts/clean-data/curation";
import {
  CATEGORY,
  categorize,
  cleanName,
  cleanSerial,
  extractPartNumber,
  isE24,
  isFabricatedLegacyTotal,
  nameKey,
  parseBookResistorValue,
  parseQty,
  parseViewCell,
  tierFor,
  unitCondition,
  unitOwnership,
} from "../../scripts/clean-data/rules";
import type { LegacyItem } from "../../scripts/clean-data/sources";
import { sqlText } from "../../scripts/import-clean-data";

/**
 * The generic rules behind scripts/clean-data/build.ts. Every case here is a
 * real cell from the source spreadsheet or the legacy app export.
 */

const legacyItem = (overrides: Partial<LegacyItem>): LegacyItem => ({
  id: "00000000-0000-0000-0000-000000000000",
  name: "x",
  group_name: "Electrical Parts",
  category: "SMD",
  total: 0,
  checked_out: 0,
  notes: "",
  created_at: "2026-07-19 17:00:02+00",
  faulty_qty: 0,
  lost_qty: 0,
  ...overrides,
});

describe("parseQty", () => {
  it("never invents a number for a non-numeric quantity", () => {
    expect(parseQty("50")).toEqual({ kind: "count", n: 50 });
    expect(parseQty("")).toEqual({ kind: "blank" });
    for (const raw of ["a lot", ">50", "3 sticks", "1tub"]) {
      expect(parseQty(raw)).toEqual({ kind: "level", raw });
    }
  });
});

describe("parseViewCell", () => {
  it("treats 'need N' as a shortfall, not a holding", () => {
    expect(parseViewCell("6")).toEqual({ held: 6, need: 0 });
    expect(parseViewCell("need 4")).toEqual({ held: 0, need: 4 });
    expect(parseViewCell("")).toEqual({ held: 0, need: 0 });
  });
});

describe("isFabricatedLegacyTotal", () => {
  it("recognises the legacy app's invented 100s", () => {
    expect(isFabricatedLegacyTotal(legacyItem({ total: 100, notes: "orig qty: 'a lot' [Loc: Table Shelf]" }), null)).toBe(true);
    expect(isFabricatedLegacyTotal(legacyItem({ total: 100, notes: "new supercap [Needed: 4]" }), null)).toBe(true);
    expect(isFabricatedLegacyTotal(legacyItem({ total: 100, notes: "[Loc: book]" }), { kind: "blank" })).toBe(true);
  });

  it("keeps real counts, including a real 100", () => {
    expect(isFabricatedLegacyTotal(legacyItem({ total: 100 }), { kind: "count", n: 100 })).toBe(false);
    expect(isFabricatedLegacyTotal(legacyItem({ total: 54 }), { kind: "count", n: 4 })).toBe(false);
  });
});

describe("nameKey", () => {
  it("folds the ohm sign, Greek omega, micro sign and Greek mu", () => {
    expect(nameKey("Resistor 100 Ω")).toBe(nameKey("Resistor 100 Ω"));
    expect(nameKey("10µF")).toBe(nameKey("10μF"));
  });
});

describe("cleanName", () => {
  it("fixes typos and resistance units without touching milliohm/megohm meaning", () => {
    expect(cleanName("100V 1A schottcky diode")).toBe("100V 1A Schottky diode");
    expect(cleanName("Resistor 1kohm 0805 ")).toBe("Resistor 1kΩ 0805");
    expect(cleanName("60V 131A 140W 2.2mohm NMOS")).toContain("2.2mΩ");
    expect(cleanName("Resistor SMD 1M ohm 0603")).toContain("1MΩ");
    expect(cleanName("XT30 FtoF")).toBe("XT30 F-F");
    expect(cleanName("oscilliscope")).toBe("Oscilloscope");
  });
});

describe("resistor book", () => {
  it("parses every spelling the book uses", () => {
    expect(parseBookResistorValue("R 0402 0 ohm")).toBe("0");
    expect(parseBookResistorValue("R 402 1.1")).toBe("1.1");
    expect(parseBookResistorValue("402 2.7Ω")).toBe("2.7");
    expect(parseBookResistorValue("1.2Ω")).toBe("1.2");
    expect(parseBookResistorValue("110k")).toBe("110k");
    expect(parseBookResistorValue("9.1MΩ")).toBe("9.1M");
    expect(parseBookResistorValue("Resistor 100 Ω")).toBeNull();
  });

  it("knows the E24 series, which is how the misfiled values were caught", () => {
    for (const value of ["0", "30", "4.7k", "7.5k", "9.1M"]) expect(isE24(value)).toBe(true);
    for (const value of ["31", "5.5k", "448"]) expect(isE24(value)).toBe(false);
  });
});

describe("categorize", () => {
  it.each([
    ["XT60 F-M short", "Wires", CATEGORY.cables],
    ["XT30 right angle M", "Connectors", CATEGORY.connectors],
    ["2.2uF 16V Resistor", "SMD", CATEGORY.capacitors],
    ["60V 131A 140W 2.2mohm NMOS SMD PQFNWB-8L", "SMD", CATEGORY.semis],
    ["MPS2222A", "Components through hole", CATEGORY.semis],
    ["Capacitors 2.7V 50F", "Components through hole", CATEGORY.capacitors],
    ["USB TO TTL", "Components through hole", CATEGORY.devboards],
    ["Hobby motors", "Components through hole", CATEGORY.hobbyMotors],
    ["soldering iron", "Tools", CATEGORY.tools],
    ["solder", "Tools", CATEGORY.consumables],
  ])("%s (%s) -> %s", (item, section, expected) => {
    expect(categorize(item, section)).toBe(expected);
  });
});

describe("tierFor", () => {
  it("maps criticality to counting UX, and level-only stock to loose", () => {
    expect(tierFor("expendable", { kind: "count", n: 5 })).toBe("bulk");
    expect(tierFor("standard", { kind: "count", n: 5 })).toBe("asset");
    expect(tierFor("critical", null)).toBe("asset");
    expect(tierFor("expendable", { kind: "level", raw: "a lot" })).toBe("loose");
  });
});

describe("per-unit register", () => {
  const unit = (overrides: Partial<Parameters<typeof unitCondition>[0]>) => ({
    functioning: "",
    remarks: "",
    location: "",
    allocationTag: "Storage / Unallocated",
    ...overrides,
  });

  it("derives condition, treating swollen LiPo packs as faulty", () => {
    expect(unitCondition(unit({ allocationTag: "Disposed / Missing", location: "Missing, last found in Storage on 24 July 2023" }))).toBe("missing");
    expect(unitCondition(unit({ allocationTag: "Disposed / Missing", remarks: "Destroyed during 17 Mar 2025 Aerial testing" }))).toBe("disposed");
    expect(unitCondition(unit({ functioning: "No", remarks: "Side dial faulty" }))).toBe("faulty");
    expect(unitCondition(unit({ functioning: "Yes", remarks: "Slight bloat" }))).toBe("faulty");
    expect(unitCondition(unit({ functioning: "Yes", remarks: "QR code sticker messed up - can't scan" }))).toBe("ok");
    expect(unitCondition(unit({}))).toBe("unknown");
  });

  it("reads loans to the club out of the remarks", () => {
    expect(unitOwnership("On loan from Advantech Sep 2025")).toEqual({ ownership: "on_loan", loanedFrom: "Advantech" });
    expect(unitOwnership("Old version of oak-d-lite, loaned to us indefinitely by Huimin")).toEqual({
      ownership: "on_loan",
      loanedFrom: "Huimin",
    });
    expect(unitOwnership("Purchased from Cytron Sep 2024")).toEqual({ ownership: "owned", loanedFrom: null });
  });

  it("keeps partial serials but drops placeholders", () => {
    expect(cleanSerial("NIL")).toEqual({ serial: null, note: null });
    expect(cleanSerial("Sticker missing").serial).toBeNull();
    expect(cleanSerial("?2J??50190 (scratched)")).toEqual({ serial: "?2J??50190", note: "Serial partly unreadable" });
    expect(cleanSerial("1LPDG2T 001K21N")).toEqual({ serial: "1LPDG2T 001K21N", note: null });
  });
});

describe("extractPartNumber", () => {
  it("finds MPNs and ignores quantities with units and package names", () => {
    expect(extractPartNumber("Resistor SMD 1 ohm 0402 CRCW04021R00FKEDC")).toBe("CRCW04021R00FKEDC");
    expect(extractPartNumber("DSK210 schottky diode SOD-123F")).toBe("DSK210");
    expect(extractPartNumber("100mW Film resistor 75V 0603 17.4kohm SMD")).toBeNull();
  });
});

describe("curation lookups", () => {
  it("resolves robot aliases and store tags", () => {
    expect(resolveHolder("DarkSTD Team 3")).toBe("DarkNUS");
    expect(resolveHolder("Standard (kirbee)")).toBe("Standard – Kirbee");
    expect(resolveHolder("Storage / Unallocated")).toBeNull();
  });

  it("resolves the first recognisable location token", () => {
    expect(resolveLocation("near darknus box, blue rack")).toBe("DarkNUS box");
    expect(resolveLocation("Small Box")).toBe("Small box");
    expect(resolveLocation("Storage")).toBeNull();
  });
});

describe("sqlText", () => {
  it("quotes safely and turns empty cells into typed nulls", () => {
    expect(sqlText("O'Brien")).toBe("'O''Brien'");
    expect(sqlText("")).toBe("null");
    expect(sqlText("", "::text")).toBe("null::text");
    expect(sqlText("2026-01-01", "::date")).toBe("'2026-01-01'::date");
  });
});
