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
 * Generates a short, opaque, base64url-safe scan code drawn from
 * `CODE_ALPHABET`, using cryptographically strong, unbiased per-character
 * sampling (never `Math.random()`).
 */
export function generateScanCode(length = 7): string {
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
