import "./_env";

// ---------------------------------------------------------------------------
// scripts/get-chat-id.ts
//
// Prints the chat ids the bot can see, so the club's Telegram group id can be
// read off and pasted into an env var. The Vercel Cron notifications spec'd in
// docs/tele-qr/flows.md §7 (asset-overdue nudges, low-stock alerts, the weekly
// digest) have to post *somewhere*, and a Telegram group's id is not shown
// anywhere in the Telegram UI -- it only ever appears inside an update payload.
//
// The wrinkle this script exists to handle: **getUpdates and a registered
// webhook are mutually exclusive.** This bot has a webhook set
// (see docs/tele-qr/checkpoint.md WP24 item #5), so a naive getUpdates call
// returns `409 Conflict: terminated by setWebhook`. Worse, while a webhook is
// live, updates are delivered to it and never queued for getUpdates -- so even
// after removing the webhook you only see messages sent *from that moment on*.
//
// Hence two modes:
//   * default              -- read-only. Reports the webhook state and, if
//                             none is set, long-polls for updates.
//   * --release-webhook    -- temporarily deletes the webhook, polls for new
//                             messages, then puts the webhook back exactly as
//                             it was (in a finally, so a Ctrl-C-free crash
//                             still restores it).
//
// Run: npx tsx scripts/get-chat-id.ts [--release-webhook] [--seconds 60]
// ---------------------------------------------------------------------------

/** Suggested env var name for the destination chat. The cron wave may pick a
 *  different one; this is what the script tells the user to set today. */
const SUGGESTED_ENV_VAR = "TELEGRAM_ALERT_CHAT_ID";

function fail(message: string): never {
  console.error(`get-chat-id: ${message}`);
  process.exit(1);
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramUpdate {
  update_id: number;
  message?: { chat: TelegramChat; text?: string; date?: number };
  edited_message?: { chat: TelegramChat; text?: string; date?: number };
  channel_post?: { chat: TelegramChat; text?: string; date?: number };
  my_chat_member?: { chat: TelegramChat; date?: number };
}

interface WebhookInfo {
  url: string;
  pending_update_count: number;
  allowed_updates?: string[];
  max_connections?: number;
}

async function callBotApi<T>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const payload = (await response.json().catch(() => null)) as
    | { ok: boolean; result?: T; description?: string }
    | null;

  if (!payload?.ok) {
    throw new Error(
      `${method} failed: ${response.status} ${response.statusText}` +
        (payload?.description ? ` — ${payload.description}` : ""),
    );
  }
  return payload.result as T;
}

function chatOf(update: TelegramUpdate): TelegramChat | null {
  return (
    update.message?.chat ??
    update.edited_message?.chat ??
    update.channel_post?.chat ??
    update.my_chat_member?.chat ??
    null
  );
}

function describeChat(chat: TelegramChat): string {
  const name =
    chat.title ??
    [chat.first_name, chat.last_name].filter(Boolean).join(" ") ??
    "(no title)";
  const handle = chat.username ? ` @${chat.username}` : "";
  return `${name || "(no title)"}${handle}`;
}

/**
 * Polls getUpdates until the deadline, accumulating every distinct chat seen.
 *
 * `offset` is advanced past each batch so a long-poll doesn't re-serve the
 * same updates; the *first* call uses no offset so anything already queued
 * (only possible when no webhook is set) is included.
 */
async function collectChats(
  token: string,
  deadlineMs: number,
): Promise<Map<number, { chat: TelegramChat; lastText: string | null }>> {
  const found = new Map<number, { chat: TelegramChat; lastText: string | null }>();
  let offset: number | undefined;

  while (Date.now() < deadlineMs) {
    const remainingSeconds = Math.max(1, Math.ceil((deadlineMs - Date.now()) / 1000));
    const updates = await callBotApi<TelegramUpdate[]>(token, "getUpdates", {
      // Telegram caps long-poll at 50s; keep each poll inside the deadline so
      // the script doesn't overshoot the window the user was told to expect.
      timeout: Math.min(25, remainingSeconds),
      ...(offset !== undefined ? { offset } : {}),
      // Deliberately NO allowed_updates. Passing it here *persists* as the
      // bot's "previous setting", and setWebhook inherits that previous
      // setting when it is called without an allowed_updates of its own --
      // so filtering the poll would silently narrow the restored webhook's
      // subscription. (Observed for real while testing this script.) A chat
      // id appears in an ordinary `message` update anyway, which is in every
      // default subscription.
    });

    for (const update of updates) {
      offset = update.update_id + 1;
      const chat = chatOf(update);
      if (!chat) continue;
      const text =
        update.message?.text ?? update.edited_message?.text ?? update.channel_post?.text ?? null;
      found.set(chat.id, { chat, lastText: text ?? found.get(chat.id)?.lastText ?? null });
      console.log(`  seen: ${chat.id}  ${chat.type}  ${describeChat(chat)}`);
    }
  }

  return found;
}

function printResults(found: Map<number, { chat: TelegramChat; lastText: string | null }>) {
  if (found.size === 0) {
    console.log("\nNo chats seen.");
    console.log(
      "If you were expecting one: make sure you added the bot to the group AND sent a\n" +
        "message in that group while this script was polling. Telegram only reveals a\n" +
        "group's id inside an update, so a silent group is invisible here.",
    );
    console.log(
      "\nAlso check the group's privacy setting: by default a bot in a group only\n" +
        "receives messages that start with a command or @mention it. Sending\n" +
        "`/start@<your_bot>` in the group is the reliable way to produce an update.",
    );
    return;
  }

  console.log(`\nChats seen (${found.size}):\n`);
  console.log("  chat id".padEnd(20) + "type".padEnd(14) + "name");
  console.log("  " + "-".repeat(62));
  for (const { chat, lastText } of found.values()) {
    console.log(
      "  " +
        String(chat.id).padEnd(18) +
        chat.type.padEnd(14) +
        describeChat(chat) +
        (lastText ? `   (last message: "${lastText.slice(0, 40)}")` : ""),
    );
  }

  const groups = [...found.values()].filter(
    ({ chat }) => chat.type === "group" || chat.type === "supergroup" || chat.type === "channel",
  );

  console.log("\nWhat to do with this:");
  console.log(
    `  The club group is a negative id starting with -100 (a "supergroup"). A\n` +
      `  positive id is a one-to-one chat with a person -- that is NOT what the\n` +
      `  cron notifications should post to.`,
  );
  if (groups.length > 0) {
    console.log(`\n  Most likely the one you want:\n`);
    for (const { chat } of groups) {
      console.log(`    ${SUGGESTED_ENV_VAR}=${chat.id}    # ${describeChat(chat)} (${chat.type})`);
    }
  }
  console.log(
    `\n  Add that line to .env.local, and add the same variable in the Vercel\n` +
      `  project settings (Production + Preview) so the deployed cron job has it.\n` +
      `  It is server-only -- do NOT prefix it with NEXT_PUBLIC_.`,
  );
  console.log(
    `\n  Sanity check before relying on it: the bot must still be a member of\n` +
      `  that group when the cron runs. If it is removed and re-added, the id of\n` +
      `  a supergroup stays the same, but a basic group that gets upgraded to a\n` +
      `  supergroup gets a NEW id -- re-run this script if alerts go quiet.`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  const releaseWebhook = args.includes("--release-webhook");
  const secondsIndex = args.indexOf("--seconds");
  const seconds =
    secondsIndex >= 0 && args[secondsIndex + 1] ? Number(args[secondsIndex + 1]) : 45;

  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 300) {
    fail("--seconds must be a number between 1 and 300.");
  }

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) fail("Missing TELEGRAM_BOT_TOKEN. Check .env.local (see .env.local.example).");

  const me = await callBotApi<{ username: string; first_name: string }>(token, "getMe");
  console.log(`Bot: @${me.username} (${me.first_name})\n`);

  const info = await callBotApi<WebhookInfo>(token, "getWebhookInfo");

  if (!info.url) {
    console.log("No webhook is registered — polling getUpdates directly.");
    console.log(
      `Add @${me.username} to the club group and send a message there now.\n` +
        `Polling for ${seconds}s…\n`,
    );
    printResults(await collectChats(token, Date.now() + seconds * 1000));
    return;
  }

  console.log(`A webhook IS registered: ${info.url}`);
  console.log(`  pending updates: ${info.pending_update_count}`);

  if (!releaseWebhook) {
    console.log(
      "\nTelegram will not serve getUpdates while a webhook is set (it answers\n" +
        "409 Conflict), and updates are being delivered to the webhook instead of\n" +
        "being queued. So there is nothing to read without briefly removing it.\n",
    );
    console.log("Options:");
    console.log(
      `  1. Re-run with --release-webhook. This deletes the webhook, polls for\n` +
        `     ${seconds}s while you send a message in the group, then restores the\n` +
        `     webhook to exactly the URL above. Bot binding (/start) is deaf for\n` +
        `     that window — a few seconds, on a club bot, at a time you choose.`,
    );
    console.log(
      `  2. Leave the webhook alone and read the id from the webhook's own logs:\n` +
        `     send a message in the group and look at the Vercel function logs for\n` +
        `     /api/tg/webhook — the update payload contains message.chat.id.`,
    );
    console.log(
      `  3. Add @RawDataBot (a third-party bot) to the group; it replies with the\n` +
        `     chat id. Remove it afterwards. Quickest, but a stranger's bot briefly\n` +
        `     sees the group — your call whether that's acceptable.`,
    );
    return;
  }

  // --- --release-webhook: delete, poll, always restore. ---
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    fail(
      "Missing TELEGRAM_WEBHOOK_SECRET — refusing to remove the webhook, because\n" +
        "  restoring it without the secret token would leave /api/tg/webhook rejecting\n" +
        "  every real Telegram call. Set it in .env.local and re-run.",
    );
  }

  console.log(`\nRemoving the webhook temporarily…`);
  await callBotApi(token, "deleteWebhook", { drop_pending_updates: false });

  let restored = false;
  const restore = async () => {
    if (restored) return;
    restored = true;
    try {
      await callBotApi(token, "setWebhook", {
        url: info.url,
        secret_token: secret,
        // ALWAYS explicit. Omitting allowed_updates makes setWebhook inherit
        // "the previous setting", which is not necessarily what this webhook
        // had -- and getWebhookInfo omits the field entirely when the webhook
        // is on Telegram's default subscription, which `[]` is the documented
        // way to ask for. So `?? []` restores the default rather than
        // inheriting whatever the bot's last poll happened to leave behind.
        allowed_updates: info.allowed_updates ?? [],
        ...(info.max_connections ? { max_connections: info.max_connections } : {}),
      });
      const check = await callBotApi<WebhookInfo>(token, "getWebhookInfo");
      console.log(
        check.url === info.url
          ? `\nWebhook restored: ${check.url}`
          : `\nWARNING: webhook is now "${check.url}", expected "${info.url}". Fix this before relying on /start.`,
      );
    } catch (err) {
      console.error(
        `\nFAILED TO RESTORE THE WEBHOOK (${err instanceof Error ? err.message : String(err)}).\n` +
          `Telegram binding is DOWN until you re-run setWebhook with url=${info.url}\n` +
          `and secret_token=<TELEGRAM_WEBHOOK_SECRET>.`,
      );
      process.exitCode = 1;
    }
  };

  // Restore on Ctrl-C too, not just on the happy path.
  process.once("SIGINT", () => {
    void restore().then(() => process.exit(130));
  });

  try {
    console.log(
      `Webhook removed. Send a message in the club group NOW (if the bot isn't in\n` +
        `it yet, add it first). Polling for ${seconds}s…\n`,
    );
    const found = await collectChats(token, Date.now() + seconds * 1000);
    printResults(found);
  } finally {
    await restore();
  }
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
