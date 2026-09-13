/**
 * The deep link printed into every QR sticker, and the size budget that
 * keeps it scannable at the 20 mm label size docs/tele-qr/qr-labels.md
 * mandates.
 *
 * Shape: `https://t.me/<bot>/<app>?startapp=<code>`
 *
 * Why this file is so defensive for what is really just string
 * concatenation: a print run is ~360-500 polyester stickers that get
 * cleaned with IPA and stuck onto bins by hand over an afternoon. A link
 * that is two bytes too long does not fail -- it silently pushes every
 * symbol from QR version 3 (29x29 modules) to version 4 (33x33), shrinking
 * each module by ~12% at the same physical size and making every sticker
 * measurably harder for a phone to focus on. That is not a bug you find in
 * review; it is one you find six months later, on a shelf, holding a phone.
 * So the budget is asserted here, exercised by tests/unit/label-url.test.ts,
 * and surfaced as a banner on /admin/labels.
 */

import { DEFAULT_CODE_LENGTH } from "@/lib/codes/generate";

/** Telegram's hard cap on the `startapp` query payload. */
export const MAX_STARTAPP_LENGTH = 64;

/**
 * `startapp` accepts base64url only: `A-Z a-z 0-9 _ -`. Note this is the
 * *transport* alphabet; `CODE_ALPHABET` in ./generate.ts is a deliberate
 * subset of it that also drops the visually ambiguous `0/O` and `1/l/I`.
 */
export const STARTAPP_ALPHABET_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Telegram bot usernames and Mini App short names: letters, digits, `_`. */
const TELEGRAM_NAME_PATTERN = /^[A-Za-z0-9_]+$/;

/**
 * Byte-mode data capacity per QR version at error correction level L,
 * indexed by `version - 1`. Only the low versions are listed because
 * anything past version 6 is already far outside what a 20 mm label can
 * carry. Source: ISO/IEC 18004 capacity tables.
 */
export const BYTE_CAPACITY_L = [17, 32, 53, 78, 106, 134] as const;

/**
 * The budget. Version 3 at EC level L holds 53 bytes, and version 3 is the
 * largest symbol that reliably scans at 20 mm from arm's length under lab
 * lighting -- so 53 bytes is the whole link, not just the code.
 */
export const QR_V3_L_BYTE_BUDGET = BYTE_CAPACITY_L[2];

/** Module count (per side) of the symbol for a given QR version. */
export function qrModuleCount(version: number): number {
  return 17 + 4 * version;
}

/**
 * Smallest QR version at EC level L that holds `byteLength` bytes, or
 * `null` if it needs a symbol bigger than this table covers (which, for a
 * label, means "too long, full stop").
 */
export function qrVersionForBytes(byteLength: number): number | null {
  for (let i = 0; i < BYTE_CAPACITY_L.length; i++) {
    if (byteLength <= BYTE_CAPACITY_L[i]) return i + 1;
  }
  return null;
}

export interface LabelUrlInput {
  /** Bot username without the leading `@`, e.g. `calibur_checkout_bot`. */
  botUsername: string;
  /** Mini App short name as registered in BotFather, e.g. `s`. */
  appName: string;
  /** The `scan_codes.code` value this label points at. */
  code: string;
}

export interface BuildLabelUrlOptions {
  /**
   * Throw instead of returning when the finished URL exceeds
   * `QR_V3_L_BYTE_BUDGET`. Off by default: an over-budget link still works,
   * it just prints a denser symbol, so the admin UI needs to render the
   * labels *and* shout about it rather than crash. Tests turn this on.
   */
  strict?: boolean;
}

export class LabelUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelUrlError";
  }
}

function requireName(value: string, field: string): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) {
    throw new LabelUrlError(
      `${field} is empty. Set NEXT_PUBLIC_TELEGRAM_BOT_USERNAME and NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME in .env.local.`,
    );
  }
  if (!TELEGRAM_NAME_PATTERN.test(trimmed)) {
    throw new LabelUrlError(
      `${field} "${trimmed}" is not a valid Telegram name (letters, digits and underscore only, no leading @).`,
    );
  }
  return trimmed;
}

/** UTF-8 byte length -- what a QR encoder actually counts, not `.length`. */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/**
 * Builds the deep link for one label.
 *
 * Throws (always) when the link would not *work*: a blank/invalid bot or
 * app name, a code outside the base64url alphabet, or a code past
 * Telegram's 64-char `startapp` cap. Throws on the 53-byte QR budget only
 * under `{ strict: true }` -- see `BuildLabelUrlOptions.strict`.
 */
export function buildLabelUrl(
  input: LabelUrlInput,
  options: BuildLabelUrlOptions = {},
): string {
  const botUsername = requireName(input.botUsername, "Bot username");
  const appName = requireName(input.appName, "Mini App short name");

  const code = input.code?.trim() ?? "";
  if (!code) {
    throw new LabelUrlError("Scan code is empty -- nothing to encode.");
  }
  if (!STARTAPP_ALPHABET_PATTERN.test(code)) {
    throw new LabelUrlError(
      `Scan code "${code}" contains characters outside the base64url alphabet (A-Z a-z 0-9 _ -) that Telegram's startapp parameter accepts.`,
    );
  }
  if (code.length > MAX_STARTAPP_LENGTH) {
    throw new LabelUrlError(
      `Scan code is ${code.length} characters; Telegram caps the startapp payload at ${MAX_STARTAPP_LENGTH}.`,
    );
  }

  const url = `https://t.me/${botUsername}/${appName}?startapp=${code}`;

  if (options.strict) {
    const byteLength = utf8ByteLength(url);
    if (byteLength > QR_V3_L_BYTE_BUDGET) {
      throw new LabelUrlError(
        `Label URL is ${byteLength} bytes, ${byteLength - QR_V3_L_BYTE_BUDGET} over the ${QR_V3_L_BYTE_BUDGET}-byte QR version 3 (EC L) budget: ${url}`,
      );
    }
  }

  return url;
}

export interface LabelUrlBudget {
  /** A representative URL built from the configured names. */
  sampleUrl: string;
  byteLength: number;
  budget: number;
  withinBudget: boolean;
  /** Bytes over budget; 0 when within it. */
  overBy: number;
  /** Smallest QR version at EC L that fits, or null if nothing here does. */
  qrVersion: number | null;
  /** Modules per side for `qrVersion`, or null alongside it. */
  moduleCount: number | null;
  /**
   * Hard configuration errors (bad/missing names). Non-empty means labels
   * cannot be produced at all, not merely that they'd print dense.
   */
  error: string | null;
}

/**
 * Non-throwing budget check for the admin UI: "would the configured bot and
 * app names blow the version-3 budget?" Defaults to the length of a generated
 * code rather than taking a real one, so the answer is about the
 * *configuration* and not about one particular sticker.
 *
 * The default tracks `DEFAULT_CODE_LENGTH` deliberately: the code length is
 * the lever that was actually used to get under budget (Telegram requires a
 * Mini App short name of at least 3 characters, so `app` could not be
 * shortened), and this check has to reflect what the generator really emits.
 */
export function inspectLabelUrlConfig(
  botUsername: string,
  appName: string,
  codeLength = DEFAULT_CODE_LENGTH,
): LabelUrlBudget {
  const empty: LabelUrlBudget = {
    sampleUrl: "",
    byteLength: 0,
    budget: QR_V3_L_BYTE_BUDGET,
    withinBudget: false,
    overBy: 0,
    qrVersion: null,
    moduleCount: null,
    error: null,
  };

  try {
    // "A" repeated is in both the startapp alphabet and CODE_ALPHABET, and
    // every candidate character is one ASCII byte, so any code of this
    // length produces a URL of exactly this byte length.
    const sampleUrl = buildLabelUrl({
      botUsername,
      appName,
      code: "A".repeat(Math.max(1, codeLength)),
    });
    const byteLength = utf8ByteLength(sampleUrl);
    const qrVersion = qrVersionForBytes(byteLength);
    return {
      sampleUrl,
      byteLength,
      budget: QR_V3_L_BYTE_BUDGET,
      withinBudget: byteLength <= QR_V3_L_BYTE_BUDGET,
      overBy: Math.max(0, byteLength - QR_V3_L_BYTE_BUDGET),
      qrVersion,
      moduleCount: qrVersion === null ? null : qrModuleCount(qrVersion),
      error: null,
    };
  } catch (err) {
    return {
      ...empty,
      error: err instanceof Error ? err.message : "Invalid label URL configuration.",
    };
  }
}
