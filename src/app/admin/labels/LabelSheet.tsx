"use client";

import { useMemo } from "react";

import { encodeQrSymbol, type QrSymbol } from "@/lib/codes/qr";

import type { LabelSpec } from "./label-spec";
import { labelsPerSheet, paginate, type SheetGeometry } from "./sheet-geometry";

/**
 * Encoding is deterministic and pure, and a 500-label sheet re-renders on
 * every checkbox tick, so memoise across component instances. Keyed by the
 * full URL because that is the only input.
 */
const symbolCache = new Map<string, QrSymbol>();

export function qrSymbolFor(url: string): QrSymbol {
  const cached = symbolCache.get(url);
  if (cached) return cached;
  const symbol = encodeQrSymbol(url);
  symbolCache.set(url, symbol);
  return symbol;
}

export function QrSvg({ value }: { value: string }) {
  const symbol = useMemo(() => qrSymbolFor(value), [value]);
  return (
    <svg
      className="labels-qr"
      viewBox={symbol.viewBox}
      xmlns="http://www.w3.org/2000/svg"
      // Vector all the way down: the same element is a ~100 px preview on
      // screen and a 20 mm symbol at 600 dpi on polyester, with no raster
      // step in between to soften the module edges.
      shapeRendering="crispEdges"
      role="img"
      aria-label={`QR code for ${value}`}
    >
      {/* The quiet zone is inside the viewBox, and it has to be actually
          white -- a transparent margin would show whatever is behind it. */}
      <rect width={symbol.extent} height={symbol.extent} fill="#ffffff" />
      <path d={symbol.path} fill="#000000" />
    </svg>
  );
}

export function LabelCell({ spec }: { spec: LabelSpec }) {
  return (
    <div className="labels-cell">
      <QrSvg value={spec.url} />
      <div className="labels-text">
        <div className="labels-name">{spec.title}</div>
        {spec.hint ? <div className="labels-hint">{spec.hint}</div> : null}
        {/* Human-readable location + code. docs/tele-qr/qr-labels.md:
            "no exceptions" -- this is what makes a scuffed sticker
            recoverable and lets a member type the code by hand. */}
        <div className="labels-meta">{spec.meta}</div>
      </div>
    </div>
  );
}

export interface LabelSheetProps {
  specs: LabelSpec[];
  geometry: SheetGeometry;
}

export default function LabelSheet({ specs, geometry }: LabelSheetProps) {
  const perPage = labelsPerSheet(geometry);
  const pages = useMemo(() => paginate(specs, perPage), [specs, perPage]);

  return (
    <div className="labels-sheet">
      {pages.map((page, pageIndex) => (
        <div className="labels-page" key={`page-${pageIndex}`}>
          {page.map((spec) => (
            <LabelCell key={spec.code} spec={spec} />
          ))}
        </div>
      ))}
    </div>
  );
}
