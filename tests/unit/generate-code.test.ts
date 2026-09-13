import { describe, expect, it } from "vitest";
import { CODE_ALPHABET, DEFAULT_CODE_LENGTH, generateScanCode } from "@/lib/codes/generate";

const EXCLUDED_CHARS = ["0", "O", "1", "l", "I"];

describe("CODE_ALPHABET", () => {
  it("excludes visually ambiguous characters", () => {
    for (const char of EXCLUDED_CHARS) {
      expect(CODE_ALPHABET).not.toContain(char);
    }
  });

  it("contains only base64url-safe characters", () => {
    expect(CODE_ALPHABET).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("generateScanCode", () => {
  it("defaults to length 7", () => {
    // 6, not 7, and deliberately so: it is what keeps the printed deep link
    // at 53 bytes and every QR at version 3. See DEFAULT_CODE_LENGTH.
    expect(generateScanCode()).toHaveLength(6);
    expect(generateScanCode()).toHaveLength(DEFAULT_CODE_LENGTH);
  });

  it("respects a custom length", () => {
    expect(generateScanCode(12)).toHaveLength(12);
    expect(generateScanCode(3)).toHaveLength(3);
    expect(generateScanCode(20)).toHaveLength(20);
  });

  it("never contains excluded ambiguous characters", () => {
    for (let i = 0; i < 2000; i++) {
      const code = generateScanCode();
      for (const char of EXCLUDED_CHARS) {
        expect(code).not.toContain(char);
      }
    }
  });

  it("only uses characters from CODE_ALPHABET", () => {
    for (let i = 0; i < 2000; i++) {
      const code = generateScanCode(10);
      for (const char of code) {
        expect(CODE_ALPHABET).toContain(char);
      }
    }
  });

  it("produces no duplicates across 10,000 generated codes (birthday-bound sanity check)", () => {
    const count = 10_000;
    const codes = new Set<string>();
    for (let i = 0; i < count; i++) {
      codes.add(generateScanCode());
    }
    expect(codes.size).toBe(count);
  });

  it("has a roughly uniform first-character distribution", () => {
    const count = 10_000;
    const buckets = new Map<string, number>();
    for (let i = 0; i < count; i++) {
      const firstChar = generateScanCode()[0];
      buckets.set(firstChar, (buckets.get(firstChar) ?? 0) + 1);
    }

    // Every alphabet character should plausibly appear at least once.
    expect(buckets.size).toBeGreaterThan(CODE_ALPHABET.length * 0.9);

    const expectedAverage = count / CODE_ALPHABET.length;
    for (const observed of buckets.values()) {
      expect(observed).toBeLessThan(expectedAverage * 2);
    }
  });
});
