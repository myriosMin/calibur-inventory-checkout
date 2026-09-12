import type { MemberHolderHoldings } from "@/lib/server/member-activity";

export type BotCommand = "/start" | "/myitems" | "/help";

export interface ParsedCommand {
  command: BotCommand;
  /** Everything after the command word, trimmed. `/start ABC123` -> "ABC123". */
  args: string;
}

const KNOWN_COMMANDS: readonly BotCommand[] = ["/start", "/myitems", "/help"];

/**
 * Parse an inbound message into one of the bot's known commands.
 *
 * Deliberately exact-match on the command word rather than the
 * `text.startsWith("/start")` test this replaced -- that prefix test matched
 * `/starting`, `/starts` and `/startle` as `/start`, silently running the
 * identity-binding flow for a typo.
 *
 * Handles the three shapes Telegram actually delivers:
 *   `/help`, `/start ABC123`, and `/myitems@calibur_parts_bot`
 * (clients append `@botname` in group chats). Command words are
 * case-insensitive; `args` is returned verbatim, since a start payload is a
 * case-sensitive scan code.
 *
 * Returns null for plain text and for unknown commands alike -- the webhook
 * answers both with the same fallback, so there is nothing for a third
 * outcome to do.
 */
export function parseCommand(text: string): ParsedCommand | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("/")) return null;

  const firstSpace = trimmed.search(/\s/);
  const head = firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace);
  const args = firstSpace === -1 ? "" : trimmed.slice(firstSpace).trim();

  // Strip the `@botname` suffix Telegram clients add in group chats.
  const atIndex = head.indexOf("@");
  const word = (atIndex === -1 ? head : head.slice(0, atIndex)).toLowerCase();

  const command = KNOWN_COMMANDS.find((known) => known === word);
  return command ? { command, args } : null;
}

/** Shared body listing what the bot understands, reused verbatim by /help and
 * the unrecognised-message fallback so the two can never drift. */
const COMMAND_LIST = [
  "/myitems - what you currently have out",
  "/help - this message",
  "/start - link your Telegram account",
].join("\n");

const MINIAPP_HINT =
  "Everything else happens in the app: scan a bin sticker with your camera, or open the menu button below.";

/**
 * `/help`. Plain text, no emoji, no parse_mode -- same house rules as
 * buildReceiptText (src/lib/telegram/receipt.ts), and no Markdown means no
 * escaping bugs when a product name contains an underscore.
 */
export function buildHelpText(): string {
  return `I look after the parts store.\n\n${COMMAND_LIST}\n\n${MINIAPP_HINT}`;
}

/**
 * Reply to anything the bot doesn't understand -- plain chatter, a typo'd
 * command, a forwarded message. docs/tele-qr/flows.md §8 requires the bot to
 * have a plain-text fallback: it is the degraded mode for "Mini App won't
 * load", and before this every non-/start message got a silent 200, which
 * reads to a member as a broken bot.
 */
export function buildFallbackText(): string {
  return `I didn't understand that.\n\n${COMMAND_LIST}\n\n${MINIAPP_HINT}`;
}

/**
 * `/myitems` -- the plain-text twin of /store/mine, and the degraded-mode
 * answer to "what have I got out?" when the Mini App won't open.
 *
 * Grouped by holder because "2 at Hero, 1 on the bench" is the shape of the
 * question; the total goes first so the answer survives being read from a
 * notification preview.
 */
export function buildMyItemsText(holders: MemberHolderHoldings[]): string {
  const groups = holders.filter((group) => group.items.length > 0);
  if (groups.length === 0) {
    return "You have nothing out right now.";
  }

  const totalLines = groups.reduce((sum, group) => sum + group.items.length, 0);
  const heading = totalLines === 1 ? "You have 1 item out." : `You have ${totalLines} items out.`;

  const body = groups
    .map((group) => {
      const items = group.items
        .map((item) => `- ${item.name} x${item.qty} ${item.unit}`.trimEnd())
        .join("\n");
      return `${group.holderName}\n${items}`;
    })
    .join("\n\n");

  return `${heading}\n\n${body}`;
}

/** `/myitems` from someone the bot can't resolve to an active member. Same
 * wording as the /start refusal: a member whose binding was cleared must get
 * the same actionable answer whichever command they reach for. */
export function buildUnknownMemberText(): string {
  return "I don't recognise you — ask a committee member to add you.";
}
