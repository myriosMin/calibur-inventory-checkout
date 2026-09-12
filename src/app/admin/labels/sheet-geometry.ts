import { MIN_QR_SYMBOL_MM, symbolSizeMm } from "@/lib/codes/qr";

/**
 * Sticker-sheet geometry, in millimetres, for the batch print run.
 *
 * Everything about a printed sheet is a physical measurement, so every
 * number here is named and lives in one table rather than being sprinkled
 * through the CSS. When the club buys a different sheet -- and they will,
 * because whatever is on the shelf in Bras Basah is what gets bought --
 * retuning is adding one entry below, not hunting for `38.1mm` in a
 * stylesheet.
 *
 * A4 is 210 x 297 mm. For each preset:
 *   columns * cellWidth  + (columns - 1) * columnGap + 2 * marginLeft = 210
 *   rows    * cellHeight + (rows    - 1) * rowGap    + 2 * marginTop  = 297
 * `assertSheetFitsA4` checks exactly that, and the unit tests run it over
 * every preset.
 */

export const A4_WIDTH_MM = 210;
export const A4_HEIGHT_MM = 297;

export interface SheetGeometry {
  id: string;
  /** Shown in the sheet picker. Include the stock code people buy by. */
  name: string;
  columns: number;
  rows: number;
  cellWidthMm: number;
  cellHeightMm: number;
  marginTopMm: number;
  marginLeftMm: number;
  columnGapMm: number;
  rowGapMm: number;
  /**
   * Printed size of the QR box *including* its quiet zone. The scannable
   * symbol is smaller than this -- see `symbolSizeMm` -- which is the
   * trap this field's name exists to avoid.
   */
  qrBoxMm: number;
  cellPaddingMm: number;
  nameFontPt: number;
  metaFontPt: number;
  /** Lines of product name before ellipsis. The code line is never clipped. */
  nameLines: number;
}

export const SHEET_GEOMETRIES: SheetGeometry[] = [
  {
    id: "avery-l7160",
    name: "Avery L7160 — 21 per A4 (63.5 × 38.1 mm)",
    columns: 3,
    rows: 7,
    cellWidthMm: 63.5,
    cellHeightMm: 38.1,
    marginTopMm: 15.15,
    marginLeftMm: 7.25,
    columnGapMm: 2.5,
    rowGapMm: 0,
    qrBoxMm: 25.8,
    cellPaddingMm: 1.2,
    nameFontPt: 7.5,
    metaFontPt: 7,
    nameLines: 2,
  },
  {
    id: "avery-l7163",
    name: "Avery L7163 — 14 per A4 (99.1 × 38.1 mm)",
    columns: 2,
    rows: 7,
    cellWidthMm: 99.1,
    cellHeightMm: 38.1,
    marginTopMm: 15.15,
    marginLeftMm: 4.65,
    columnGapMm: 2.5,
    rowGapMm: 0,
    qrBoxMm: 25.8,
    cellPaddingMm: 1.2,
    nameFontPt: 8,
    metaFontPt: 7.5,
    nameLines: 2,
  },
  {
    id: "avery-l7165",
    name: "Avery L7165 — 8 per A4 (99.1 × 67.7 mm)",
    columns: 2,
    rows: 4,
    cellWidthMm: 99.1,
    cellHeightMm: 67.7,
    marginTopMm: 13.1,
    marginLeftMm: 4.65,
    columnGapMm: 2.5,
    rowGapMm: 0,
    // Tier A shelving and large bins: a bigger symbol reads from further
    // back, which is the whole point of labelling a shelf rather than a bin.
    qrBoxMm: 42,
    cellPaddingMm: 2,
    nameFontPt: 11,
    metaFontPt: 9.5,
    nameLines: 3,
  },
];

export const DEFAULT_SHEET_ID = SHEET_GEOMETRIES[0].id;

export function findSheetGeometry(id: string): SheetGeometry {
  return SHEET_GEOMETRIES.find((g) => g.id === id) ?? SHEET_GEOMETRIES[0];
}

export function labelsPerSheet(geometry: SheetGeometry): number {
  return geometry.columns * geometry.rows;
}

/** Splits labels into one array per printed page. */
export function paginate<T>(items: T[], perPage: number): T[][] {
  if (perPage <= 0) return items.length ? [items] : [];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) {
    pages.push(items.slice(i, i + perPage));
  }
  return pages;
}

export interface SheetFit {
  usedWidthMm: number;
  usedHeightMm: number;
  /** Within a tenth of a millimetre of A4 in both directions. */
  fitsA4: boolean;
}

export function measureSheet(geometry: SheetGeometry): SheetFit {
  const usedWidthMm =
    geometry.columns * geometry.cellWidthMm +
    (geometry.columns - 1) * geometry.columnGapMm +
    2 * geometry.marginLeftMm;
  const usedHeightMm =
    geometry.rows * geometry.cellHeightMm +
    (geometry.rows - 1) * geometry.rowGapMm +
    2 * geometry.marginTopMm;
  return {
    usedWidthMm,
    usedHeightMm,
    fitsA4:
      Math.abs(usedWidthMm - A4_WIDTH_MM) <= 0.1 &&
      Math.abs(usedHeightMm - A4_HEIGHT_MM) <= 0.1,
  };
}

/**
 * Height the label text gets after the QR box and padding are taken out.
 * Negative or near-zero means the chosen QR box has eaten the cell and the
 * human-readable line -- the one thing docs/tele-qr/qr-labels.md says has
 * "no exceptions" -- would be clipped.
 */
export function textAreaHeightMm(geometry: SheetGeometry): number {
  return geometry.cellHeightMm - geometry.qrBoxMm - 2 * geometry.cellPaddingMm;
}

export interface GeometryWarning {
  id: string;
  message: string;
}

/**
 * Physical sanity checks for a preset, surfaced in the UI rather than
 * assumed. All three of these are mistakes that only show up on paper.
 */
export function checkGeometry(
  geometry: SheetGeometry,
  moduleCount: number,
): GeometryWarning[] {
  const warnings: GeometryWarning[] = [];

  const fit = measureSheet(geometry);
  if (!fit.fitsA4) {
    warnings.push({
      id: "a4",
      message: `This sheet lays out ${fit.usedWidthMm.toFixed(1)} × ${fit.usedHeightMm.toFixed(1)} mm, which is not A4 (${A4_WIDTH_MM} × ${A4_HEIGHT_MM} mm). Labels will drift out of alignment down the page.`,
    });
  }

  const symbol = symbolSizeMm(geometry.qrBoxMm, moduleCount);
  if (symbol < MIN_QR_SYMBOL_MM) {
    warnings.push({
      id: "qr-size",
      message: `QR symbol prints at ${symbol.toFixed(1)} mm, under the ${MIN_QR_SYMBOL_MM} mm minimum. It will be unreliable to scan at arm's length.`,
    });
  }

  // 1 pt = 1/72 inch = 0.3528 mm; allow a line and a half of leading.
  const minTextMm = ((geometry.nameFontPt + geometry.metaFontPt) * 25.4) / 72;
  if (textAreaHeightMm(geometry) < minTextMm) {
    warnings.push({
      id: "text-room",
      message: `Only ${textAreaHeightMm(geometry).toFixed(1)} mm is left under the QR for text, which will not fit the name and code lines. Shrink qrBoxMm for this sheet.`,
    });
  }

  return warnings;
}
