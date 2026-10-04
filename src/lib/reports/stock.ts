/**
 * Low stock vs. negative stock — two different problems that look the same
 * in a naive `qty_in_store < min_stock` query.
 *
 * `supabase/migrations/0015_stock_summary_fix.sql` leaves a note for exactly
 * this module: *"qty_in_store can legitimately be negative today (imported
 * catalog with no restock). Treat `< 0` as a data-integrity warning, NOT a
 * low-stock alert."*
 *
 * The distinction is not pedantry. "We're down to 2 XT30s, buy more" is an
 * action for the logistics lead. "This part reads −4" means the opening
 * balance was never recorded — nothing is missing, the ledger just started
 * mid-story — and the fix is a restock entry or a stocktake, not a purchase.
 * Filing the second under the first would send the club shopping for parts
 * that are sitting on the shelf.
 */

export interface StockLevelRow {
  productId: string;
  name: string;
  tier: string;
  unit: string;
  /** null = no threshold configured = never alerts. */
  minStock: number | null;
  qtyInStore: number;
  qtyOut: number;
  /** products.unit_cost_sgd; null = not priced. */
  unitCostSgd?: number | null;
  /** products.expensive (0028): S$20+, or critical with no price. */
  expensive?: boolean;
}

export type StockFlag = "negative" | "low" | "ok";

/**
 * Negative wins over low, even when a threshold is set and the quantity is
 * also below it: a product reading −4 against a min of 50 is a broken
 * opening balance, and reporting it as "low stock" would bury the real
 * problem under a shopping list.
 */
export function classifyStockLevel(row: Pick<StockLevelRow, "minStock" | "qtyInStore">): StockFlag {
  if (row.qtyInStore < 0) return "negative";
  if (row.minStock !== null && row.qtyInStore < row.minStock) return "low";
  return "ok";
}

export interface StockReport {
  /** Below `min_stock`, and non-negative. Sorted by how far below. */
  low: StockLevelRow[];
  /** Below zero. A data-quality signal, never a shortage. */
  negative: StockLevelRow[];
}

/** How short of the threshold, as a non-negative number. 0 when not low. */
export function shortfall(row: StockLevelRow): number {
  if (row.minStock === null) return 0;
  return Math.max(0, row.minStock - row.qtyInStore);
}

export function classifyStockLevels(rows: readonly StockLevelRow[]): StockReport {
  const low: StockLevelRow[] = [];
  const negative: StockLevelRow[] = [];

  for (const row of rows) {
    const flag = classifyStockLevel(row);
    if (flag === "negative") negative.push(row);
    else if (flag === "low") low.push(row);
  }

  low.sort((a, b) => shortfall(b) - shortfall(a) || a.name.localeCompare(b.name));
  negative.sort((a, b) => a.qtyInStore - b.qtyInStore || a.name.localeCompare(b.name));

  return { low, negative };
}

/**
 * Second half of the notification-suppression story (see
 * `shouldNudge` in ./overdue.ts for the first).
 *
 * A product that is low stays low until someone buys more, which can be
 * weeks. Alerting the club chat every morning for those weeks is the "bot
 * that nags gets muted" failure `flows.md` §7 warns about. So the alert
 * fires on the **transition**, not on the state: only products that were not
 * low at the start of the window and are low now.
 *
 * The previous quantity is reconstructed from the ledger rather than stored
 * — `qtyBefore = qtyInStore - (net movement into the store during the
 * window)` — so this needs no new table and no "last alerted" column. The
 * standing list is not lost either: the weekly digest repeats every low
 * product, so a shortage that nobody acted on resurfaces once a week.
 *
 * `deltas` maps product id → net change in the store's holding over the
 * window (positive = stock came in). Products missing from the map moved by
 * zero, so their previous quantity equals their current one and they cannot
 * have crossed.
 */
export function selectNewlyLow(
  low: readonly StockLevelRow[],
  deltas: ReadonlyMap<string, number>,
): StockLevelRow[] {
  return low.filter((row) => {
    const previous = row.qtyInStore - (deltas.get(row.productId) ?? 0);
    return classifyStockLevel({ minStock: row.minStock, qtyInStore: previous }) !== "low";
  });
}

/** Same transition rule, for the negative-balance warning. */
export function selectNewlyNegative(
  negative: readonly StockLevelRow[],
  deltas: ReadonlyMap<string, number>,
): StockLevelRow[] {
  return negative.filter((row) => {
    const previous = row.qtyInStore - (deltas.get(row.productId) ?? 0);
    return previous >= 0;
  });
}
