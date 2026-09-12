/**
 * Catalog CSV importer / review-CSV generator (WP8).
 *
 * Scope (see docs/catalog-migration.md, "Migration plan" steps 1-3, plus
 * step 4's review-CSV generation): read the messy source spreadsheet, repair
 * the mangled Ω encoding conservatively, split the two side-by-side tables,
 * drop filler rows, forward-fill section-header categories, classify tiers,
 * normalize resistor-book names/specs, and emit a human review CSV.
 *
 * This script is READ-ONLY with respect to the product catalog: it never
 * imports `src/lib/supabase/server.ts` and never opens a DB connection. Its
 * only side effect is writing `scripts/out/catalog-review.csv`. The human
 * bench-review pass and the real `products`/`stock_movements` import are
 * explicitly out of scope for this pass (see WP8 in the implementation plan).
 *
 * Run: `npx tsx scripts/import-catalog.ts [csvPath] [outPath]`
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { csvEscape, parseCsv, toCsvLine } from "../src/lib/csv/parse";

// ---------------------------------------------------------------------------
// CSV parsing lives in src/lib/csv/parse.ts (hand-rolled: the source file has
// quoted fields containing commas, e.g. row 173's Remarks column, so a naive
// split(',') is wrong). It was moved out of this file so the admin roster
// importer -- a browser client component, which cannot import the node:fs /
// node:path this module needs -- can share the same implementation. Re-exported
// here so existing importers of this module (tests/unit/import-catalog.test.ts)
// keep working unchanged.
// ---------------------------------------------------------------------------

export { csvEscape, parseCsv, toCsvLine };

// ---------------------------------------------------------------------------
// Step 1: conservative Ω repair.
//
// The source sheet mangles Ω to a literal "?" throughout the resistor
// sections, but "?" is also used elsewhere for genuinely different things
// (e.g. a corrupted "μ" in "10k ?F" — ten kilo-*micro*farad, not ohms). We
// only repair a "?" that sits immediately after a numeric value (optionally
// with a k/M multiplier), and is NOT immediately followed by a word
// character (which would indicate it's a unit prefix like "?F" for µF, not
// a trailing ohms marker). This matches every real occurrence in the source
// file (rows 55-70, 358-512) while leaving row 51's "10k ?F" alone.
// ---------------------------------------------------------------------------

const OMEGA_REPAIR_RE = /(\d+(?:\.\d+)?)(\s?)([kM])?\?(?!\w)/g;

/** Repairs `Ω` mangled to `?` in value-looking tokens only (see comment above). Never touches a bare/legitimate "?". */
export function repairOmegaMangling(cell: string): string {
  return cell.replace(OMEGA_REPAIR_RE, (_match, num: string, _space: string, mult: string | undefined) => {
    return `${num}${mult ?? ""}Ω`;
  });
}

// ---------------------------------------------------------------------------
// Step 2: split the two side-by-side tables by column index.
// Header row (line 1) is literally:
//   No.,Item,Qty in storage,Qty outside,Total,Location,Remarks,,No.,Item,Qty in storage,Needed,Location,Remarks
// Columns 0-6 = main inventory (A-G); column 7 is the blank separator (H);
// columns 8-13 = supercap-controller BOM (I-N).
// ---------------------------------------------------------------------------

export interface SideColumns {
  no: number;
  item: number;
  qtyStorage: number;
  /** "Qty outside" for the main table; null for the supercap side. */
  qtyOutside: number | null;
  /** "Needed" for the supercap side; null for the main table. */
  needed: number | null;
  location: number;
  remarks: number;
  /**
   * Section-header labels documented in docs/catalog-migration.md for this
   * side of the sheet (matched case-insensitively as a prefix of Item). Only
   * a row whose Item starts with one of these can be a header — see the
   * long comment on classifyRowKind for why the blank-columns heuristic
   * alone is not sufficient on this sheet.
   */
  headerLabels: string[];
}

export const MAIN_COLUMNS: SideColumns = {
  no: 0,
  item: 1,
  qtyStorage: 2,
  qtyOutside: 3,
  needed: null,
  location: 5,
  remarks: 6,
  headerLabels: ["connectors", "components through hole", "assembled parts", "wires", "smd", "tools"],
};

export const SUPERCAP_COLUMNS: SideColumns = {
  no: 8,
  item: 9,
  qtyStorage: 10,
  qtyOutside: null,
  needed: 11,
  location: 12,
  remarks: 13,
  headerLabels: ["supercapacitor controller parts"],
};

function cell(fields: string[], idx: number | null): string {
  if (idx === null) return "";
  return (fields[idx] ?? "").trim();
}

// ---------------------------------------------------------------------------
// Step 3 + 4: classify each row as header / filler / data, and forward-fill
// category from header rows.
// ---------------------------------------------------------------------------

export type RowKind = "header" | "filler" | "data";

/**
 * A quantity cell counts as "blank" for header-detection purposes if it's
 * empty OR is itself a stray repeated column label (the real sheet has a
 * "Tools,Qty,,,,..." header row at line 516 where someone typed "Qty" again
 * instead of leaving the cell empty).
 */
function isBlankQtyCell(value: string): boolean {
  return value === "" || /^qty/i.test(value);
}

function looksLikeKnownHeader(item: string, headerLabels: string[]): boolean {
  const lower = item.toLowerCase();
  return headerLabels.some((label) => lower.startsWith(label));
}

/**
 * Heuristic (per docs/catalog-migration.md + WP8 spec): a header row has a
 * blank No., a non-blank Item, and all of that side's quantity-ish columns
 * blank. A filler row has a blank Item and blank quantity columns.
 * Everything else is data.
 *
 * The blank-columns signal alone is NOT sufficient on this sheet: within the
 * "Assembled parts" section (rows 169-211) *every* row has a blank No. —
 * that section never uses row numbering at all — and several individual
 * assets (e.g. row 201 "STM32H7 boards", which is itself just a board, not
 * a category) happen to also have both quantity columns blank. Treating
 * every no-blank/qty-blank row as a header would silently re-categorize
 * "STM32H7 boards" through "Muse lab logic analyser USB" (rows 202-210)
 * under the wrong category. The same happens on the supercap side, whose
 * "No." column is blank for every row. So a row is only ever classified as
 * a header if its Item additionally matches one of the exact section-header
 * labels documented in docs/catalog-migration.md for that side (Connectors,
 * Components through hole, Assembled parts, Wires, SMD, Tools; or
 * Supercapacitor Controller Parts on the BOM side) — anything else that
 * merely *looks* header-shaped is left as an ordinary (if sparse) data row.
 */
export function classifyRowKind(fields: string[], cols: SideColumns): RowKind {
  const no = cell(fields, cols.no);
  const item = cell(fields, cols.item);
  const qtyStorage = cell(fields, cols.qtyStorage);
  const qtyOutside = cell(fields, cols.qtyOutside);
  const needed = cell(fields, cols.needed);
  const secondaryQty = cols.qtyOutside !== null ? qtyOutside : needed;
  const qtyColsBlank = isBlankQtyCell(qtyStorage) && isBlankQtyCell(secondaryQty);

  if (item === "") {
    return qtyColsBlank ? "filler" : "data";
  }
  if (no === "" && qtyColsBlank && looksLikeKnownHeader(item, cols.headerLabels)) {
    return "header";
  }
  return "data";
}

export interface ParsedRow {
  sourceRow: number; // 1-indexed CSV line number (header row is line 1)
  side: "main" | "supercap";
  item: string; // Ω-repaired, trimmed
  qtyStorageRaw: string;
  /** "Qty outside" (main) or "Needed" (supercap), trimmed raw string. */
  secondaryQtyRaw: string;
  location: string;
  remarks: string;
  category: string;
}

/** Extracts the data rows for one side of the sheet, with category forward-filled from section headers. */
export function extractSideRows(parsed: string[][], cols: SideColumns, side: "main" | "supercap"): ParsedRow[] {
  let category = "Uncategorized";
  const out: ParsedRow[] = [];

  for (let i = 1; i < parsed.length; i++) {
    const fields = parsed[i];
    const sourceRow = i + 1;
    const kind = classifyRowKind(fields, cols);

    if (kind === "filler") continue;
    if (kind === "header") {
      category = cell(fields, cols.item);
      continue;
    }

    const item = repairOmegaMangling(cell(fields, cols.item));
    const qtyStorageRaw = cell(fields, cols.qtyStorage);
    const secondaryQtyRaw = cols.qtyOutside !== null ? cell(fields, cols.qtyOutside) : cell(fields, cols.needed);
    const location = cell(fields, cols.location);
    const remarks = cell(fields, cols.remarks);

    out.push({ sourceRow, side, item, qtyStorageRaw, secondaryQtyRaw, location, remarks, category });
  }

  return out;
}

// ---------------------------------------------------------------------------
// Step 5: tier classification.
// ---------------------------------------------------------------------------

export type Tier = "asset" | "bulk" | "loose";

const LOOSE_QTY_RE = /a lot|sticks?|>\s*\d+|tub/i;
// "Assembled parts (for robomaster stuff see other tabs)" and "Tools" (whose
// header cell is literally "Tools") both start with these prefixes.
const ASSET_CATEGORY_PREFIXES = ["assembled parts", "tools"];
// docs/catalog-migration.md's tier table: standalone driver/tester boards
// live inside "Components through hole" (rows 49-168) but are asset-tier,
// specifically rows 123-153.
const ASSET_ROW_RANGE = { min: 123, max: 153 };

export function classifyTier(row: ParsedRow): Tier {
  if (LOOSE_QTY_RE.test(row.qtyStorageRaw) || LOOSE_QTY_RE.test(row.secondaryQtyRaw)) {
    return "loose";
  }
  if (row.side === "main") {
    const categoryLower = row.category.toLowerCase();
    if (ASSET_CATEGORY_PREFIXES.some((prefix) => categoryLower.startsWith(prefix))) {
      return "asset";
    }
    if (row.sourceRow >= ASSET_ROW_RANGE.min && row.sourceRow <= ASSET_ROW_RANGE.max) {
      return "asset";
    }
  }
  return "bulk";
}

// ---------------------------------------------------------------------------
// Step 6: resistor-book name + spec normalization.
// Scope: rows whose Location is exactly "book" (the resistor book, rows
// 355-512). Anything that doesn't cleanly parse is left alone and flagged,
// never guessed at.
// ---------------------------------------------------------------------------

export interface ResistorSpec {
  value: string;
  package: string;
  type: "resistor";
}

export interface ResistorParseResult {
  name: string;
  spec: ResistorSpec;
}

function buildResistor(value: string, pkg: string): ResistorParseResult {
  return {
    name: `Resistor ${value}Ω ${pkg}`,
    spec: { value, package: pkg, type: "resistor" },
  };
}

export function isResistorBookRow(row: ParsedRow): boolean {
  return row.location.toLowerCase() === "book";
}

/**
 * Attempts to parse a resistor-book item (already Ω-repaired) into a
 * {name, spec} pair. Returns null if it doesn't cleanly match a known shape
 * — callers must flag null results rather than guess.
 */
export function tryParseResistorBookItem(item: string): ResistorParseResult | null {
  const trimmed = item.trim();

  // "R <pkg> <value> ohm" e.g. "R 0402 0 ohm"
  let m = /^R\s+(\d{3,4})\s+(\d+(?:\.\d+)?)\s*ohm$/i.exec(trimmed);
  if (m) {
    const [, pkg, value] = m;
    return buildResistor(value, pkg);
  }

  // "<pkg> <value>[k|M][Ω]" e.g. "402 2.7Ω"
  m = /^(\d{3,4})\s+(\d+(?:\.\d+)?)(k|M)?Ω?$/i.exec(trimmed);
  if (m) {
    const [, pkg, value, mult] = m;
    return buildResistor(`${value}${mult ?? ""}`, pkg);
  }

  // Bare value, optionally with a k/M multiplier and/or trailing Ω, e.g.
  // "10kΩ", "1.2Ω", "1M", "110k".
  m = /^(\d+(?:\.\d+)?)(k|M)?Ω?$/i.exec(trimmed);
  if (m) {
    const [, value, mult] = m;
    return buildResistor(`${value}${mult ?? ""}`, "0402");
  }

  return null;
}

// ---------------------------------------------------------------------------
// Step 7: review-CSV row building + flag heuristics.
// ---------------------------------------------------------------------------

const NUMERIC_QTY_RE = /^\d+(?:\.\d+)?$/;

export function isNumericQtyString(value: string): boolean {
  return value === "" || NUMERIC_QTY_RE.test(value);
}

/**
 * "Looks unidentifiable" heuristic: a bare number as the whole name, an
 * explicit "unknown"/"thingy" marker, an ambiguous "<N>m resistor" (milli or
 * mega?), or "resistor <bare number>" with no unit at all.
 */
export function isUnidentifiableName(name: string): boolean {
  const trimmed = name.trim();
  if (trimmed === "") return true;
  if (/^\d+$/.test(trimmed)) return true;
  if (/unknown|thingy/i.test(trimmed)) return true;
  if (/^\d+\s*m\s+resistor$/i.test(trimmed)) return true;
  if (/resistor\s+\d+$/i.test(trimmed)) return true;
  return false;
}

/** Capacitors mislabelled with "Resistor" in the name (rows 342-344): name says "Resistor" but carries a capacitance unit. */
export function isMislabeledAsResistor(name: string): boolean {
  return /resistor/i.test(name) && /\d+(?:\.\d+)?\s?[uµnp]F/i.test(name);
}

export interface ReviewRow {
  source_row: number;
  proposed_name: string;
  proposed_tier: Tier;
  proposed_category: string;
  proposed_spec_json: string;
  flag: boolean;
  flag_reason: string;
}

const REVIEW_CSV_HEADER = [
  "source_row",
  "proposed_name",
  "proposed_tier",
  "proposed_category",
  "proposed_spec_json",
  "flag",
  "flag_reason",
];

/** Builds review rows (without cross-row duplicate detection yet) from the parsed, tier-classified rows. */
export function buildReviewRows(rows: ParsedRow[]): ReviewRow[] {
  return rows.map((row) => {
    const reasons: string[] = [];

    let proposedName = row.item;
    let specJson = "";

    if (isResistorBookRow(row)) {
      const parsed = tryParseResistorBookItem(row.item);
      if (parsed) {
        proposedName = parsed.name;
        specJson = JSON.stringify(parsed.spec);
      } else {
        reasons.push(`resistor book value "${row.item}" did not match a known value/package pattern`);
      }
    }

    if (!isNumericQtyString(row.qtyStorageRaw)) {
      reasons.push(`non-numeric quantity: "${row.qtyStorageRaw}"`);
    }
    if (!isNumericQtyString(row.secondaryQtyRaw)) {
      reasons.push(`non-numeric quantity (outside/needed): "${row.secondaryQtyRaw}"`);
    }

    if (isUnidentifiableName(proposedName)) {
      reasons.push(`name "${proposedName}" looks unidentifiable`);
    }

    if (isMislabeledAsResistor(proposedName)) {
      reasons.push(`name "${proposedName}" contains "Resistor" but carries a capacitance unit — likely mislabeled`);
    }

    if (proposedName.includes("?")) {
      reasons.push(`name still contains an unresolved "?" after encoding repair`);
    }

    return {
      source_row: row.sourceRow,
      proposed_name: proposedName,
      proposed_tier: classifyTier(row),
      proposed_category: row.category,
      proposed_spec_json: specJson,
      flag: reasons.length > 0,
      flag_reason: reasons.join("; "),
    };
  });
}

/** Flags every member of a (proposed_name, proposed_category) group of size >= 2 as a probable duplicate, in place. */
export function flagDuplicates(reviewRows: ReviewRow[]): void {
  const groups = new Map<string, ReviewRow[]>();
  for (const row of reviewRows) {
    const key = `${row.proposed_name.trim().toLowerCase()}|${row.proposed_category.trim().toLowerCase()}`;
    const group = groups.get(key);
    if (group) {
      group.push(row);
    } else {
      groups.set(key, [row]);
    }
  }

  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const row of group) {
      row.flag = true;
      const reason = `duplicate name+category combo (${group.length} rows: source_row ${group
        .map((r) => r.source_row)
        .join(", ")})`;
      row.flag_reason = row.flag_reason ? `${row.flag_reason}; ${reason}` : reason;
    }
  }
}

export function reviewRowsToCsv(reviewRows: ReviewRow[]): string {
  const lines = [toCsvLine(REVIEW_CSV_HEADER)];
  for (const row of reviewRows) {
    lines.push(
      toCsvLine([
        String(row.source_row),
        row.proposed_name,
        row.proposed_tier,
        row.proposed_category,
        row.proposed_spec_json,
        row.flag ? "TRUE" : "FALSE",
        row.flag_reason,
      ]),
    );
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Orchestration.
// ---------------------------------------------------------------------------

export interface ImportSummary {
  totalRawRows: number;
  mainDataRows: number;
  supercapDataRows: number;
  totalDataRows: number;
  flaggedRows: number;
}

export function runImportOnText(csvText: string): { reviewRows: ReviewRow[]; summary: ImportSummary; csv: string } {
  const parsed = parseCsv(csvText);
  const totalRawRows = parsed.length;

  const mainRows = extractSideRows(parsed, MAIN_COLUMNS, "main");
  const supercapRows = extractSideRows(parsed, SUPERCAP_COLUMNS, "supercap");

  const allParsedRows = [...mainRows, ...supercapRows].sort((a, b) => {
    if (a.sourceRow !== b.sourceRow) return a.sourceRow - b.sourceRow;
    // Deterministic tie-break: main before supercap on the same line.
    return a.side === b.side ? 0 : a.side === "main" ? -1 : 1;
  });

  const reviewRows = buildReviewRows(allParsedRows);
  flagDuplicates(reviewRows);

  const summary: ImportSummary = {
    totalRawRows,
    mainDataRows: mainRows.length,
    supercapDataRows: supercapRows.length,
    totalDataRows: allParsedRows.length,
    flaggedRows: reviewRows.filter((r) => r.flag).length,
  };

  return { reviewRows, summary, csv: reviewRowsToCsv(reviewRows) };
}

export function runImport(csvPath: string, outPath: string): ImportSummary {
  const csvText = readFileSync(csvPath, "utf-8");
  const { summary, csv } = runImportOnText(csvText);

  const outDir = path.dirname(outPath);
  if (!existsSync(outDir)) {
    mkdirSync(outDir, { recursive: true });
  }
  writeFileSync(outPath, csv, "utf-8");

  return summary;
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------

const DEFAULT_CSV_PATH = path.resolve(
  process.cwd(),
  "data/RoboMaster_Inventory_3_Sheets(Electrical Parts).csv",
);
const DEFAULT_OUT_PATH = path.resolve(process.cwd(), "scripts/out/catalog-review.csv");

function main() {
  const [, , csvArg, outArg] = process.argv;
  const csvPath = csvArg ? path.resolve(process.cwd(), csvArg) : DEFAULT_CSV_PATH;
  const outPath = outArg ? path.resolve(process.cwd(), outArg) : DEFAULT_OUT_PATH;

  if (!existsSync(csvPath)) {
    console.error(`import-catalog: source CSV not found at ${csvPath}`);
    process.exit(1);
  }

  const summary = runImport(csvPath, outPath);

  console.log(
    `parsed ${summary.totalDataRows} of ${summary.totalRawRows} raw rows ` +
      `(main: ${summary.mainDataRows}, supercap: ${summary.supercapDataRows})`,
  );
  console.log(`flagged ${summary.flaggedRows} of ${summary.totalDataRows} rows for human review`);
  console.log(`wrote ${outPath}`);
  console.log(
    "\nThis is a review CSV only — no writes to Supabase or products/stock_movements " +
      "were made. A bench-literate reviewer must walk this file against the shelves " +
      "before any real import (see docs/catalog-migration.md).",
  );
}

const isMainModule = (() => {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMainModule) {
  main();
}
