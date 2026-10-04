/**
 * Pure helpers for /admin/builds: what a build list costs, and how each line
 * compares with what the store holds. Kept out of the page so they are
 * unit-tested (tests/unit/build-summary.test.ts).
 *
 * A build list is a plan (migration 0027). "In store" is only a hint for the
 * lines linked to a store product: the same motor can be on two build lists
 * and is still one shelf.
 */

export interface BuildLineLike {
  section: string | null;
  qty: number | null;
  sourcing: string;
  unit_price_sgd: number | null;
  product_id: string | null;
}

export interface BuildTotals {
  lines: number;
  /** Σ qty × unit price over lines with both. */
  estCostSgd: number;
  /** Bought lines missing a quantity or a price, so not in estCostSgd. */
  unpriced: number;
  refereeKit: number;
  linked: number;
  /** Linked lines that need more than the store holds right now. */
  short: number;
}

export function lineCost(line: BuildLineLike): number | null {
  if (line.qty === null || line.unit_price_sgd === null) return null;
  return line.qty * line.unit_price_sgd;
}

/** Store quantity a linked line could draw on; null when not linked. */
export function inStoreFor(line: BuildLineLike, inStore: ReadonlyMap<string, number>): number | null {
  if (!line.product_id) return null;
  return inStore.get(line.product_id) ?? 0;
}

export function isShort(line: BuildLineLike, inStore: ReadonlyMap<string, number>): boolean {
  const have = inStoreFor(line, inStore);
  return have !== null && line.qty !== null && have < line.qty;
}

export function buildTotals(lines: readonly BuildLineLike[], inStore: ReadonlyMap<string, number>): BuildTotals {
  let estCostSgd = 0;
  let unpriced = 0;
  let refereeKit = 0;
  let linked = 0;
  let short = 0;
  for (const line of lines) {
    if (line.sourcing === "referee_kit") refereeKit += 1;
    else {
      const cost = lineCost(line);
      if (cost === null) unpriced += 1;
      else estCostSgd += cost;
    }
    if (line.product_id) linked += 1;
    if (isShort(line, inStore)) short += 1;
  }
  return { lines: lines.length, estCostSgd: Math.round(estCostSgd * 100) / 100, unpriced, refereeKit, linked, short };
}

/** Lines grouped by sub-assembly, in sheet order; lines with none go under "Other". */
export function groupBySection<T extends BuildLineLike>(lines: readonly T[]): Array<{ section: string; lines: T[] }> {
  const groups = new Map<string, T[]>();
  for (const line of lines) {
    const key = line.section ?? "Other";
    const group = groups.get(key);
    if (group) group.push(line);
    else groups.set(key, [line]);
  }
  return [...groups].map(([section, grouped]) => ({ section, lines: grouped }));
}

const SGD = new Intl.NumberFormat("en-SG", { style: "currency", currency: "SGD" });

export function formatSgd(value: number): string {
  return SGD.format(value);
}
