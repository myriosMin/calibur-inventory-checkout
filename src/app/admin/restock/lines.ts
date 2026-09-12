/**
 * Pure line-list logic for /admin/restock.
 *
 * Kept out of the component so the rules that actually matter -- "adding the
 * same product twice bumps the quantity instead of creating a second line",
 * "never send a zero or fractional qty to admin_restock" -- are unit-testable
 * without a browser or a database.
 *
 * The RPC re-validates all of this server-side (unknown product, qty <= 0).
 * This layer exists to keep the admin out of a round-trip they did not need,
 * not to be the guarantee.
 */

export interface RestockLine {
  productId: string;
  /** Snapshot of the product name at pick time, for display only. */
  name: string;
  /** Product unit ("pcs", "lot", ...), for display only. */
  unit: string;
  qty: number;
}

/**
 * The exact shape `admin_restock(p_lines jsonb)` expects.
 *
 * A `type` alias rather than an `interface` on purpose: TypeScript gives
 * aliases an implicit index signature, so `RestockPayloadLine[]` is directly
 * assignable to the generated `Json` parameter type. An interface is not,
 * and would force an `as unknown as Json` cast at the call site.
 */
export type RestockPayloadLine = {
  productId: string;
  qty: number;
};

export interface PickedProduct {
  id: string;
  name: string;
  unit: string | null;
}

export const DEFAULT_RESTOCK_QTY = 1;

/**
 * Add a product to the line list, or bump the existing line if it is already
 * there. Returns a new array; never mutates.
 *
 * Bumping rather than appending matters because the DB has no unique
 * constraint on (session, product) -- two lines for the same product would
 * commit happily as two movements, which is not wrong but reads as a mistake
 * in the ledger and is impossible to tell apart from a genuine double
 * delivery.
 */
export function addLine(
  lines: RestockLine[],
  product: PickedProduct,
  qty: number = DEFAULT_RESTOCK_QTY,
): RestockLine[] {
  const existing = lines.findIndex((line) => line.productId === product.id);
  if (existing >= 0) {
    return lines.map((line, i) =>
      i === existing ? { ...line, qty: line.qty + qty } : line,
    );
  }
  return [
    ...lines,
    { productId: product.id, name: product.name, unit: product.unit ?? "pcs", qty },
  ];
}

/** Set one line's quantity. A qty of 0 or less removes the line entirely. */
export function setLineQty(
  lines: RestockLine[],
  productId: string,
  qty: number,
): RestockLine[] {
  if (qty <= 0) return removeLine(lines, productId);
  return lines.map((line) =>
    line.productId === productId ? { ...line, qty } : line,
  );
}

export function removeLine(lines: RestockLine[], productId: string): RestockLine[] {
  return lines.filter((line) => line.productId !== productId);
}

export type RestockValidation =
  | { ok: true; lines: RestockPayloadLine[] }
  | { ok: false; error: string };

/**
 * Validate the line list and reduce it to the RPC payload. The error strings
 * are user-facing copy, not debug output.
 */
export function validateRestockLines(lines: RestockLine[]): RestockValidation {
  if (lines.length === 0) {
    return { ok: false, error: "Add at least one product before recording a restock." };
  }

  const seen = new Set<string>();
  for (const line of lines) {
    if (seen.has(line.productId)) {
      return {
        ok: false,
        error: `"${line.name}" appears twice. Combine it into a single line.`,
      };
    }
    seen.add(line.productId);

    if (!Number.isInteger(line.qty) || line.qty <= 0) {
      return {
        ok: false,
        error: `Quantity for "${line.name}" must be a whole number greater than zero.`,
      };
    }
  }

  return {
    ok: true,
    lines: lines.map((line) => ({ productId: line.productId, qty: line.qty })),
  };
}

export function totalUnits(lines: RestockLine[]): number {
  return lines.reduce((sum, line) => sum + line.qty, 0);
}

/** "3 products, 47 units" -- the confirmation copy after a commit. */
export function describeRestock(lines: RestockLine[]): string {
  const products = lines.length;
  const units = totalUnits(lines);
  return `${products} ${products === 1 ? "product" : "products"}, ${units} ${
    units === 1 ? "unit" : "units"
  }`;
}
