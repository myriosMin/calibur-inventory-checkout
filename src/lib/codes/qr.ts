import QRCode from "qrcode";

/**
 * QR symbol -> SVG path, using the `qrcode` package (MIT) purely as an
 * encoder and doing our own rendering.
 *
 * Why not `QRCode.toString(..., { type: "svg" })`: that emits a whole
 * `<svg>` document string we would have to inject with
 * `dangerouslySetInnerHTML`, sized in pixels, with its own attributes.
 * `QRCode.create()` is synchronous (no effect/loading state in React) and
 * hands back the raw module matrix, which lets us emit one `<path>` inside
 * a React-owned `<svg>` with a module-unit viewBox -- so the same element
 * is resolution-independent whether it is a 24 px preview on screen or a
 * 20 mm symbol on polyester at 600 dpi.
 *
 * Why not hand-roll the encoder: Reed-Solomon ECC, mask-pattern selection
 * and version/capacity tables are exactly the kind of code that is subtly
 * wrong in a way you discover only after sticking 500 labels on 500 bins.
 */

/**
 * Quiet zone required by ISO/IEC 18004: four modules of blank on every
 * side. It is part of the symbol as far as a scanner is concerned, so it
 * lives inside the viewBox -- a label cell that clips it, or a coloured
 * background that bleeds into it, breaks the scan.
 */
export const QR_QUIET_ZONE_MODULES = 4;

/** Error correction level. L is right here: the link is short, the label is
 *  small, and higher levels only inflate the module count (see
 *  docs/tele-qr/qr-labels.md "Printing and materials"). */
export const QR_ERROR_CORRECTION = "L" as const;

export interface QrSymbol {
  /** SVG path data for every dark module. */
  path: string;
  /** Modules per side of the symbol itself, excluding the quiet zone. */
  moduleCount: number;
  /** Modules per side including the quiet zone -- i.e. the viewBox extent. */
  extent: number;
  /** `0 0 extent extent`, ready for an <svg viewBox>. */
  viewBox: string;
  /** QR version the encoder picked. 3 or lower is the target. */
  version: number;
}

/**
 * Encodes `text` and returns the geometry needed to draw it.
 *
 * The path is one `M x y h1 v1 h-1 z` subpath per dark module. Adjacent
 * modules share edges, which renders as a solid block without seams at any
 * scale, and a single `<path>` keeps a 29x29 symbol to one DOM node instead
 * of up to 841 `<rect>`s -- that difference is what makes a 21-label sheet
 * preview feel instant rather than janky.
 */
export function encodeQrSymbol(text: string): QrSymbol {
  const qr = QRCode.create(text, { errorCorrectionLevel: QR_ERROR_CORRECTION });
  const { size, data } = qr.modules;
  const offset = QR_QUIET_ZONE_MODULES;
  const extent = size + QR_QUIET_ZONE_MODULES * 2;

  let path = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!data[row * size + col]) continue;
      path += `M${col + offset} ${row + offset}h1v1h-1z`;
    }
  }

  return {
    path,
    moduleCount: size,
    extent,
    viewBox: `0 0 ${extent} ${extent}`,
    version: qr.version,
  };
}

/**
 * The spec's hard floor: a symbol smaller than this stops scanning
 * reliably at arm's length (docs/tele-qr/qr-labels.md).
 */
export const MIN_QR_SYMBOL_MM = 20;

/**
 * Physical size of the *symbol* when a box of `boxMm` is printed with the
 * quiet zone inside it. This is the number to compare against
 * `MIN_QR_SYMBOL_MM` -- comparing the box size instead silently overstates
 * the symbol by ~22% at version 3 and lets an under-20 mm label through.
 */
export function symbolSizeMm(boxMm: number, moduleCount: number): number {
  const extent = moduleCount + QR_QUIET_ZONE_MODULES * 2;
  return (boxMm * moduleCount) / extent;
}
