/**
 * Join codes: short, admin-issued, valid for N uses within M minutes
 * (supabase/migrations/0026_join_codes.sql). Isomorphic: the admin page
 * generates codes in the browser, the API normalises them on the server.
 */

import { buildLabelUrl } from "@/lib/codes/label-url";

/**
 * Uppercase letters and digits without 0/O, 1/I/L. Unlike scan codes, a join
 * code is read off a projector and typed on a phone, so it is
 * case-insensitive and has no punctuation. Must match the CHECK in 0026.
 */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const JOIN_CODE_LENGTH = 8;

/** Mini App `startapp` payload prefix that opens the join form. */
export const JOIN_START_PREFIX = "join";

export const JOIN_DEFAULT_MAX_USES = 10;
export const JOIN_DEFAULT_VALID_MINUTES = 5;
export const JOIN_MAX_USES_LIMIT = 500;
export const JOIN_VALID_MINUTES_LIMIT = 10080;

const REJECTION_LIMIT =
  Math.floor(256 / JOIN_CODE_ALPHABET.length) * JOIN_CODE_ALPHABET.length;

/** Unbiased (rejection-sampled) random code, same method as generateScanCode. */
export function generateJoinCode(): string {
  let code = "";
  while (code.length < JOIN_CODE_LENGTH) {
    const bytes = new Uint8Array(JOIN_CODE_LENGTH + 8);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= REJECTION_LIMIT) continue;
      code += JOIN_CODE_ALPHABET[byte % JOIN_CODE_ALPHABET.length];
      if (code.length === JOIN_CODE_LENGTH) break;
    }
  }
  return code;
}

/** `abcd-efgh`, ` ABCD EFGH ` -> `ABCDEFGH`. Same rule as join_with_code(). */
export function normalizeJoinCode(raw: string): string {
  return raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function isWellFormedJoinCode(normalized: string): boolean {
  if (normalized.length !== JOIN_CODE_LENGTH) return false;
  return [...normalized].every((char) => JOIN_CODE_ALPHABET.includes(char));
}

/** `ABCDEFGH` -> `ABCD-EFGH`, for reading aloud. */
export function formatJoinCode(code: string): string {
  const normalized = normalizeJoinCode(code);
  if (normalized.length !== JOIN_CODE_LENGTH) return normalized;
  return `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
}

/**
 * A `startapp` payload that means "open the join form": the bare prefix
 * (from the bot's Join button) or `join_<CODE>` (from an admin's QR).
 * Returns `null` when it is not a join payload at all, `""` when it is one
 * with no code. Unsigned client-side routing hint only -- the code itself is
 * checked by join_with_code().
 */
export function parseJoinStartParam(startParam: string | null | undefined): string | null {
  if (!startParam) return null;
  if (startParam === JOIN_START_PREFIX) return "";
  const prefix = `${JOIN_START_PREFIX}_`;
  if (!startParam.startsWith(prefix)) return null;
  return normalizeJoinCode(startParam.slice(prefix.length));
}

/** `https://t.me/<bot>/<app>?startapp=join[_CODE]`. Throws on bad names. */
export function buildJoinUrl(botUsername: string, appName: string, code?: string): string {
  const payload = code ? `${JOIN_START_PREFIX}_${normalizeJoinCode(code)}` : JOIN_START_PREFIX;
  return buildLabelUrl({ botUsername, appName, code: payload });
}
