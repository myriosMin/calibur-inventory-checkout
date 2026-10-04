/**
 * The club's "expensive item" rule (2026-10-04), in one place for the app.
 *
 * The database is the authority: `products.expensive` is a generated column
 * (migration 0028) and `products_expensive_returnable` refuses an expensive
 * item that is not returnable, because a non-returnable item is consumed at
 * checkout and never tracked again. This module mirrors that rule for the
 * places that need it BEFORE a row is saved (the product form) or need to
 * explain it (the dashboard copy). tests/unit/expensive.test.ts checks the
 * threshold against the migration text.
 */

export const EXPENSIVE_THRESHOLD_SGD = 20;

export type Criticality = "critical" | "standard" | "expendable";

/**
 * Why a product is (or isn't) expensive:
 * - `priced`: has a price, and it is at or over the line.
 * - `assumed`: no price, but critical, so treated as expensive.
 * - `cheap`: has a price under the line.
 * - `unpriced`: no price and not critical. Not treated as expensive, but a
 *   reusable (standard) one may well be: it needs a price to know.
 */
export type ExpenseBasis = "priced" | "assumed" | "cheap" | "unpriced";

export function expenseBasis(product: { unitCostSgd: number | null; criticality: string }): ExpenseBasis {
  if (product.unitCostSgd !== null) return product.unitCostSgd >= EXPENSIVE_THRESHOLD_SGD ? "priced" : "cheap";
  return product.criticality === "critical" ? "assumed" : "unpriced";
}

/** Same expression as the generated column: coalesce(price >= 20, critical). */
export function isExpensive(product: { unitCostSgd: number | null; criticality: string }): boolean {
  const basis = expenseBasis(product);
  return basis === "priced" || basis === "assumed";
}

/** Reusable kit with no price: the products whose expense is genuinely unknown. */
export function needsPrice(product: { unitCostSgd: number | null; criticality: string; active?: boolean }): boolean {
  return product.unitCostSgd === null && product.criticality === "standard" && product.active !== false;
}

export const EXPENSIVE_RULE_TEXT =
  `S$${EXPENSIVE_THRESHOLD_SGD} or more a unit, or critical with no price yet. ` +
  "Expensive items are always returnable: borrowed and tracked, never consumed at checkout.";

/**
 * An open review item is high priority when its product is expensive, or
 * when staff have marked it as being about expensive items no single product
 * captures (review_items.about_expensive).
 */
export function isHighPriorityReview(
  item: { product_id: string | null; about_expensive: boolean },
  expensiveProductIds: ReadonlySet<string>,
): boolean {
  return item.about_expensive || (item.product_id !== null && expensiveProductIds.has(item.product_id));
}
