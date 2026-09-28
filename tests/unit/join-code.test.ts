import { describe, expect, it } from "vitest";

import {
  JOIN_CODE_ALPHABET,
  JOIN_CODE_LENGTH,
  buildJoinUrl,
  formatJoinCode,
  generateJoinCode,
  isWellFormedJoinCode,
  normalizeJoinCode,
  parseJoinStartParam,
} from "@/lib/join/code";
import { auditJoinCode, formatTimeLeft, joinCodeStatus } from "@/lib/join/audit";
import {
  isJoinSuccess,
  joinOutcomeMessage,
  joinOutcomeStatus,
  JOIN_OUTCOMES,
  validateJoinRequest,
} from "@/lib/join/request";

describe("join codes", () => {
  it("generates well-formed codes from the unambiguous alphabet", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateJoinCode();
      expect(code).toHaveLength(JOIN_CODE_LENGTH);
      expect(isWellFormedJoinCode(code)).toBe(true);
    }
    expect(JOIN_CODE_ALPHABET).not.toMatch(/[01OIL]/);
  });

  it("matches the CHECK constraint in 0026_join_codes.sql", () => {
    expect(JOIN_CODE_ALPHABET).toBe("ABCDEFGHJKMNPQRSTUVWXYZ23456789");
  });

  it("normalises what people actually type", () => {
    expect(normalizeJoinCode(" abcd-ef23 ")).toBe("ABCDEF23");
    expect(normalizeJoinCode("ABCD EF23")).toBe("ABCDEF23");
    expect(formatJoinCode("abcdef23")).toBe("ABCD-EF23");
  });

  it("rejects codes with ambiguous or missing characters", () => {
    expect(isWellFormedJoinCode("ABCDEF2")).toBe(false);
    expect(isWellFormedJoinCode("ABCDEF20")).toBe(false);
    expect(isWellFormedJoinCode("ABCDEFGI")).toBe(false);
  });

  it("recognises join start params and nothing else", () => {
    expect(parseJoinStartParam("join")).toBe("");
    expect(parseJoinStartParam("join_abcdef23")).toBe("ABCDEF23");
    expect(parseJoinStartParam("aB3xYz")).toBeNull();
    expect(parseJoinStartParam("joinXY")).toBeNull();
    expect(parseJoinStartParam(null)).toBeNull();
  });

  it("builds the Mini App link with and without a code", () => {
    expect(buildJoinUrl("calibur_checkout_bot", "app")).toBe(
      "https://t.me/calibur_checkout_bot/app?startapp=join",
    );
    expect(buildJoinUrl("calibur_checkout_bot", "app", "abcd-ef23")).toBe(
      "https://t.me/calibur_checkout_bot/app?startapp=join_ABCDEF23",
    );
    expect(() => buildJoinUrl("", "app")).toThrow();
  });
});

describe("validateJoinRequest", () => {
  const good = {
    code: "abcd-ef23",
    fullName: "  Tan   Ah Kow ",
    displayName: "",
    email: "E0123456@U.NUS.EDU",
    acceptedNotice: true,
  };

  it("normalises a good request", () => {
    expect(validateJoinRequest(good)).toEqual({
      ok: true,
      body: {
        code: "ABCDEF23",
        fullName: "Tan Ah Kow",
        displayName: null,
        email: "e0123456@u.nus.edu",
      },
    });
  });

  it("reports every problem at once", () => {
    const result = validateJoinRequest({ code: "x", fullName: " ", email: "nope" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors).sort()).toEqual(
      ["acceptedNotice", "code", "email", "fullName"].sort(),
    );
  });

  it("requires the notice to be accepted explicitly", () => {
    const result = validateJoinRequest({ ...good, acceptedNotice: "true" });
    expect(result.ok).toBe(false);
  });

  it("survives a non-object body", () => {
    expect(validateJoinRequest(null).ok).toBe(false);
    expect(validateJoinRequest("hello").ok).toBe(false);
  });
});

describe("join outcomes", () => {
  it("has a message and a status for every outcome", () => {
    for (const outcome of JOIN_OUTCOMES) {
      expect(joinOutcomeMessage(outcome).length).toBeGreaterThan(0);
      expect(joinOutcomeStatus(outcome) === 200).toBe(isJoinSuccess(outcome));
    }
    expect(joinOutcomeStatus("exhausted")).toBe(403);
    expect(joinOutcomeStatus("email_taken")).toBe(409);
    expect(joinOutcomeStatus("rate_limited")).toBe(429);
    expect(isJoinSuccess("linked")).toBe(true);
    expect(isJoinSuccess("needs_committee")).toBe(false);
  });
});

describe("join code audit", () => {
  const now = new Date("2026-10-01T10:00:00Z");
  const code = {
    id: "c1",
    max_uses: 3,
    used_count: 1,
    expires_at: "2026-10-01T10:05:00Z",
    revoked_at: null,
  };

  it("derives status, revoked first", () => {
    expect(joinCodeStatus(code, now)).toBe("active");
    expect(joinCodeStatus({ ...code, used_count: 3 }, now)).toBe("used_up");
    expect(joinCodeStatus({ ...code, expires_at: "2026-10-01T09:59:59Z" }, now)).toBe("expired");
    expect(joinCodeStatus({ ...code, used_count: 3, revoked_at: "2026-10-01T09:00:00Z" }, now)).toBe(
      "revoked",
    );
  });

  it("counts attempts after close as the leak signal", () => {
    const audit = auditJoinCode(
      code,
      [
        { join_code_id: "c1", outcome: "created" },
        { join_code_id: "c1", outcome: "linked" },
        { join_code_id: "c1", outcome: "exhausted" },
        { join_code_id: "c1", outcome: "expired" },
        { join_code_id: "c1", outcome: "email_taken" },
        { join_code_id: "c2", outcome: "exhausted" },
        { join_code_id: null, outcome: "unknown_code" },
      ],
      now,
    );
    expect(audit).toEqual({ status: "active", joined: 2, lateAttempts: 2, blocked: 1 });
  });

  it("formats the countdown", () => {
    expect(formatTimeLeft("2026-10-01T10:04:05Z", now)).toBe("4m 05s");
    expect(formatTimeLeft("2026-10-01T11:02:00Z", now)).toBe("1h 02m");
    expect(formatTimeLeft("2026-10-01T09:00:00Z", now)).toBe("0s");
  });
});
