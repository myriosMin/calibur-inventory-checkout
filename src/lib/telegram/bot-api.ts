/**
 * Minimal wrapper around the Telegram Bot API's `sendMessage` method.
 *
 * Deliberately thin: throws on any non-ok response (network error or a
 * non-2xx from Telegram, e.g. "chat not found" for a fabricated chat id) so
 * that callers can decide how to handle the failure -- in the webhook route,
 * a failed send is logged and swallowed rather than allowed to fail the
 * whole request, since the inbound webhook was already processed correctly
 * regardless of whether the reply went out.
 */
export async function sendMessage(chatId: number, text: string): Promise<void> {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN. Check .env.local.");
  }

  const response = await fetch(
    `https://api.telegram.org/bot${botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "<unreadable body>");
    throw new Error(
      `Telegram sendMessage failed: ${response.status} ${response.statusText} - ${body}`,
    );
  }
}
