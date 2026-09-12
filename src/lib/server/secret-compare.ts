import { timingSafeEqual } from "node:crypto";

/**
 * Constant-time string equality for shared secrets.
 *
 * Extracted from `src/lib/telegram/webhook-verify.ts` when `/api/cron/daily`
 * needed the same check for `CRON_SECRET`: a cron endpoint is a public URL
 * with nothing but a header between it and the internet, which is exactly
 * the webhook's situation. One implementation, so a future fix lands in both.
 *
 * An empty expected value is always a mismatch — a missing env var must mean
 * "nobody gets in", never "everybody does".
 *
 * `timingSafeEqual` throws on unequal lengths, so length is compared first;
 * that leaks the secret's length, which is not a secret worth protecting
 * (and is the same trade the Telegram webhook check has always made).
 */
export function constantTimeEquals(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (!actual || !expected) return false;

  const actualBuf = Buffer.from(actual, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (actualBuf.length !== expectedBuf.length) return false;

  return timingSafeEqual(actualBuf, expectedBuf);
}
