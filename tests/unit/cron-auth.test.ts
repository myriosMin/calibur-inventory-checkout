import { describe, expect, it } from "vitest";

import { isValidCronSecret } from "@/lib/server/cron-auth";
import { constantTimeEquals } from "@/lib/server/secret-compare";
import { isValidWebhookSecret } from "@/lib/telegram/webhook-verify";

const SECRET = "s3cr3t-cron-token";

describe("isValidCronSecret", () => {
  it("accepts the exact Bearer token", () => {
    expect(isValidCronSecret(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    expect(isValidCronSecret("Bearer s3cr3t-cron-tokeN", SECRET)).toBe(false);
  });

  it("rejects a token of a different length", () => {
    expect(isValidCronSecret("Bearer short", SECRET)).toBe(false);
  });

  it("rejects a missing header", () => {
    expect(isValidCronSecret(null, SECRET)).toBe(false);
    expect(isValidCronSecret("", SECRET)).toBe(false);
  });

  it("rejects the bare secret without the Bearer scheme", () => {
    expect(isValidCronSecret(SECRET, SECRET)).toBe(false);
  });

  it("is case-sensitive about the scheme", () => {
    expect(isValidCronSecret(`bearer ${SECRET}`, SECRET)).toBe(false);
  });

  it("FAILS CLOSED when CRON_SECRET is unset", () => {
    // A deploy that forgets the variable should have a silent cron, not an
    // open one -- the route is a public URL.
    expect(isValidCronSecret(`Bearer ${SECRET}`, undefined)).toBe(false);
    expect(isValidCronSecret("Bearer ", "")).toBe(false);
    expect(isValidCronSecret(null, undefined)).toBe(false);
  });
});

describe("constantTimeEquals", () => {
  it("matches identical strings", () => {
    expect(constantTimeEquals("abc", "abc")).toBe(true);
  });

  it("rejects different strings without throwing on a length mismatch", () => {
    expect(constantTimeEquals("abc", "abcd")).toBe(false);
  });

  it("treats an empty or missing side as a mismatch", () => {
    expect(constantTimeEquals("", "")).toBe(false);
    expect(constantTimeEquals(null, "abc")).toBe(false);
    expect(constantTimeEquals("abc", undefined)).toBe(false);
  });

  it("handles multi-byte characters by comparing bytes", () => {
    expect(constantTimeEquals("Ω", "Ω")).toBe(true);
    expect(constantTimeEquals("Ω", "O")).toBe(false);
  });
});

describe("isValidWebhookSecret (unchanged behaviour after the shared extraction)", () => {
  it("still accepts a matching header and rejects everything else", () => {
    expect(isValidWebhookSecret("tok", "tok")).toBe(true);
    expect(isValidWebhookSecret("tok", "other")).toBe(false);
    expect(isValidWebhookSecret(null, "tok")).toBe(false);
    expect(isValidWebhookSecret("tok", "")).toBe(false);
  });
});
