/**
 * Pure CSV primitives — no filesystem, no `process`, no Node built-ins.
 *
 * These started life inside `scripts/import-catalog.ts`, but that module
 * imports `node:fs` / `node:path` at the top level, so nothing under
 * `src/app/**` could reuse it: pulling `parseCsv` into a `"use client"`
 * component would drag the whole Node-only import graph into the browser
 * bundle. Extracted here so the admin roster importer and the catalog
 * script share ONE parser implementation rather than two that drift.
 *
 * `scripts/import-catalog.ts` re-exports these, so its own importers
 * (including tests/unit/import-catalog.test.ts) keep working unchanged.
 */

/** Parses raw CSV text into an array of rows, each an array of raw (untrimmed) field strings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let sawAnyContentOnLine = false;
  let i = 0;
  const n = text.length;

  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }

    if (c === '"') {
      inQuotes = true;
      sawAnyContentOnLine = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      sawAnyContentOnLine = true;
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      sawAnyContentOnLine = false;
      i++;
      continue;
    }
    field += c;
    sawAnyContentOnLine = true;
    i++;
  }
  // Trailing field/row with no final newline.
  if (field.length > 0 || row.length > 0 || sawAnyContentOnLine) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Escapes a single field for CSV output. */
export function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function toCsvLine(fields: string[]): string {
  return fields.map(csvEscape).join(",");
}
