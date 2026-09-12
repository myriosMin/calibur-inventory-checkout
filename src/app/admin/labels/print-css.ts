import type { SheetGeometry } from "./sheet-geometry";
import { A4_HEIGHT_MM, A4_WIDTH_MM } from "./sheet-geometry";

/**
 * Class the page puts on `<body>` while it is mounted. The admin chrome
 * (nav header, page padding) lives in src/app/admin/layout.tsx, which this
 * page does not own and must not edit -- so the print rules reach it from
 * here, scoped to this class, and every other admin page prints exactly as
 * it did before.
 */
export const PRINT_BODY_CLASS = "labels-printing";

/** Anything inside the labels page that must not reach paper. */
export const SCREEN_ONLY_CLASS = "labels-screen-only";

/**
 * Builds the stylesheet for one sheet geometry.
 *
 * Generated rather than written by hand because every length in it is a
 * physical measurement that belongs to the chosen sheet (see
 * ./sheet-geometry.ts). Millimetres are used throughout: CSS `mm` is an
 * absolute unit that print renderers honour, so a cell declared 63.5 mm
 * wide comes off a laser printer 63.5 mm wide, at any printer resolution.
 */
export function sheetPrintCss(geometry: SheetGeometry): string {
  return `
/* --- print page setup ------------------------------------------------ */
@page {
  size: A4 portrait;
  /* Zero here on purpose: the page margin is applied as padding on
     .labels-page instead, so that *every* page (not just the first) starts
     its grid at the same offset, which is what keeps sheet 12 of 24 in
     register with the die-cut stock. */
  margin: 0;
}

/* --- the sheet ------------------------------------------------------- */
.labels-page {
  box-sizing: border-box;
  width: ${A4_WIDTH_MM}mm;
  height: ${A4_HEIGHT_MM}mm;
  padding: ${geometry.marginTopMm}mm 0 0 ${geometry.marginLeftMm}mm;
  background: #ffffff;
  color: #000000;
  /* Pinned rather than inherited from the admin theme's webfont: if
     Rajdhani/Space Grotesk hasn't loaded at the moment Print is pressed,
     the fallback metrics differ enough to reflow an 7.5pt name into a
     third line and clip it. A system stack always has metrics. */
  font-family: ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif;
  display: grid;
  grid-template-columns: repeat(${geometry.columns}, ${geometry.cellWidthMm}mm);
  grid-auto-rows: ${geometry.cellHeightMm}mm;
  column-gap: ${geometry.columnGapMm}mm;
  row-gap: ${geometry.rowGapMm}mm;
  align-content: start;
  /* Browsers drop backgrounds when printing to save ink. These labels are
     black-on-white by design, but the white has to actually print white --
     otherwise the QR sits on whatever the sheet's own tint is and the
     scanner loses contrast. */
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* --- one label ------------------------------------------------------- */
.labels-cell {
  box-sizing: border-box;
  overflow: hidden;
  padding: ${geometry.cellPaddingMm}mm;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  background: #ffffff;
  color: #000000;
  /* A label split across two sheets is a wasted sticker and a wasted bin. */
  break-inside: avoid;
  page-break-inside: avoid;
}

.labels-qr {
  display: block;
  flex: 0 0 auto;
  width: ${geometry.qrBoxMm}mm;
  height: ${geometry.qrBoxMm}mm;
}

.labels-text {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  width: 100%;
}

.labels-name {
  font-size: ${geometry.nameFontPt}pt;
  line-height: 1.12;
  font-weight: 600;
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: ${geometry.nameLines};
  overflow-wrap: anywhere;
}

.labels-hint {
  font-size: ${(geometry.metaFontPt * 0.9).toFixed(2)}pt;
  line-height: 1.1;
  font-style: italic;
}

/* margin-top:auto pins the code line to the bottom of the cell, so a long
   product name eats into its own clamped area and never pushes the one
   piece of text a person actually needs off the sticker. */
.labels-meta {
  margin-top: auto;
  flex: 0 0 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: ${geometry.metaFontPt}pt;
  line-height: 1.12;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

/* --- screen preview -------------------------------------------------- */
@media screen {
  .labels-page {
    margin: 0 auto 1rem;
    box-shadow: 0 0 0 1px #262626;
  }
  /* Die-cut edges are invisible on screen; a hairline makes it obvious when
     a name is being clipped or a cell is overflowing before anything is
     committed to sticker stock. */
  .labels-cell {
    outline: 1px dashed #d4d4d4;
    outline-offset: -1px;
  }
}

/* --- print ----------------------------------------------------------- */
@media print {
  html,
  body.${PRINT_BODY_CLASS} {
    margin: 0 !important;
    padding: 0 !important;
    background: #ffffff !important;
  }
  /* Admin nav, sign-out, and the max-w-5xl content gutter all belong to
     src/app/admin/layout.tsx. */
  body.${PRINT_BODY_CLASS} header,
  body.${PRINT_BODY_CLASS} .${SCREEN_ONLY_CLASS} {
    display: none !important;
  }
  body.${PRINT_BODY_CLASS} main {
    max-width: none !important;
    margin: 0 !important;
    padding: 0 !important;
  }
  .labels-page {
    margin: 0 !important;
    box-shadow: none !important;
    break-after: page;
    page-break-after: always;
  }
  .labels-page:last-child {
    break-after: auto;
    page-break-after: auto;
  }
}
`.trim();
}
