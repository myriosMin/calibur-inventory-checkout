import type { MemberHolderHoldings } from "@/lib/server/member-activity";

export type BotCommand = "/start" | "/myitems" | "/help";

export interface ParsedCommand {
  command: BotCommand;
  /** Everything after the command word, trimmed. `/start ABC123` -> "ABC123". */
  args: string;
  /**
   * The bot the command was explicitly addressed to, lowercased and without
   * the `@`, or null when it was not addressed to anyone
   * (`/help@calibur_parts_bot` -> "calibur_parts_bot"; `/help` -> null).
   *
   * In a DM this is noise. In a group it is the whole question: several bots
   * can share a chat, and a `/start@other_bot` is not ours to answer.
   */
  mention: string | null;
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

  const mention = atIndex === -1 ? null : head.slice(atIndex + 1).toLowerCase() || null;

  const command = KNOWN_COMMANDS.find((known) => known === word);
  return command ? { command, args, mention } : null;
}

/**
 * What the webhook should do with one inbound message, given the chat it
 * arrived in. Pure, so the group-chat rules below are testable without a
 * webhook, a bot token or a network call.
 *
 * The rules exist because the alert-chat feature (`/api/cron/daily` posting
 * low-stock and digest messages to the club group) REQUIRES this bot to join
 * the club group. Before this function, that meant every `/anything` typed by
 * any member in that group produced a public "I didn't understand that", and
 * a `/start` ran identity binding and announced the result to 120 people.
 *
 *   - Private chat: unchanged. Known command -> handle it; anything else ->
 *     the plain-text fallback (flows.md §8's degraded mode for "Mini App
 *     won't load").
 *   - Group/supergroup/channel: answer ONLY a known command explicitly
 *     addressed to this bot (`/cmd@this_bot`). Everything else -- an
 *     unaddressed command, a command aimed at another bot, plain chatter --
 *     is silence. There is no group fallback, by design: a bot that talks
 *     over a club chat gets muted, and a muted bot cannot deliver the alerts
 *     it joined the group for.
 *
 * An absent `chatType` is read as private: Telegram always sends it, so the
 * only updates without one are fabricated, and the conservative reading of
 * "unknown chat" for a bot whose real traffic is DMs is the DM behaviour.
 * An empty/absent `botUsername` makes addressing impossible, so every group
 * message falls through to silence rather than to a public reply.
 */
export type MessageRoute =
  | { action: "handle"; command: BotCommand; args: string }
  /** Private chat, nothing recognised: reply with buildFallbackText(). */
  | { action: "fallback" }
  /** Group chat, not addressed to us: ack and say nothing at all. */
  | { action: "ignore" };

export function routeMessage(
  text: string,
  chatType: string | null | undefined,
  botUsername: string | null | undefined,
): MessageRoute {
  const parsed = parseCommand(text);
  const isPrivate = (chatType ?? "private") === "private";

  if (isPrivate) {
    return parsed
      ? { action: "handle", command: parsed.command, args: parsed.args }
      : { action: "fallback" };
  }

  const me = normalizeBotUsername(botUsername);
  if (!parsed || !me || parsed.mention !== me) return { action: "ignore" };
  return { action: "handle", command: parsed.command, args: parsed.args };
}

/** `@Calibur_Parts_Bot` / `Calibur_Parts_Bot` -> `calibur_parts_bot`. */
export function normalizeBotUsername(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@/, "").toLowerCase();
  return trimmed || null;
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
        .map((item) => `- ${item.name} x${item.qty} ${item.unit}`.trimEnd() + (item.expensive ? " (expensive)" : ""))
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
  return "I don't recognise you yet. Ask a committee member for a join code, then send /start and tap Join.";
}

/** `/start` from someone new: the same answer, plus the button that acts on it. */
export function buildJoinPromptText(): string {
  return "I don't recognise you yet. If a committee member gave you a join code, tap Join below and enter it.";
}
