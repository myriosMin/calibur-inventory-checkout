import { createHmac, timingSafeEqual } from "node:crypto";

import type {
  InitDataValidationResult,
  TelegramInitDataUser,
} from "./types";

const DEFAULT_MAX_AGE_SECONDS = 86400;

/**
 * Validates a Telegram Mini App `initData` string per Telegram's documented
 * scheme: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 *
 * Pure function: no framework imports, no network/DB calls. Safe to unit test
 * directly.
 */
export function validateInitData(
  raw: string,
  botToken: string,
  maxAgeSeconds: number = DEFAULT_MAX_AGE_SECONDS,
): InitDataValidationResult {
  if (!raw) {
    return { ok: false, reason: "missing" };
  }

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(raw);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  const hash = params.get("hash");
  if (!hash) {
    return { ok: false, reason: "malformed" };
  }

  // Build the data-check-string: remaining keys sorted lexicographically,
  // `key=value` joined by `\n`.
  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === "hash") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const computedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");

  const computedBuf = Buffer.from(computedHash, "hex");
  const providedBuf = Buffer.from(hash, "hex");
  if (
    computedBuf.length !== providedBuf.length ||
    providedBuf.length === 0 ||
    !timingSafeEqual(computedBuf, providedBuf)
  ) {
    return { ok: false, reason: "bad_signature" };
  }

  const authDateRaw = params.get("auth_date");
  if (!authDateRaw) {
    return { ok: false, reason: "malformed" };
  }
  const authDate = Number(authDateRaw);
  if (!Number.isFinite(authDate)) {
    return { ok: false, reason: "malformed" };
  }

  const now = Math.floor(Date.now() / 1000);
  if (now - authDate > maxAgeSeconds) {
    return { ok: false, reason: "expired" };
  }

  const userRaw = params.get("user");
  if (!userRaw) {
    return { ok: false, reason: "malformed" };
  }

  let user: TelegramInitDataUser;
  try {
    user = JSON.parse(userRaw);
  } catch {
    return { ok: false, reason: "malformed" };
  }

  if (typeof user?.id !== "number") {
    return { ok: false, reason: "malformed" };
  }

  const startParam = params.get("start_param") ?? undefined;

  return {
    ok: true,
    data: {
      user,
      authDate,
      ...(startParam !== undefined ? { startParam } : {}),
    },
  };
}
