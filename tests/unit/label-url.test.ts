import { describe, expect, it } from "vitest";
import QRCode from "qrcode";

import { generateScanCode } from "@/lib/codes/generate";
import {
  BYTE_CAPACITY_L,
  buildLabelUrl,
  inspectLabelUrlConfig,
  LabelUrlError,
  MAX_STARTAPP_LENGTH,
  QR_V3_L_BYTE_BUDGET,
  qrModuleCount,
  qrVersionForBytes,
  STARTAPP_ALPHABET_PATTERN,
  utf8ByteLength,
} from "@/lib/codes/label-url";
import { encodeQrSymbol, MIN_QR_SYMBOL_MM, symbolSizeMm } from "@/lib/codes/qr";

const BOT = "calibur_checkout_bot";

describe("buildLabelUrl", () => {
  it("builds the Telegram Mini App deep link", () => {
    expect(buildLabelUrl({ botUsername: BOT, appName: "s", code: "A3F9K2z" })).toBe(
      "https://t.me/calibur_checkout_bot/s?startapp=A3F9K2z",
    );
  });

  it("trims surrounding whitespace on every part", () => {
    expect(
      buildLabelUrl({ botUsername: ` ${BOT} `, appName: " s ", code: " A3F9K2z " }),
    ).toBe("https://t.me/calibur_checkout_bot/s?startapp=A3F9K2z");
  });

  it("rejects a missing bot username or app name", () => {
    expect(() => buildLabelUrl({ botUsername: "", appName: "s", code: "abc" })).toThrow(
      LabelUrlError,
    );
    expect(() => buildLabelUrl({ botUsername: BOT, appName: "", code: "abc" })).toThrow(
      /NEXT_PUBLIC_TELEGRAM_MINIAPP_NAME/,
    );
  });

  it("rejects an @-prefixed or otherwise invalid bot username", () => {
    expect(() =>
      buildLabelUrl({ botUsername: `@${BOT}`, appName: "s", code: "abc" }),
    ).toThrow(/not a valid Telegram name/);
    expect(() =>
      buildLabelUrl({ botUsername: "bot name", appName: "s", code: "abc" }),
    ).toThrow(LabelUrlError);
  });

  describe("startapp alphabet", () => {
    it("accepts the full base64url alphabet", () => {
      expect(() =>
        buildLabelUrl({ botUsername: BOT, appName: "s", code: "aZ09_-" }),
      ).not.toThrow();
    });

    it.each(["a+b", "a/b", "a=b", "a.b", "a b", "a%b", "a?b", "a&b"])(
      "rejects %s",
      (code) => {
        expect(() => buildLabelUrl({ botUsername: BOT, appName: "s", code })).toThrow(
          /base64url alphabet/,
        );
      },
    );

    it("rejects an empty code", () => {
      expect(() => buildLabelUrl({ botUsername: BOT, appName: "s", code: "" })).toThrow(
        /empty/,
      );
    });

    it("accepts every code generateScanCode produces", () => {
      for (let i = 0; i < 500; i++) {
        const code = generateScanCode();
        expect(code).toMatch(STARTAPP_ALPHABET_PATTERN);
        expect(() => buildLabelUrl({ botUsername: BOT, appName: "s", code })).not.toThrow();
      }
    });
  });

  describe("startapp length cap", () => {
    it("accepts a code at exactly the cap", () => {
      const code = "a".repeat(MAX_STARTAPP_LENGTH);
      expect(() => buildLabelUrl({ botUsername: BOT, appName: "s", code })).not.toThrow();
    });

    it("rejects one character past the cap", () => {
      const code = "a".repeat(MAX_STARTAPP_LENGTH + 1);
      expect(() => buildLabelUrl({ botUsername: BOT, appName: "s", code })).toThrow(
        new RegExp(`caps the startapp payload at ${MAX_STARTAPP_LENGTH}`),
      );
    });
  });

  describe("the 53-byte QR version 3 budget", () => {
    // A URL of exactly the budget: "https://t.me/" (13) + bot + "/" + app +
    // "?startapp=" (10) + code.
    const fixedOverhead = "https://t.me//?startapp=".length;

    it("passes strict mode at exactly the budget", () => {
      const codeLength = QR_V3_L_BYTE_BUDGET - fixedOverhead - BOT.length - 1;
      const url = buildLabelUrl(
        { botUsername: BOT, appName: "s", code: "a".repeat(codeLength) },
        { strict: true },
      );
      expect(utf8ByteLength(url)).toBe(QR_V3_L_BYTE_BUDGET);
    });

    it("throws in strict mode one byte over the budget", () => {
      const codeLength = QR_V3_L_BYTE_BUDGET - fixedOverhead - BOT.length;
      expect(() =>
        buildLabelUrl(
          { botUsername: BOT, appName: "s", code: "a".repeat(codeLength) },
          { strict: true },
        ),
      ).toThrow(/54 bytes, 1 over the 53-byte QR version 3/);
    });

    it("still returns a usable URL over budget when not strict", () => {
      // The non-strict path is what /admin/labels uses: an over-budget link
      // must still print (denser, with a banner) rather than crash the page.
      const url = buildLabelUrl({ botUsername: BOT, appName: "app", code: "A3F9K2z" });
      expect(url).toBe("https://t.me/calibur_checkout_bot/app?startapp=A3F9K2z");
      expect(utf8ByteLength(url)).toBeGreaterThan(QR_V3_L_BYTE_BUDGET);
    });
  });
});

describe("qrVersionForBytes", () => {
  it("maps the capacity table boundaries", () => {
    expect(qrVersionForBytes(17)).toBe(1);
    expect(qrVersionForBytes(18)).toBe(2);
    expect(qrVersionForBytes(32)).toBe(2);
    expect(qrVersionForBytes(53)).toBe(3);
    expect(qrVersionForBytes(54)).toBe(4);
  });

  it("returns null past the table", () => {
    expect(qrVersionForBytes(BYTE_CAPACITY_L[BYTE_CAPACITY_L.length - 1] + 1)).toBeNull();
  });

  it("agrees with the real encoder at every boundary", () => {
    // The capacity table is hand-entered from ISO/IEC 18004. If it ever
    // drifts, this is where it shows up -- not on 500 printed stickers.
    for (let i = 0; i < BYTE_CAPACITY_L.length; i++) {
      const capacity = BYTE_CAPACITY_L[i];
      const atCapacity = QRCode.create("a".repeat(capacity), {
        errorCorrectionLevel: "L",
      });
      expect(atCapacity.version).toBe(i + 1);
      expect(atCapacity.modules.size).toBe(qrModuleCount(i + 1));

      const overCapacity = QRCode.create("a".repeat(capacity + 1), {
        errorCorrectionLevel: "L",
      });
      expect(overCapacity.version).toBe(i + 2);
    }
  });
});

describe("inspectLabelUrlConfig", () => {
  it("reports the club's real configuration as within budget", () => {
    // The shipping configuration: bot `calibur_checkout_bot`, Mini App `app`,
    // 6-character codes. 47 fixed bytes + 6 = exactly the 53-byte version-3
    // budget. Telegram requires a Mini App short name of >= 3 characters, so
    // `app` cannot be shortened -- the code length is the lever that got this
    // under budget, and this test is what stops it drifting back.
    const result = inspectLabelUrlConfig(BOT, "app");
    expect(result.error).toBeNull();
    expect(result.byteLength).toBe(53);
    expect(result.withinBudget).toBe(true);
    expect(result.overBy).toBe(0);
    expect(result.qrVersion).toBe(3);
    expect(result.moduleCount).toBe(29);
  });

  it("reports an over-budget configuration without throwing", () => {
    // One character longer than the generator now emits: 54 bytes, one over,
    // which would silently push every sticker to version 4.
    const result = inspectLabelUrlConfig(BOT, "app", 7);
    expect(result.error).toBeNull();
    expect(result.byteLength).toBe(54);
    expect(result.withinBudget).toBe(false);
    expect(result.overBy).toBe(1);
    expect(result.qrVersion).toBe(4);
    expect(result.moduleCount).toBe(33);
  });

  it("reports a configuration error instead of throwing", () => {
    const result = inspectLabelUrlConfig("", "s");
    expect(result.error).toMatch(/NEXT_PUBLIC_TELEGRAM_BOT_USERNAME/);
    expect(result.withinBudget).toBe(false);
  });

  it("is independent of which code characters are drawn", () => {
    const sample = inspectLabelUrlConfig(BOT, "app");
    for (let i = 0; i < 100; i++) {
      const url = buildLabelUrl({ botUsername: BOT, appName: "app", code: generateScanCode() });
      expect(utf8ByteLength(url)).toBe(sample.byteLength);
    }
  });
});

describe("encodeQrSymbol", () => {
  it("encodes a within-budget link at version 3 / 29 modules", () => {
    const url = buildLabelUrl({ botUsername: BOT, appName: "app", code: generateScanCode() });
    const symbol = encodeQrSymbol(url);
    expect(symbol.version).toBe(3);
    expect(symbol.moduleCount).toBe(29);
    expect(symbol.extent).toBe(29 + 8);
    expect(symbol.viewBox).toBe("0 0 37 37");
    expect(symbol.path.length).toBeGreaterThan(0);
  });

  it("emits one subpath per dark module and none outside the symbol", () => {
    const symbol = encodeQrSymbol("https://t.me/a/s?startapp=abc");
    const subpaths = symbol.path.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    expect(subpaths.length).toBeGreaterThan(0);
    for (const subpath of subpaths) {
      const [, x, y] = subpath.match(/M(\d+) (\d+)/)!;
      // Every module sits inside the quiet zone, not on or past it.
      expect(Number(x)).toBeGreaterThanOrEqual(4);
      expect(Number(y)).toBeGreaterThanOrEqual(4);
      expect(Number(x)).toBeLessThan(symbol.extent - 4);
      expect(Number(y)).toBeLessThan(symbol.extent - 4);
    }
  });
});

describe("symbolSizeMm", () => {
  it("discounts the quiet zone from the printed box", () => {
    // 25.8 mm box at version 3: 29 of 37 module-widths are the symbol.
    expect(symbolSizeMm(25.8, 29)).toBeCloseTo((25.8 * 29) / 37, 5);
    expect(symbolSizeMm(25.8, 29)).toBeGreaterThanOrEqual(MIN_QR_SYMBOL_MM);
  });

  it("would flag a box that looks big enough but is not", () => {
    // 20 mm box == 15.7 mm symbol. Comparing the box against the 20 mm
    // minimum is the mistake this function exists to prevent.
    expect(symbolSizeMm(20, 29)).toBeLessThan(MIN_QR_SYMBOL_MM);
  });
});
