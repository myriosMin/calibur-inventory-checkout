/**
 * Pure grouping for /admin/holdings: the `holdings` view rows, joined to
 * product and holder names and bucketed by holder.
 *
 * The join happens here rather than in PostgREST because the `holdings` view
 * declares no foreign keys (it is a `group by` over a union, so Postgres has
 * nothing to infer from) and therefore supports no embeds. The component
 * fetches the three relations separately and hands them to this function.
 */

export interface HoldingRow {
  product_id: string | null;
  holder_id: string | null;
  qty: number | null;
}

export interface HolderRef {
  id: string;
  name: string;
  kind: string;
}

export interface ProductRef {
  id: string;
  name: string;
  unit: string | null;
  tier: string;
}

export interface HoldingLine {
  productId: string;
  productName: string;
  unit: string;
  tier: string;
  qty: number;
}

export interface HolderGroup {
  holder: HolderRef;
  lines: HoldingLine[];
  /** Distinct products this holder holds a non-zero balance of. */
  productCount: number;
  /** Sum of qty -- can be negative, and that is meaningful, not a bug. */
  totalUnits: number;
  /**
   * Negative lines worth chasing. Always 0 for the consumed/adjustment
   * pseudo-holders: they are the other side of every consume and every
   * opening balance, so "negative" is their normal state (the live
   * Adjustment holder sits at -486 lines by design), not a data problem.
   */
  negativeCount: number;
}

/** Bookkeeping holders: where stock went or came from, never where it is. */
export const PSEUDO_HOLDER_KINDS = new Set(["consumed", "adjustment"]);

/**
 * Display order: the store first (it is the question everyone opens this page
 * for), then robots, then members, then the two pseudo-holders last -- they
 * are bookkeeping, not places a motor can physically be.
 */
const KIND_ORDER: Record<string, number> = {
  store: 0,
  robot: 1,
  member: 2,
  consumed: 3,
  adjustment: 4,
};

function kindRank(kind: string): number {
  return KIND_ORDER[kind] ?? 90;
}

export function groupHoldingsByHolder(
  rows: HoldingRow[],
  holders: HolderRef[],
  products: ProductRef[],
): HolderGroup[] {
  const holderById = new Map(holders.map((h) => [h.id, h]));
  const productById = new Map(products.map((p) => [p.id, p]));
  const byHolder = new Map<string, HolderGroup>();

  for (const row of rows) {
    // The view's columns are all nullable in the generated types (Postgres
    // cannot prove non-nullability through a union + group by), and a qty of
    // exactly 0 is filtered out by the view's HAVING clause anyway.
    if (!row.holder_id || !row.product_id || !row.qty) continue;

    const holder = holderById.get(row.holder_id);
    if (!holder) continue;

    let group = byHolder.get(holder.id);
    if (!group) {
      group = {
        holder,
        lines: [],
        productCount: 0,
        totalUnits: 0,
        negativeCount: 0,
      };
      byHolder.set(holder.id, group);
    }

    const product = productById.get(row.product_id);
    group.lines.push({
      productId: row.product_id,
      // A product row can be missing here only if it was hard-deleted while
      // its movements survived; show the id rather than dropping the line,
      // because a dangling balance is exactly what this page exists to find.
      productName: product?.name ?? `(unknown product ${row.product_id.slice(0, 8)})`,
      unit: product?.unit ?? "pcs",
      tier: product?.tier ?? "bulk",
      qty: row.qty,
    });
  }

  const groups = [...byHolder.values()];
  for (const group of groups) {
    // Negative balances first: they are the reason to read this page.
    // (Harmless on the pseudo-holders, where every line is negative.)
    group.lines.sort((a, b) => {
      const aNeg = a.qty < 0 ? 0 : 1;
      const bNeg = b.qty < 0 ? 0 : 1;
      if (aNeg !== bNeg) return aNeg - bNeg;
      return a.productName.localeCompare(b.productName);
    });
    group.productCount = group.lines.length;
    group.totalUnits = group.lines.reduce((sum, line) => sum + line.qty, 0);
    group.negativeCount = PSEUDO_HOLDER_KINDS.has(group.holder.kind)
      ? 0
      : group.lines.filter((line) => line.qty < 0).length;
  }

  groups.sort((a, b) => {
    const rank = kindRank(a.holder.kind) - kindRank(b.holder.kind);
    if (rank !== 0) return rank;
    return a.holder.name.localeCompare(b.holder.name);
  });

  return groups;
}

export function countNegativeLines(groups: HolderGroup[]): number {
  return groups.reduce((sum, group) => sum + group.negativeCount, 0);
}
