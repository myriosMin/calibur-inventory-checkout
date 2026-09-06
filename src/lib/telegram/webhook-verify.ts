import { timingSafeEqual } from "node:crypto";

/**
 * Verifies the `X-Telegram-Bot-Api-Secret-Token` header Telegram sends with
 * every webhook request against the secret token configured when the
 * webhook was registered.
 *
 * The secret token is not attacker-supplied-to-be-forged the same way an
 * HMAC signature is, but we still use `timingSafeEqual` for consistency and
 * defense in depth.
 */
export function isValidWebhookSecret(
  headerValue: string | null,
  expected: string,
): boolean {
  if (!headerValue || !expected) {
    return false;
  }

  const headerBuf = Buffer.from(headerValue, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (headerBuf.length !== expectedBuf.length) {
    return false;
  }

  return timingSafeEqual(headerBuf, expectedBuf);
}
