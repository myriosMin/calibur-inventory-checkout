import { NextResponse } from "next/server";

import { sendMessage } from "@/lib/telegram/bot-api";
import type { TelegramUpdate } from "@/lib/telegram/types";
import { isValidWebhookSecret } from "@/lib/telegram/webhook-verify";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { normalizeTelegramHandle } from "@/lib/utils/normalize";

// This route calls out to the real Telegram Bot API and the Supabase
// service-role client -- both require the Node.js runtime (not Edge).
export const runtime = "nodejs";

const START_COMMAND = "/start";

/**
 * Sends a reply via the Telegram Bot API, swallowing (and logging) any
 * failure. The webhook itself is considered successfully processed
 * regardless of whether the outbound reply lands, so a Telegram-side error
 * (e.g. a fabricated/unreachable chat id) must never fail the request.
 */
async function sendReplySafely(chatId: number, text: string): Promise<void> {
  try {
    await sendMessage(chatId, text);
  } catch (error) {
    console.error("[/api/tg/webhook] Failed to send Telegram reply:", error);
  }
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
  if (!message || !text || !text.startsWith(START_COMMAND)) {
    return NextResponse.json({});
  }

  const from = message.from;
  if (!from) {
    // No sender info at all -- nothing to bind against; ack and ignore.
    return NextResponse.json({});
  }

  const chatId = message.chat.id;
  const telegramUserId = from.id;
  const rawUsername = from.username;
  const displayNameFromTelegram = [from.first_name, from.last_name]
    .filter((part): part is string => Boolean(part && part.trim()))
    .join(" ")
    .trim();

  const rest = text.slice(START_COMMAND.length).trim();
  const startParam = rest.length > 0 ? rest : null;

  const db = getServiceRoleClient();

  // 1. Already bound to exactly this Telegram id -- idempotent re-`/start`.
  const { data: boundMember, error: boundLookupError } = await db
    .from("members")
    .select("id, full_name, display_name")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (boundLookupError) {
    console.error(
      "[/api/tg/webhook] Lookup by telegram_user_id failed:",
      boundLookupError,
    );
    return NextResponse.json({});
  }

  if (boundMember) {
    const name = boundMember.display_name ?? boundMember.full_name;
    await sendReplySafely(chatId, `Welcome back, ${name}.`);
    return NextResponse.json({});
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
      return NextResponse.json({});
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
        return NextResponse.json({});
      }

      const name = candidate.display_name ?? candidate.full_name;
      await sendReplySafely(chatId, `Welcome, ${name}. You're all set.`);
      return NextResponse.json({});
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
    return NextResponse.json({});
  }

  await sendReplySafely(
    chatId,
    "I don't recognise you — ask a committee member to add you.",
  );
  return NextResponse.json({});
}
