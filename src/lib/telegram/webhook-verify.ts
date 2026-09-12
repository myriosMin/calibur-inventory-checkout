import { constantTimeEquals } from "@/lib/server/secret-compare";

/**
 * Verifies the `X-Telegram-Bot-Api-Secret-Token` header Telegram sends with
 * every webhook request against the secret token configured when the
 * webhook was registered.
 *
 * The secret token is not attacker-supplied-to-be-forged the same way an
 * HMAC signature is, but we still use a constant-time compare for
 * consistency and defense in depth. The compare itself now lives in
 * `src/lib/server/secret-compare.ts`, shared with the `CRON_SECRET` check on
 * `/api/cron/daily` — both are "a public URL guarded by one header".
 */
export function isValidWebhookSecret(
  headerValue: string | null,
  expected: string,
): boolean {
  return constantTimeEquals(headerValue, expected);
}
