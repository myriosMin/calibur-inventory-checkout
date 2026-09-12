/**
 * Label health — the feedback loop for the one part of this system that
 * physically degrades.
 *
 * `qr-labels.md`, echoed in `operations.md` §"Label health": *"A product
 * consistently reached by search rather than scan almost certainly has a
 * missing or damaged sticker. Surface that as a dashboard list rather than
 * waiting for someone to complain."*
 *
 * Waiting for a complaint is the failure mode worth naming: a member whose
 * scan fails does not file a report, they tap Search, get on with their day,
 * and the sticker stays broken for the rest of the season. The data to catch
 * it (`stock_movements.entry_method`) has been accumulating since Phase 3
 * and nothing has read it until now.
 *
 * Pure: rows in, verdicts out.
 */

export type LabelVerdict =
  /** No active scan code exists for this product at all. */
  | "no_label"
  /** Has a label, but people keep reaching it by search anyway. */
  | "suspect"
  /** Has a label and people scan it. */
  | "ok"
  /** Too few entries to say anything honest. */
  | "insufficient_data";

export interface LabelHealthEntry {
  productId: string;
  entryMethod: string | null;
}

export interface LabelHealthProduct {
  id: string;
  name: string;
  tier: string;
  active: boolean;
}

export interface LabelHealthCode {
  code: string;
  productId: string | null;
  kind: string;
  active: boolean;
}

export interface LabelHealthRow {
  productId: string;
  productName: string;
  tier: string;
  scanned: number;
  searched: number;
  total: number;
  /** searched / total, or null when total is 0. */
  searchRatio: number | null;
  /** The active product code to reprint, if there is one. */
  code: string | null;
  /** True when the product sits in a location covered by a `kind='group'` code. */
  hasActiveCode: boolean;
  verdict: LabelVerdict;
}

export interface LabelHealthOptions {
  /**
   * Below this many member entries the ratio is noise — two searches out of
   * two is not evidence of anything. Defaults to 4: low enough that a
   * genuinely broken sticker surfaces within a week of normal use, high
   * enough that one person's bad afternoon does not trigger a reprint.
   */
  minEntries?: number;
  /**
   * Flag at this share of searches or above. 0.5 = "more often searched
   * than scanned", which is a deliberately conservative bar — the cost of a
   * false positive is one wasted sticker, but the list losing credibility
   * costs the whole feedback loop.
   */
  searchRatioThreshold?: number;
}

export const DEFAULT_MIN_ENTRIES = 4;
export const DEFAULT_SEARCH_RATIO_THRESHOLD = 0.5;

/**
 * `group_pick` counts as a scan: the member scanned the resistor book's
 * sticker and picked from the list, exactly as designed. Only `search` means
 * "could not scan this". `admin` entries (restock, stocktake) never involve
 * a label and are excluded entirely.
 */
function classify(method: string | null): "scanned" | "searched" | null {
  if (method === "scan" || method === "group_pick") return "scanned";
  if (method === "search") return "searched";
  return null;
}

export function computeLabelHealth(
  entries: readonly LabelHealthEntry[],
  products: readonly LabelHealthProduct[],
  codes: readonly LabelHealthCode[],
  options: LabelHealthOptions = {},
): LabelHealthRow[] {
  const minEntries = options.minEntries ?? DEFAULT_MIN_ENTRIES;
  const threshold = options.searchRatioThreshold ?? DEFAULT_SEARCH_RATIO_THRESHOLD;

  const counts = new Map<string, { scanned: number; searched: number }>();
  for (const entry of entries) {
    const bucket = classify(entry.entryMethod);
    if (!bucket) continue;
    const existing = counts.get(entry.productId) ?? { scanned: 0, searched: 0 };
    existing[bucket] += 1;
    counts.set(entry.productId, existing);
  }

  // A product's own active code is what gets reprinted. Group codes are
  // location-scoped and are handled by the caller (which knows locations);
  // here a product with no product code and no entries is simply unlabelled.
  const activeCodeByProduct = new Map<string, string>();
  for (const code of codes) {
    if (!code.active || code.kind !== "product" || !code.productId) continue;
    // First active code wins; a product with two is a scan-codes page
    // problem, not a label-health one.
    if (!activeCodeByProduct.has(code.productId)) activeCodeByProduct.set(code.productId, code.code);
  }

  const rows: LabelHealthRow[] = [];

  for (const product of products) {
    if (!product.active) continue;
    const tally = counts.get(product.id) ?? { scanned: 0, searched: 0 };
    const total = tally.scanned + tally.searched;
    const code = activeCodeByProduct.get(product.id) ?? null;
    const hasActiveCode = code !== null;
    const searchRatio = total === 0 ? null : tally.searched / total;

    let verdict: LabelVerdict;
    if (!hasActiveCode) {
      // Unlabelled and unused is not a problem worth a row; unlabelled and
      // being reached for is. `no_label` is the strongest signal on the
      // page — there is nothing to scan, so every entry is a search by
      // construction.
      verdict = total === 0 ? "insufficient_data" : "no_label";
    } else if (total < minEntries) {
      verdict = "insufficient_data";
    } else if (searchRatio !== null && searchRatio >= threshold) {
      verdict = "suspect";
    } else {
      verdict = "ok";
    }

    rows.push({
      productId: product.id,
      productName: product.name,
      tier: product.tier,
      scanned: tally.scanned,
      searched: tally.searched,
      total,
      searchRatio,
      code,
      hasActiveCode,
      verdict,
    });
  }

  // Worst first: no label at all, then the highest search share, then the
  // most-used product (a bad sticker on a popular part wastes more time).
  const rank: Record<LabelVerdict, number> = {
    no_label: 0,
    suspect: 1,
    ok: 2,
    insufficient_data: 3,
  };

  return rows.sort(
    (a, b) =>
      rank[a.verdict] - rank[b.verdict] ||
      (b.searchRatio ?? -1) - (a.searchRatio ?? -1) ||
      b.total - a.total ||
      a.productName.localeCompare(b.productName),
  );
}

/** The rows worth showing on the dashboard: something is actually wrong. */
export function needsAttention(rows: readonly LabelHealthRow[]): LabelHealthRow[] {
  return rows.filter((row) => row.verdict === "no_label" || row.verdict === "suspect");
}
