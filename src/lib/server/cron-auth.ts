import { constantTimeEquals } from "./secret-compare";

/**
 * Guard for `/api/cron/*`.
 *
 * `architecture.md`'s env table reserves `CRON_SECRET` with the reason
 * stated plainly: **cron endpoints are public URLs.** Vercel's scheduler
 * calls them over the open internet with `Authorization: Bearer
 * $CRON_SECRET`, so anyone who guesses the path can otherwise trigger a
 * purge and a round of bot messages.
 *
 * Fails closed. An unset `CRON_SECRET` rejects every request rather than
 * waving them through — the deploy that forgets the variable should have a
 * silent cron, not an open one.
 */
export function isValidCronSecret(
  authorizationHeader: string | null,
  expectedSecret: string | undefined,
): boolean {
  if (!expectedSecret) return false;
  if (!authorizationHeader) return false;

  const prefix = "Bearer ";
  if (!authorizationHeader.startsWith(prefix)) return false;

  return constantTimeEquals(authorizationHeader.slice(prefix.length), expectedSecret);
}
