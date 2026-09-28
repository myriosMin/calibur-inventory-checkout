import { NextResponse } from "next/server";

import { buildJoinUrl } from "@/lib/join/code";
import { getMemberHoldings } from "@/lib/server/member-activity";
import { findMemberByTelegramUserId, memberDisplayName } from "@/lib/server/member-lookup";
import { sendMessageSafely } from "@/lib/telegram/bot-api";
import {
  buildFallbackText,
  buildHelpText,
  buildJoinPromptText,
  buildMyItemsText,
  buildUnknownMemberText,
  routeMessage,
} from "@/lib/telegram/commands";
import type { TelegramMessage, TelegramUpdate } from "@/lib/telegram/types";
import { isValidWebhookSecret } from "@/lib/telegram/webhook-verify";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { normalizeTelegramHandle } from "@/lib/utils/normalize";

// This route calls out to the real Telegram Bot API and the Supabase
// service-role client -- both require the Node.js runtime (not Edge).
export const runtime = "nodejs";

/**
 * Ack. Every path below this point returns 200 no matter what went wrong:
 * Telegram retries a non-2xx update, and a retry storm on a message we can
 * never handle is worse than a dropped reply. The only non-200s in this file
 * are the secret check (401) and a body that isn't JSON (400) -- genuine
 * infrastructure failures, where a retry is the right answer.
 */
function ack() {
  return NextResponse.json({});
}

export async function POST(request: Request) {
  const expectedSecret = process.env.TELEGRAM_WEBHOOK_SECRET ?? "";
  const headerValue = request.headers.get("x-telegram-bot-api-secret-token");

  if (!isValidWebhookSecret(headerValue, expectedSecret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json();
  } catch {
    // Malformed body is an actual infra failure -- everything else from
    // here on always returns 200 so Telegram doesn't retry-storm us.
    return NextResponse.json({ error: "malformed body" }, { status: 400 });
  }

  const message = update?.message;
  const text = message?.text;
  // Non-message updates and messages with no text at all (a photo, a
  // sticker, a member joining) are acked silently: there is no question to
  // answer, and replying "I didn't understand that" to every sticker would
  // make the bot the thing members mute.
  if (!message || !text) {
    return ack();
  }

  // Where the message came from decides whether we may speak at all. The
  // alert-chat feature puts this bot IN the club group, so a group message
  // that was not explicitly addressed to it (`/cmd@this_bot`) is answered
  // with silence -- see routeMessage for the full rules.
  const route = routeMessage(
    text,
    message.chat.type,
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME,
  );

  if (route.action === "ignore") return ack();

  if (route.action === "fallback") {
    // Private chat only. Plain text, or a command this bot doesn't have.
    // flows.md §8's "Mini App won't load -> bot replies with a plain-text
    // fallback".
    await sendMessageSafely(message.chat.id, buildFallbackText());
    return ack();
  }

  switch (route.command) {
    case "/start":
      return handleStart(message, route.args);
    case "/myitems":
      return handleMyItems(message);
    case "/help":
      await sendMessageSafely(message.chat.id, buildHelpText());
      return ack();
    default:
      // Unreachable: routeMessage only ever hands back a known BotCommand.
      return ack();
  }
}

/**
 * `/start` -- identity binding (docs/tele-qr/flows.md §5). Behaviour and
 * replies are unchanged from the pre-dispatcher version of this route; the
 * only difference is that `/starting` no longer lands here.
 */
async function handleStart(message: TelegramMessage, startArgs: string) {
  const from = message.from;
  if (!from) {
    // No sender info at all -- nothing to bind against; ack and ignore.
    return ack();
  }

  const chatId = message.chat.id;
  const telegramUserId = from.id;
  const rawUsername = from.username;
  const displayNameFromTelegram = [from.first_name, from.last_name]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .trim();

  const startParam = startArgs.length > 0 ? startArgs : null;

  const db = getServiceRoleClient();

  // 1. Already bound to exactly this Telegram id -- idempotent re-`/start`.
  let boundMember;
  try {
    boundMember = await findMemberByTelegramUserId(db, telegramUserId);
  } catch (error) {
    console.error("[/api/tg/webhook] Lookup by telegram_user_id failed:", error);
    return ack();
  }

  if (boundMember) {
    await sendMessageSafely(chatId, `Welcome back, ${memberDisplayName(boundMember)}.`);
    return ack();
  }

  // 2. Not yet bound to this id -- try to match an unbound member by handle.
  const normalizedUsername = rawUsername
    ? normalizeTelegramHandle(rawUsername)
    : null;

  if (normalizedUsername) {
    const { data: candidate, error: candidateLookupError } = await db
      .from("members")
      .select("id, full_name, display_name")
      .eq("telegram_username", normalizedUsername)
      .is("telegram_user_id", null)
      .maybeSingle();

    if (candidateLookupError) {
      console.error(
        "[/api/tg/webhook] Lookup by telegram_username failed:",
        candidateLookupError,
      );
      return ack();
    }

    if (candidate) {
      const { error: updateError } = await db
        .from("members")
        .update({
          telegram_user_id: telegramUserId,
          telegram_bound_at: new Date().toISOString(),
        })
        .eq("id", candidate.id);

      if (updateError) {
        console.error(
          "[/api/tg/webhook] Failed to bind member:",
          updateError,
        );
        return ack();
      }

      const name = candidate.display_name ?? candidate.full_name;
      await sendMessageSafely(chatId, `Welcome, ${name}. You're all set.`);
      return ack();
    }
  }

  // 3. No match by id or handle -- log to the admin bind queue.
  const { error: insertError } = await db.from("telegram_bind_attempts").insert({
    telegram_user_id: telegramUserId,
    username: rawUsername ?? null,
    display_name: displayNameFromTelegram || null,
    scan_code: startParam,
  });

  if (insertError) {
    console.error(
      "[/api/tg/webhook] Failed to insert bind attempt:",
      insertError,
    );
    return ack();
  }

  await sendJoinPrompt(chatId);
  return ack();
}

/**
 * The Join button opens the Mini App's join form through the same kind of
 * direct link a sticker uses, so Telegram hands the form signed initData.
 * Without configured names there is no link to build; the plain refusal
 * still tells them what to do.
 */
async function sendJoinPrompt(chatId: number) {
  let joinUrl: string | null = null;
  try {
    joinUrl = buildJoinUrl(
      process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "",
      process.env.NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME ?? "",
    );
  } catch (error) {
    console.error("[/api/tg/webhook] Can't build the join link:", error);
  }

  if (!joinUrl) {
    await sendMessageSafely(chatId, buildUnknownMemberText());
    return;
  }
  await sendMessageSafely(chatId, buildJoinPromptText(), {
    inlineKeyboard: [[{ text: "Join", url: joinUrl }]],
  });
}

/**
 * `/myitems` -- what this member currently holds, as plain text. The bot-side
 * twin of /store/mine, sharing its `getMemberHoldings` query so the two can
 * never disagree.
 *
 * `message.from` is checked here rather than once at the top of the route:
 * the fallback and /help replies need only a chat id, and refusing to answer
 * them just because an update lacked sender info would be a regression.
 */
async function handleMyItems(message: TelegramMessage) {
  const chatId = message.chat.id;
  const from = message.from;
  if (!from) {
    // Nothing to resolve a member from, so the honest answer is the
    // unrecognised one.
    await sendMessageSafely(chatId, buildUnknownMemberText());
    return ack();
  }

  const db = getServiceRoleClient();

  try {
    const member = await findMemberByTelegramUserId(db, from.id);
    // An inactive member is treated exactly as an unbound one, matching
    // requireMember()'s 403 for `inactive` -- their holdings are club
    // records for an admin to settle, not a self-serve screen.
    if (!member || !member.active) {
      await sendMessageSafely(chatId, buildUnknownMemberText());
      return ack();
    }

    const holders = await getMemberHoldings(db, member.id);
    await sendMessageSafely(chatId, buildMyItemsText(holders));
  } catch (error) {
    // A DB failure must not become a retried update: say so and ack.
    console.error("[/api/tg/webhook] /myitems failed:", error);
    await sendMessageSafely(chatId, "Couldn't look that up just now — try again in a minute.");
  }

  return ack();
}
