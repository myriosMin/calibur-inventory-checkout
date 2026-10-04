/**
 * CSV exports for backup and committee handover.
 *
 * `architecture.md`'s open question: *"Do we want Supabase's own backups, or
 * a periodic CSV export for the club's peace of mind? The latter is cheap
 * and makes the committee more comfortable about depending on a hosted
 * service."* This is that export, and the reassurance it buys is specific:
 * a committee member can download three files, open them in the spreadsheet
 * they came from, and see that nothing is locked inside someone's account.
 *
 * Three files rather than one, because they answer the three questions the
 * club would actually need answered if this app vanished tomorrow: what
 * parts exist, where they are right now, and how they got there.
 *
 * Escaping and line assembly come from `src/lib/csv/parse.ts` — the same
 * primitives the catalog importer uses. There is exactly one CSV writer in
 * this repo and this is not a second one.
 */

import { toCsvLine } from "@/lib/csv/parse";

function assemble(header: readonly string[], rows: readonly (readonly string[])[]): string {
  // Trailing newline: POSIX text-file convention, and it stops the last row
  // from merging with whatever a naive `cat` appends.
  return [toCsvLine([...header]), ...rows.map((row) => toCsvLine([...row]))].join("\n") + "\n";
}

function num(value: number | null | undefined): string {
  return value === null || value === undefined ? "" : String(value);
}

function text(value: string | null | undefined): string {
  return value ?? "";
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

export interface CatalogExportRow {
  id: string;
  name: string;
  tier: string;
  category: string | null;
  unit: string;
  partNumber: string | null;
  locationName: string | null;
  minStock: number | null;
  returnable: boolean;
  active: boolean;
  qtyInStore: number | null;
  qtyOut: number | null;
  /** Active product label, so a reprint does not need the database. */
  code: string | null;
  unitCostSgd?: number | null;
  /** products.expensive (0028). Appended last so earlier columns keep their place. */
  expensive?: boolean;
}

export const CATALOG_CSV_HEADER = [
  "product_id",
  "name",
  "tier",
  "category",
  "unit",
  "part_number",
  "location",
  "min_stock",
  "returnable",
  "active",
  "qty_in_store",
  "qty_out",
  "scan_code",
  "unit_cost_sgd",
  "expensive",
] as const;

export function buildCatalogCsv(rows: readonly CatalogExportRow[]): string {
  return assemble(
    CATALOG_CSV_HEADER,
    rows.map((row) => [
      row.id,
      row.name,
      row.tier,
      text(row.category),
      row.unit,
      text(row.partNumber),
      text(row.locationName),
      num(row.minStock),
      row.returnable ? "yes" : "no",
      row.active ? "yes" : "no",
      num(row.qtyInStore),
      num(row.qtyOut),
      text(row.code),
      num(row.unitCostSgd ?? null),
      row.expensive ? "yes" : "no",
    ]),
  );
}

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export interface HoldingsExportRow {
  holderKind: string;
  holderName: string;
  productId: string;
  productName: string;
  qty: number;
  unit: string;
  expensive?: boolean;
}

export const HOLDINGS_CSV_HEADER = [
  "holder_kind",
  "holder_name",
  "product_id",
  "product_name",
  "qty",
  "unit",
  "expensive",
] as const;

export function buildHoldingsCsv(rows: readonly HoldingsExportRow[]): string {
  return assemble(
    HOLDINGS_CSV_HEADER,
    rows.map((row) => [
      row.holderKind,
      row.holderName,
      row.productId,
      row.productName,
      String(row.qty),
      row.unit,
      row.expensive ? "yes" : "no",
    ]),
  );
}

// ---------------------------------------------------------------------------
// Movement ledger
// ---------------------------------------------------------------------------

export interface MovementsExportRow {
  id: number;
  createdAt: string;
  productId: string;
  productName: string;
  qty: number;
  unit: string;
  fromHolderName: string;
  toHolderName: string;
  reason: string | null;
  entryMethod: string | null;
  scanCode: string | null;
  actorName: string | null;
  sessionId: string | null;
}

export const MOVEMENTS_CSV_HEADER = [
  "movement_id",
  "created_at",
  "product_id",
  "product_name",
  "qty",
  "unit",
  "from_holder",
  "to_holder",
  "reason",
  "entry_method",
  "scan_code",
  "actor",
  "session_id",
] as const;

export function buildMovementsCsv(rows: readonly MovementsExportRow[]): string {
  return assemble(
    MOVEMENTS_CSV_HEADER,
    rows.map((row) => [
      String(row.id),
      row.createdAt,
      row.productId,
      row.productName,
      String(row.qty),
      row.unit,
      row.fromHolderName,
      row.toHolderName,
      text(row.reason),
      text(row.entryMethod),
      text(row.scanCode),
      text(row.actorName),
      text(row.sessionId),
    ]),
  );
}

/** `calibur-catalog-2026-09-12.csv` — dated, so successive backups do not overwrite. */
export function exportFilename(kind: "catalog" | "holdings" | "movements", isoDate: string): string {
  return `calibur-${kind}-${isoDate}.csv`;
}
