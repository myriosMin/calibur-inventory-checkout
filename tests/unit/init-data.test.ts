import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";

import { validateInitData } from "@/lib/telegram/init-data";

const BOT_TOKEN = "123456:FAKE-TEST-BOT-TOKEN-not-real";

/**
 * Local re-implementation of Telegram's initData signing scheme, used only
 * to build a validly-signed fixture for the test below. Deliberately
 * independent of src/lib/telegram/init-data.ts so the test proves a genuine
 * round-trip against the documented algorithm rather than testing the
 * implementation against itself.
 */
function signInitData(
  fields: Record<string, string>,
  botToken: string,
): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  const params = new URLSearchParams({ ...fields, hash });
  return params.toString();
}

function buildFields(overrides: Partial<Record<string, string>> = {}) {
  const base = {
    query_id: "AAHdF6IQAAAAAN0XohDhrOrc",
    user: JSON.stringify({ id: 279058397, first_name: "Test", username: "testuser" }),
    auth_date: String(Math.floor(Date.now() / 1000)),
    ...overrides,
  };
  return base;
}

describe("validateInitData", () => {
  it("accepts a validly-signed payload", () => {
    const fields = buildFields();
    const raw = signInitData(fields, BOT_TOKEN);

    const result = validateInitData(raw, BOT_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.user).toEqual({
        id: 279058397,
        first_name: "Test",
        username: "testuser",
      });
      expect(result.data.authDate).toBe(Number(fields.auth_date));
      expect(result.data.startParam).toBeUndefined();
    }
  });

  it("carries start_param through when present", () => {
    const fields = buildFields({ start_param: "borrow_hero" });
    const raw = signInitData(fields, BOT_TOKEN);

    const result = validateInitData(raw, BOT_TOKEN);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.startParam).toBe("borrow_hero");
    }
  });

  it("rejects a tampered hash with bad_signature", () => {
    const fields = buildFields();
    const raw = signInitData(fields, BOT_TOKEN);

    // Flip the user id after signing, without re-signing: the hash no
    // longer matches the data-check-string.
    const tamperedRaw = raw.replace(
      encodeURIComponent(fields.user),
      encodeURIComponent(JSON.stringify({ id: 999999999, first_name: "Evil" })),
    );

    const result = validateInitData(tamperedRaw, BOT_TOKEN);

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a payload signed with the wrong bot token", () => {
    const fields = buildFields();
    const raw = signInitData(fields, "different:BOT-TOKEN");

    const result = validateInitData(raw, BOT_TOKEN);

    expect(result).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a payload missing the hash field as malformed", () => {
    const fields = buildFields();
    const raw = new URLSearchParams(fields).toString(); // no hash appended

    const result = validateInitData(raw, BOT_TOKEN);

    expect(result).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects an empty raw string as missing", () => {
    const result = validateInitData("", BOT_TOKEN);

    expect(result).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects an expired auth_date", () => {
    const twoDaysAgo = Math.floor(Date.now() / 1000) - 2 * 86400;
    const fields = buildFields({ auth_date: String(twoDaysAgo) });
    const raw = signInitData(fields, BOT_TOKEN);

    const result = validateInitData(raw, BOT_TOKEN);

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("respects a custom maxAgeSeconds", () => {
    const tenMinutesAgo = Math.floor(Date.now() / 1000) - 10 * 60;
    const fields = buildFields({ auth_date: String(tenMinutesAgo) });
    const raw = signInitData(fields, BOT_TOKEN);

    // Still valid under the default 24h window.
    expect(validateInitData(raw, BOT_TOKEN).ok).toBe(true);

    // But rejected under a tighter 5-minute window.
    const result = validateInitData(raw, BOT_TOKEN, 5 * 60);
    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects a malformed user field", () => {
    const fields = buildFields({ user: "{not-json" });
    const raw = signInitData(fields, BOT_TOKEN);

    const result = validateInitData(raw, BOT_TOKEN);

    expect(result).toEqual({ ok: false, reason: "malformed" });
  });
});
