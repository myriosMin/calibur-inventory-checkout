/**
 * Loaders for the raw inventory sources. Read-only: nothing here writes
 * anywhere or interprets a value -- every cell comes back as trimmed text so
 * the judgement calls all live in rules.ts / curation.ts where they can be
 * reviewed.
 *
 * Sources (all under data/, which is gitignored):
 *   RoboMaster_Inventory_3_Sheets.xlsx
 *     - "Electrical Parts"          main table A-G + side table I-N
 *     - "High Value Items"          summary A-B + per-unit register E-N
 *     - "Referee System Inventory"  summary A-B + per-unit register E-N
 *     - "Robot-Specific View"       per-robot counts, carried forward 16 Dec 2025
 *   db/*.csv  -- exports of the legacy checkout app (Jul-Sep 2026)
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import ExcelJS from "exceljs";

import { parseCsv } from "../../src/lib/csv/parse";

export const XLSX_PATH = "data/RoboMaster_Inventory_3_Sheets.xlsx";
export const LEGACY_DIR = "data/db";

export const SHEET_ELECTRICAL = "Electrical Parts";
export const SHEET_HIGH_VALUE = "High Value Items";
export const SHEET_REFEREE = "Referee System Inventory";
export const SHEET_ROBOT_VIEW = "Robot-Specific View";

/** Any exceljs cell value as trimmed text. Dates become YYYY-MM-DD. */
export function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((part) => part.text).join("").trim();
    if ("result" in value) return cellText((value.result ?? null) as ExcelJS.CellValue);
    if ("text" in value) return String(value.text).trim();
    return "";
  }
  return String(value).trim();
}

function reader(ws: ExcelJS.Worksheet, rowNumber: number) {
  const row = ws.getRow(rowNumber);
  return (col: number) => cellText(row.getCell(col).value);
}

// ---------------------------------------------------------------------------
// Electrical Parts
// ---------------------------------------------------------------------------

export interface ElectricalMainRow {
  row: number;
  section: string;
  item: string;
  qtyStorage: string;
  qtyOutside: string;
  location: string;
  remarks: string;
}

export interface ElectricalSideRow {
  row: number;
  section: string;
  item: string;
  qtyStorage: string;
  needed: string;
  location: string;
  remarks: string;
}

const MAIN_SECTION_PREFIXES = [
  "connectors",
  "components through hole",
  "assembled parts",
  "wires",
  "smd",
  "tools",
];
const SIDE_SECTIONS = ["supercapacitor controller parts", "capacitor bank parts"];

function readElectrical(ws: ExcelJS.Worksheet) {
  const main: ElectricalMainRow[] = [];
  const side: ElectricalSideRow[] = [];
  let section = "";
  let sideSection = "";

  for (let r = 2; r <= ws.rowCount; r++) {
    const c = reader(ws, r);

    // Main table, columns A-G. Section headers have a blank No. and no
    // quantities (the Tools header has a stray "Qty" in column C).
    const item = c(2);
    const qtyStorage = c(3);
    const qtyOutside = c(4);
    const isHeader =
      c(1) === "" &&
      (qtyStorage === "" || /^qty$/i.test(qtyStorage)) &&
      qtyOutside === "" &&
      MAIN_SECTION_PREFIXES.some((prefix) => item.toLowerCase().startsWith(prefix));
    if (isHeader) {
      section = item.replace(/\s*\(.*\)\s*$/, "").trim();
    } else if (item) {
      main.push({ row: r, section, item, qtyStorage, qtyOutside, location: c(6), remarks: c(7) });
    }

    // Side table, columns I-N: two BOM-ish lists with their own headers.
    const sideItem = c(10);
    const needed = c(12);
    if (SIDE_SECTIONS.includes(sideItem.toLowerCase()) && c(11) === "" && needed === "") {
      sideSection = sideItem;
    } else if (sideItem || needed) {
      side.push({
        row: r,
        section: sideSection,
        item: sideItem,
        qtyStorage: c(11),
        needed,
        location: c(13),
        remarks: c(14),
      });
    }
  }
  return { main, side };
}

// ---------------------------------------------------------------------------
// High Value Items / Referee System Inventory
// ---------------------------------------------------------------------------

export interface SummaryRow {
  sheet: string;
  row: number;
  name: string;
  total: string;
}

export interface UnitRow {
  sheet: string;
  row: number;
  category: string;
  componentId: string;
  serial: string;
  location: string;
  poc: string;
  lastChecked: string;
  functioning: string;
  remarks: string;
  labelled: string;
  allocationTag: string;
}

function readRegister(ws: ExcelJS.Worksheet) {
  const summary: SummaryRow[] = [];
  const units: UnitRow[] = [];
  let summaryDone = false;

  for (let r = 3; r <= ws.rowCount; r++) {
    const c = reader(ws, r);
    if (!summaryDone) {
      const name = c(1);
      if (/^total$/i.test(name)) summaryDone = true;
      else if (name) summary.push({ sheet: ws.name, row: r, name, total: c(2) });
    }
    const category = c(5);
    if (category) {
      units.push({
        sheet: ws.name,
        row: r,
        category,
        componentId: c(6),
        serial: c(7),
        location: c(8),
        poc: c(9),
        lastChecked: c(10),
        functioning: c(11),
        remarks: c(12),
        labelled: c(13),
        allocationTag: c(14),
      });
    }
  }
  return { summary, units };
}

// ---------------------------------------------------------------------------
// Robot-Specific View
// ---------------------------------------------------------------------------

export interface RobotViewRow {
  row: number;
  robot: string;
  /** Column header -> raw cell ("6", "need 4", ""). */
  counts: Record<string, string>;
}

function readRobotView(ws: ExcelJS.Worksheet) {
  const header = reader(ws, 4);
  const columns: string[] = [];
  for (let col = 2; col <= 20; col++) columns.push(header(col).replace(/\s+/g, " "));

  const rows: RobotViewRow[] = [];
  for (let r = 5; r <= ws.rowCount; r++) {
    const c = reader(ws, r);
    const robot = c(1);
    if (!robot || /^total$/i.test(robot)) break;
    const counts: Record<string, string> = {};
    columns.forEach((name, i) => {
      counts[name] = c(i + 2);
    });
    rows.push({ row: r, robot, counts });
  }
  return { columns, rows };
}

// ---------------------------------------------------------------------------
// Legacy checkout app exports
// ---------------------------------------------------------------------------

export interface LegacyItem {
  id: string;
  name: string;
  group_name: string;
  category: string;
  total: number;
  checked_out: number;
  notes: string;
  created_at: string;
  faulty_qty: number;
  lost_qty: number;
}

export interface LegacyBorrow {
  id: string;
  item_id: string;
  item_name: string;
  person_id: string;
  person_name: string;
  qty_out: number;
  qty_returned: number;
  status: string;
  checked_out_at: string;
  returned_at: string;
}

export interface LegacyProfile {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

export interface LegacyLog {
  id: string;
  timestamp: string;
  person_name: string;
  action: string;
  item_id: string;
  item_name: string;
  qty: number;
  note: string;
}

function readCsvObjects(file: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(readFileSync(file, "utf-8"));
  return rows
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells) => Object.fromEntries(header.map((name, i) => [name, cells[i] ?? ""])));
}

const num = (value: string) => (value.trim() === "" ? 0 : Number(value));

// ---------------------------------------------------------------------------

export interface Sources {
  electrical: ReturnType<typeof readElectrical>;
  highValue: ReturnType<typeof readRegister>;
  referee: ReturnType<typeof readRegister>;
  robotView: ReturnType<typeof readRobotView>;
  legacy: {
    items: LegacyItem[];
    borrows: LegacyBorrow[];
    profiles: LegacyProfile[];
    logs: LegacyLog[];
  };
}

export async function loadSources(root: string): Promise<Sources> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(path.join(root, XLSX_PATH));
  const sheet = (name: string) => {
    const ws = workbook.getWorksheet(name);
    if (!ws) throw new Error(`worksheet "${name}" not found in ${XLSX_PATH}`);
    return ws;
  };

  const legacy = (file: string) => readCsvObjects(path.join(root, LEGACY_DIR, file));

  return {
    electrical: readElectrical(sheet(SHEET_ELECTRICAL)),
    highValue: readRegister(sheet(SHEET_HIGH_VALUE)),
    referee: readRegister(sheet(SHEET_REFEREE)),
    robotView: readRobotView(sheet(SHEET_ROBOT_VIEW)),
    legacy: {
      items: legacy("items_rows.csv").map((r) => ({
        id: r.id,
        name: r.name,
        group_name: r.group_name,
        category: r.category,
        total: num(r.total),
        checked_out: num(r.checked_out),
        notes: r.notes,
        created_at: r.created_at,
        faulty_qty: num(r.faulty_qty),
        lost_qty: num(r.lost_qty),
      })),
      borrows: legacy("borrows_rows.csv").map((r) => ({
        id: r.id,
        item_id: r.item_id,
        item_name: r.item_name,
        person_id: r.person_id,
        person_name: r.person_name,
        qty_out: num(r.qty_out),
        qty_returned: num(r.qty_returned),
        status: r.status,
        checked_out_at: r.checked_out_at,
        returned_at: r.returned_at,
      })),
      profiles: legacy("profiles_rows.csv").map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        role: r.role,
        created_at: r.created_at,
      })),
      logs: legacy("logs_rows.csv").map((r) => ({
        id: r.id,
        timestamp: r.timestamp,
        person_name: r.person_name,
        action: r.action,
        item_id: r.item_id,
        item_name: r.item_name,
        qty: num(r.qty),
        note: r.note,
      })),
    },
  };
}
