/**
 * Turns one robot sheet of the AY26/27 build budget (data/Calibur_AY2627.xlsx)
 * into build-list lines. Pure: no file or database access, so every judgement
 * call is here and unit-tested (tests/unit/build-lists.test.ts).
 *
 * Sheet layout (all four robot sheets share it):
 *   B category | C part name | D unit price | E qty | F total | G link or supplier
 * Row-only-in-B "Chassis" / "Gimbal" / "Referee" rows start a sub-assembly.
 * A unit price of "Ref Sys" means the part comes from the referee kit.
 *
 * What is NOT read: column A (scratch ticks), H ("N/A"), and the Sentry
 * sheet's column J, which repeats E on every row where it is filled.
 */

export const SEASON = "AY2627";
export const WORKBOOK = "Calibur_AY2627.xlsx";

/** Sheet → build-list name. The other sheets are not build lists:
 *  "Example - Tunnel Omni" and "Template" are scaffolding, the "IRL" sheets
 *  are NUS purchase-request forms (they carry members' student IDs and phone
 *  numbers, and re-total the lines below), and the CF / Alu / DarkNUS sheets
 *  are fabrication cut lists, out of scope by decision (2026-10-04). */
export const BUILD_SHEETS: ReadonlyArray<{ sheet: string; name: string }> = [
  { sheet: "2627 Hero", name: "Hero" },
  { sheet: "2627 Double Yaw Standard", name: "Double Yaw Standard" },
  { sheet: "2627 Double Yaw Sentry", name: "Double Yaw Sentry" },
  { sheet: "Aim bot Trainer", name: "Aimbot Trainer" },
];

export interface SheetRow {
  row: number;
  /** Column A first: cells[1] is column B. Trimmed text. */
  cells: string[];
}

export type Sourcing = "buy" | "referee_kit";

export interface BuildLine {
  position: number;
  section: string | null;
  category: string | null;
  partName: string;
  /** Exact name of the store product, when the line is one. */
  productName: string | null;
  qty: number | null;
  sourcing: Sourcing;
  unitPriceSgd: number | null;
  supplier: string | null;
  supplierUrl: string | null;
  notes: string | null;
  sourceText: string;
  sourceRow: number;
}

export interface ParsedSheet {
  lines: BuildLine[];
  /** Rows dropped or values doubted, for the person running the import. */
  warnings: string[];
}

const SECTIONS = new Set(["chassis", "gimbal", "referee"]);
const REFEREE_PRICE = "ref sys";

const CATEGORY_ALIASES: Record<string, string> = {
  electronic: "Electronics",
  "ref sys": "Referee",
  alu: "Aluminium",
  aluminum: "Aluminium",
  cf: "Carbon fibre",
  fg: "Fibreglass",
};

/** Source text → clearer part name. Applied before product matching. */
const RENAMES: Record<string, string> = {
  "Amor Module AM02 (small)": "Armor Module AM02 (small)",
  "Amor Module AM12 (large)": "Armor Module AM12 (large)",
  "50mm aperture, 119mm outer diameter / 12 channels, 10A": "Slip ring, 50 mm bore, 119 mm OD, 12 ch × 10 A",
  "12路2A，外径22mm": "Slip ring, 12 ch × 2 A, 22 mm OD",
  "Slipring, 12路10A，外径30mm": "Slip ring, 12 ch × 10 A, 30 mm OD",
  gm6020: "GM6020",
  ru66: "RU66 bearing",
};

/** One-off fixes keyed by "sheet!row". */
const ROW_FIXES: Record<string, { partName: string; note: string }> = {
  // Two "Rail Steel" rows, at Hero's carriage (2.70) and rail (1.65) prices.
  "2627 Double Yaw Standard!10": {
    partName: "MGN12C Linear Rail",
    note: "Sheet says 'Rail Steel' on two rows; this one has the carriage price, as on the Hero sheet.",
  },
};

/**
 * Cleaned part name (lowercased) → store product name. Only matches that are
 * unambiguous: "ESC centre board" (center board 1 or 2?), "DJI Battery"
 * (TB47S or TB48S?), "VTM Transmitter" (VT02 or VT03?), "Supercap bank"
 * (new or old?) and "XT30 cables M-F" (long or short?) stay unlinked.
 */
const PRODUCT_MATCHES: Record<string, string> = {
  "c620 motor controller": "DJI C620 ESC",
  "robomaster development board c": "DJI RoboMaster Development Board Type C",
  "robomaster m3508 brushless dc gear motor": "DJI M3508 motor",
  "m3508 without gearbox": "DJI M3508 motor",
  "gm6020": "DJI GM6020 motor",
  "dm-j4310p-2ec": "Damiao DM4310 motor",
  "dm-j4310-2ec v1.1 （24v）": "Damiao DM4310 motor",
  "dm-j4340-2ec v1.1 （24v）": "Damiao DM4340 motor",
  "mg4005-i10 v2 motor": "MG4005 motor",
  "dm3519": "DM3519 motor",
  "jetson orin nx (aimbot)": "NVIDIA Jetson Orin NX",
  "jetson orin agx (aimbot + nav)": "NVIDIA Jetson AGX Orin",
  "hikvision camera mv-cs016-10umuc": "Hikvision industrial camera",
  "intel realsense d435i": "Intel RealSense D435i depth camera",
  "livox mid-360": "Livox LiDAR",
  "wheeltec h30 imu": "H30 IMU",
  "power management module": "DJI referee Power Management Module PM02",
  "main control module mc02": "DJI referee Main Control Module MC02",
  "main controller module": "DJI referee Main Control Module MC02",
  "supercap management module": "DJI referee Supercapacitor Management Module CM01",
  "armor module am02 (small)": "DJI referee Small Armor Module AM02",
  "armor module am12 (large)": "DJI referee Large Armor Module AM12",
  "light indicator module": "DJI referee Light Indicator Module LI01",
  "rfid module": "DJI referee RFID Interaction Module FI02",
  "uv charger": "UV charger",
  "speed monitor module (17mm)": "DJI referee Speed Monitor Module 17mm SM01",
  "17mm speed monitor module": "DJI referee Speed Monitor Module 17mm SM01",
};

/** Matches that depend on the robot: Hero fires 42 mm, everything else 17 mm. */
const SHEET_PRODUCT_MATCHES: Record<string, Record<string, string>> = {
  "2627 Hero": { "speed monitor module": "DJI referee Speed Monitor Module 42mm SM11" },
};

/** Every product name the import expects to find, for a pre-flight check. */
export function expectedProductNames(): string[] {
  const all = [
    ...Object.values(PRODUCT_MATCHES),
    ...Object.values(SHEET_PRODUCT_MATCHES).flatMap((byName) => Object.values(byName)),
  ];
  return [...new Set(all)].sort();
}

export function normalizeCategory(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  return CATEGORY_ALIASES[text.toLowerCase()] ?? text;
}

/** A plain number from a cell, or null. Throws on anything else that is not empty. */
function parseNumber(raw: string, what: string, where: string): number | null {
  const text = raw.trim();
  if (!text) return null;
  const value = Number(text);
  if (!Number.isFinite(value)) throw new Error(`${where}: ${what} "${text}" is not a number`);
  return value;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Taobao and Tmall item links carry the buyer's share and tracking tokens.
 * Only `id` (the listing) and `skuId` (the variant) identify the part.
 */
export function cleanSupplierUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return raw.trim();
  }
  const host = url.hostname;
  if ((host === "item.taobao.com" || host === "detail.tmall.com") && url.searchParams.get("id")) {
    const clean = new URL(`${url.origin}${url.pathname}`);
    clean.searchParams.set("id", url.searchParams.get("id")!);
    const sku = url.searchParams.get("skuId");
    if (sku) clean.searchParams.set("skuId", sku);
    return clean.toString();
  }
  if (host === "www.taobao.com" && url.pathname.startsWith("/list/item/")) {
    return `${url.origin}${url.pathname}`;
  }
  return url.toString();
}

const SUPPLIER_BY_HOST: Record<string, string> = {
  "item.taobao.com": "Taobao",
  "www.taobao.com": "Taobao",
  "e.tb.cn": "Taobao",
  "detail.tmall.com": "Tmall",
  "sg.misumi-ec.com": "MISUMI",
  "sg.cytron.io": "Cytron",
};

/** Column G is either a link or a supplier's name. */
export function splitSupplier(raw: string): { supplier: string | null; supplierUrl: string | null } {
  const text = raw.trim();
  if (!text || text.toUpperCase() === "N/A") return { supplier: null, supplierUrl: null };
  if (/^https?:\/\//i.test(text)) {
    const supplierUrl = cleanSupplierUrl(text);
    let host = "";
    try {
      host = new URL(supplierUrl).hostname;
    } catch {
      // keep host empty
    }
    return { supplier: SUPPLIER_BY_HOST[host] ?? null, supplierUrl };
  }
  return { supplier: text, supplierUrl: null };
}

export function parseBuildSheet(sheet: string, rows: SheetRow[]): ParsedSheet {
  const lines: BuildLine[] = [];
  const warnings: string[] = [];
  let section: string | null = null;

  for (const { row, cells } of rows) {
    const cell = (col: number) => (cells[col] ?? "").trim();
    const category = cell(1);
    const sourceText = cell(2);
    const price = cell(3);
    const qtyText = cell(4);
    const total = cell(5);
    const link = cell(6);
    const where = `${sheet}!${row}`;

    if (row === 1) continue; // header

    if (!sourceText) {
      // A sub-assembly heading has only column B.
      if (SECTIONS.has(category.toLowerCase()) && !price && !qtyText && !total && !link) {
        section = category[0].toUpperCase() + category.slice(1).toLowerCase();
      } else if (qtyText.toLowerCase() === "total") {
        // the sheet's grand-total row
      } else if (qtyText || total.toUpperCase() === "TBD" || (price && price.toLowerCase() !== REFEREE_PRICE)) {
        warnings.push(`${where}: quantity or price with no part name (category "${category}"); skipped`);
      }
      continue;
    }

    const fix = ROW_FIXES[where];
    const partName = fix?.partName ?? RENAMES[sourceText] ?? sourceText;
    const notes: string[] = [];
    if (fix) notes.push(fix.note);

    const referee = price.toLowerCase() === REFEREE_PRICE;
    const unitPrice = referee ? null : parseNumber(price, "unit price", where);
    const qtyValue = parseNumber(qtyText, "quantity", where);
    if (qtyValue !== null && !Number.isInteger(qtyValue)) {
      throw new Error(`${where}: quantity "${qtyText}" is not a whole number`);
    }
    if (total.toUpperCase() === "TBD") notes.push("Price TBD on the sheet.");
    if (qtyValue === null) notes.push("Quantity TBD on the sheet.");

    const totalValue = referee || total.toUpperCase() === "TBD" ? null : Number(total || NaN);
    if (unitPrice !== null && qtyValue !== null && Number.isFinite(totalValue)) {
      if (Math.abs(unitPrice * qtyValue - (totalValue as number)) > 0.01) {
        warnings.push(`${where}: ${unitPrice} × ${qtyValue} ≠ sheet total ${total}`);
      }
    }

    const key = partName.toLowerCase();
    const productName = SHEET_PRODUCT_MATCHES[sheet]?.[key] ?? PRODUCT_MATCHES[key] ?? null;

    lines.push({
      position: lines.length + 1,
      section,
      category: normalizeCategory(category),
      partName,
      productName,
      qty: qtyValue,
      sourcing: referee ? "referee_kit" : "buy",
      unitPriceSgd: unitPrice === null ? null : round2(unitPrice),
      ...splitSupplier(link),
      notes: notes.length ? notes.join(" ") : null,
      sourceText,
      sourceRow: row,
    });
  }

  return { lines, warnings };
}
