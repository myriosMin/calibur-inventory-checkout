/**
 * Base64url alphabet with visually ambiguous characters removed:
 * excludes `0`/`O`, `1`/`l`/`I` so a human can read a code aloud or type
 * it in as a fallback if a label is scanned/damaged.
 */
export const CODE_ALPHABET =
  "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789-_";

// 256 is not a multiple of the alphabet length (59), so a plain `byte % 59`
// would make the first 256 % 59 = 20 characters ~17% more likely than the
// rest. Rejection sampling: discard any byte at or above the largest
// multiple of the alphabet length that fits in a byte, then take the
// remainder. This is exactly what `node:crypto`'s randomInt() does
// internally -- same output distribution, but built on
// `crypto.getRandomValues`, which exists in both Node 18+ and the browser.
//
// Isomorphic on purpose: this module is imported by the *client* component
// src/app/admin/scan-codes/page.tsx, and `import { randomInt } from
// "node:crypto"` cannot be bundled for the browser.
const REJECTION_LIMIT =
  Math.floor(256 / CODE_ALPHABET.length) * CODE_ALPHABET.length;

/**
 * Default code length, and the reason it is 6 rather than 7.
 *
 * The printed deep link is `https://t.me/<bot>/<app>?startapp=<code>`. With
 * the club's final names (`calibur_checkout_bot` / `app`) the fixed part is
 * exactly 47 bytes, and QR version 3 at error-correction L holds 53 -- so a
 * 6-character code lands precisely on the budget and a 7-character one tips
 * every sticker into version 4 (33x33 modules instead of 29x29), shrinking
 * each module by ~12% at the same 20 mm physical size.
 *
 * Shortening the code is the only lever available: Telegram requires a Mini
 * App short name of at least 3 characters, so `app` cannot be shortened, and
 * changing the bot username is the one true reprint-everything event
 * (docs/tele-qr/operations.md).
 *
 * The cost is nil. 59^6 is ~42 billion combinations, so across 500 labels the
 * chance of any collision is ~3e-6 -- and `insertScanCodeWithRetry` already
 * retries on the unique-violation anyway.
 */
export const DEFAULT_CODE_LENGTH = 6;

/**
 * Generates a short, opaque, base64url-safe scan code drawn from
 * `CODE_ALPHABET`, using cryptographically strong, unbiased per-character
 * sampling (never `Math.random()`).
 */
export function generateScanCode(length = DEFAULT_CODE_LENGTH): string {
  let code = "";
  // Over-fetch: 236 of 256 byte values are accepted (~92%), so asking for
  // a few extra up front means one getRandomValues() call covers the whole
  // code in practice, while the loop still refills if an unlucky run of
  // rejects exhausts the buffer.
  while (code.length < length) {
    const bytes = new Uint8Array(length - code.length + 8);
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte >= REJECTION_LIMIT) continue;
      code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
      if (code.length === length) break;
    }
  }
  return code;
}
