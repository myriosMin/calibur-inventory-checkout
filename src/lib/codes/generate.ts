import { randomInt } from "node:crypto";

/**
 * Base64url alphabet with visually ambiguous characters removed:
 * excludes `0`/`O`, `1`/`l`/`I` so a human can read a code aloud or type
 * it in as a fallback if a label is scanned/damaged.
 */
export const CODE_ALPHABET =
  "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_";

/**
 * Generates a short, opaque, base64url-safe scan code drawn from
 * `CODE_ALPHABET`. Uses `crypto.randomInt` for unbiased, cryptographically
 * strong per-character sampling (never `Math.random()`).
 */
export function generateScanCode(length = 7): string {
  let code = "";
  for (let i = 0; i < length; i++) {
    code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  }
  return code;
}
