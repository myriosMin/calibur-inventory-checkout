/**
 * Every outbound cron message, built as a pure string.
 *
 * Same contract as `src/lib/telegram/receipt.ts`: plain text, no emoji (the
 * app's no-emoji convention applies to the bot too), no Markdown — the send
 * path does not set `parse_mode`, so a stray `_` in a part number would
 * otherwise become italics or a 400. Nothing here touches the network or the
 * clock, so every line the club will actually read is unit-testable.
 *
 * Tone: `flows.md` §7 wants rare, useful messages. These say what is true and
 * what to do about it, and never chase a person — variance and overdue
 * holdings are diagnostics, not accusations (`operations.md`).
 */

export interface OverdueItem {
  productName: string;
  qty: number;
  unit: string;
  daysOut: number;
}

export interface LowStockItem {
  name: string;
  qtyInStore: number;
  minStock: number | null;
  unit: string;
}

export interface NegativeStockItem {
  name: string;
  qtyInStore: number;
  unit: string;
}

export interface OutstandingItem {
  name: string;
  qtyOut: number;
  unit: string;
}

/** "1 day" / "3 days" — the unit is part of the sentence, so it has to agree. */
export function formatDays(days: number): string {
  return days === 1 ? "1 day" : `${days} days`;
}

/**
 * "3 weeks" reads better than "21 days" at exactly the thresholds the club
 * will use, and worse everywhere else — so weeks only when it is a whole
 * number of them and there is at least one.
 */
export function formatDuration(days: number): string {
  if (days >= 7 && days % 7 === 0) {
    const weeks = days / 7;
    return weeks === 1 ? "1 week" : `${weeks} weeks`;
  }
  return formatDays(days);
}

function line(text: string): string {
  return `- ${text}`;
}

/**
 * The one message that goes to a person rather than the club chat.
 *
 * Deliberately not a demand: the member may still need the part, and the
 * system has no notion of a due date to hold them to. What it does is make
 * the holding visible, because the common case is someone who simply forgot
 * they had it.
 */
export function buildOverdueNudgeText(params: {
  memberName: string;
  items: readonly OverdueItem[];
}): string {
  const { memberName, items } = params;
  const heading =
    items.length === 1
      ? `${memberName}, you have had this out for a while:`
      : `${memberName}, you have had these out for a while:`;
  const body = items
    .map((item) =>
      line(`${item.productName} x${item.qty} ${item.unit} — ${formatDuration(item.daysOut)}`),
    )
    .join("\n");
  return `${heading}\n${body}\n\nStill using it? Nothing to do. Done with it? Return it in the app so someone else can find it.`;
}

export function buildLowStockAlertText(items: readonly LowStockItem[]): string {
  const heading = items.length === 1 ? "Low stock:" : `Low stock (${items.length} items):`;
  const body = items
    .map((item) =>
      line(
        `${item.name} is down to ${item.qtyInStore} ${item.unit}` +
          (item.minStock === null ? "" : ` (min ${item.minStock})`),
      ),
    )
    .join("\n");
  return `${heading}\n${body}`;
}

/**
 * Explicitly NOT a low-stock alert, and the message says so — otherwise the
 * logistics lead goes shopping for parts that are already on the shelf.
 */
export function buildNegativeStockAlertText(items: readonly NegativeStockItem[]): string {
  const heading =
    items.length === 1
      ? "Data check: a product now reads below zero in the store."
      : `Data check: ${items.length} products now read below zero in the store.`;
  const body = items
    .map((item) => line(`${item.name}: ${item.qtyInStore} ${item.unit}`))
    .join("\n");
  return (
    `${heading}\n${body}\n\n` +
    "This is almost always a missing opening balance, not a shortage — the part was on the shelf before the system knew about it. Fix it on /admin/restock, or by counting that shelf at a stocktake."
  );
}

export interface DigestParams {
  /** Calendar date the digest covers, `YYYY-MM-DD` in the club's zone. */
  date: string;
  outstanding: readonly OutstandingItem[];
  lowStock: readonly LowStockItem[];
  negative: readonly NegativeStockItem[];
  /** Member holdings past the overdue threshold, longest first. */
  overdue: readonly (OverdueItem & { memberName: string })[];
  /** Cap applied to each section by the caller, for the "and N more" line. */
  sectionLimit: number;
}

function section(title: string, lines: readonly string[], total: number, limit: number): string {
  if (total === 0) return `${title}: none`;
  const shown = lines.slice(0, limit);
  const more = total - shown.length;
  return [`${title} (${total}):`, ...shown.map(line), ...(more > 0 ? [line(`and ${more} more`)] : [])].join(
    "\n",
  );
}

/**
 * The one scheduled message that goes out whether or not anything is wrong —
 * which is the point: a weekly "nothing outstanding, nothing low" is how the
 * club knows the job is still running at all. Everything else is exception-
 * driven and silent by design.
 */
export function buildWeeklyDigestText(params: DigestParams): string {
  const { date, outstanding, lowStock, negative, overdue, sectionLimit } = params;

  const parts = [
    `Weekly inventory digest — ${date}`,
    "",
    section(
      "Out of the store",
      outstanding.map((item) => `${item.name} x${item.qtyOut} ${item.unit}`),
      outstanding.length,
      sectionLimit,
    ),
    "",
    section(
      "Out with a member past the threshold",
      overdue.map(
        (item) =>
          `${item.productName} x${item.qty} ${item.unit} — ${item.memberName}, ${formatDuration(item.daysOut)}`,
      ),
      overdue.length,
      sectionLimit,
    ),
    "",
    section(
      "Low stock",
      lowStock.map(
        (item) =>
          `${item.name}: ${item.qtyInStore} ${item.unit}` +
          (item.minStock === null ? "" : ` (min ${item.minStock})`),
      ),
      lowStock.length,
      sectionLimit,
    ),
  ];

  // Only shown when there is something to say: a zero here is the normal,
  // healthy state and a standing "Negative balances: none" line would train
  // people to skim past the section that matters when it is not zero.
  if (negative.length > 0) {
    parts.push(
      "",
      section(
        "Reading below zero (data check, not a shortage)",
        negative.map((item) => `${item.name}: ${item.qtyInStore} ${item.unit}`),
        negative.length,
        sectionLimit,
      ),
    );
  }

  return parts.join("\n");
}
