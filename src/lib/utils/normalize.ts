/**
 * Normalizes a Telegram handle for lookup/comparison: lowercases and strips
 * a leading `@` (Telegram usernames are case-insensitive and often typed or
 * stored with a leading `@`).
 */
export function normalizeTelegramHandle(raw: string): string {
  const trimmed = raw.trim();
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  return withoutAt.toLowerCase();
}
