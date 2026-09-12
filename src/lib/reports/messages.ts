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

/** Telegram rejects a sendMessage over this many characters outright. */
export const TELEGRAM_MESSAGE_LIMIT = 4096;

/** Room kept for the " (2/3)" a split digest appends to each part's heading. */
const PART_SUFFIX_RESERVE = 16;

interface DigestSection {
  title: string;
  lines: string[];
  total: number;
}

function digestSections(params: DigestParams): DigestSection[] {
  const { outstanding, lowStock, negative, overdue } = params;

  const sections: DigestSection[] = [
    {
      title: "Out of the store",
      lines: outstanding.map((item) => `${item.name} x${item.qtyOut} ${item.unit}`),
      total: outstanding.length,
    },
    {
      title: "Out with a member past the threshold",
      lines: overdue.map(
        (item) =>
          `${item.productName} x${item.qty} ${item.unit} — ${item.memberName}, ${formatDuration(item.daysOut)}`,
      ),
      total: overdue.length,
    },
    {
      title: "Low stock",
      lines: lowStock.map(
        (item) =>
          `${item.name}: ${item.qtyInStore} ${item.unit}` +
          (item.minStock === null ? "" : ` (min ${item.minStock})`),
      ),
      total: lowStock.length,
    },
  ];

  // Only shown when there is something to say: a zero here is the normal,
  // healthy state and a standing "Negative balances: none" line would train
  // people to skim past the section that matters when it is not zero.
  if (negative.length > 0) {
    sections.push({
      title: "Reading below zero (data check, not a shortage)",
      lines: negative.map((item) => `${item.name}: ${item.qtyInStore} ${item.unit}`),
      total: negative.length,
    });
  }

  return sections;
}

function digestHeading(date: string): string {
  return `Weekly inventory digest — ${date}`;
}

/**
 * The one scheduled message that goes out whether or not anything is wrong —
 * which is the point: a weekly "nothing outstanding, nothing low" is how the
 * club knows the job is still running at all. Everything else is exception-
 * driven and silent by design.
 *
 * This builds the digest as ONE unbounded string, which is the right shape
 * for reading and for tests but NOT for sending: see
 * `buildWeeklyDigestMessages` for the version that fits Telegram.
 */
export function buildWeeklyDigestText(params: DigestParams): string {
  const blocks = digestSections(params).map((s) =>
    section(s.title, s.lines, s.total, params.sectionLimit),
  );
  return [digestHeading(params.date), "", blocks.join("\n\n")].join("\n");
}

/**
 * The digest, split into messages Telegram will actually accept.
 *
 * `sectionLimit` alone does not bound the length: four sections of 15 lines
 * each, with real part names ("DJI M3508 P19 brushless motor with C620 ESC")
 * and a member name and a duration on the overdue lines, passes 4096
 * characters. Telegram then rejects the send, `sendMessageSafely` swallows
 * the error, and the cron keeps reporting a digest it never delivered —
 * failure by silence, in the one message whose job is to prove the job runs.
 *
 * So: shrink any single section that cannot fit a message on its own (its
 * "and N more" line stays honest about what was dropped), then pack whole
 * sections into as few messages as possible, numbering them when there is
 * more than one.
 */
export function buildWeeklyDigestMessages(
  params: DigestParams,
  limit: number = TELEGRAM_MESSAGE_LIMIT,
): string[] {
  const heading = digestHeading(params.date);
  // Reserved unconditionally so the numbering can be added afterwards without
  // re-packing; costs a few characters in the common single-message case.
  const budget = limit - PART_SUFFIX_RESERVE;
  const blockBudget = Math.max(1, budget - heading.length - 2);

  const blocks = digestSections(params).map((s) => {
    let sectionLimit = params.sectionLimit;
    let block = section(s.title, s.lines, s.total, sectionLimit);
    // Drop lines until this section fits a message by itself. The count in
    // "and N more" grows as lines go, so nothing is hidden silently.
    while (block.length > blockBudget && sectionLimit > 0) {
      sectionLimit -= 1;
      block = section(s.title, s.lines, s.total, sectionLimit);
    }
    // Pathological (an absurd title, or a one-line budget): cut it rather
    // than emit a message Telegram will refuse.
    return block.length > blockBudget ? `${block.slice(0, blockBudget - 1)}…` : block;
  });

  const messages: string[] = [];
  let current = "";
  for (const block of blocks) {
    const candidate = current ? `${current}\n\n${block}` : `${heading}\n\n${block}`;
    if (current && candidate.length > budget) {
      messages.push(current);
      current = `${heading}\n\n${block}`;
    } else {
      current = candidate;
    }
  }
  if (current) messages.push(current);

  if (messages.length <= 1) return messages;

  return messages.map((text, index) =>
    text.replace(heading, `${heading} (${index + 1}/${messages.length})`),
  );
}
