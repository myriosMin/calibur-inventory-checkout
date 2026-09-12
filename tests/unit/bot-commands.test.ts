import { describe, expect, it } from "vitest";

import {
  buildFallbackText,
  buildHelpText,
  buildMyItemsText,
  buildUnknownMemberText,
  parseCommand,
} from "@/lib/telegram/commands";
import type { MemberHolderHoldings } from "@/lib/server/member-activity";

function holder(name: string, items: Array<[string, number, string]>): MemberHolderHoldings {
  return {
    holderId: `holder-${name}`,
    holderName: name,
    holderKind: "robot",
    items: items.map(([itemName, qty, unit]) => ({
      productId: `p-${itemName}`,
      name: itemName,
      tier: "asset",
      unit,
      qty,
    })),
  };
}

describe("parseCommand", () => {
  it("parses the three known commands", () => {
    expect(parseCommand("/start")).toEqual({ command: "/start", args: "" });
    expect(parseCommand("/myitems")).toEqual({ command: "/myitems", args: "" });
    expect(parseCommand("/help")).toEqual({ command: "/help", args: "" });
  });

  it("returns the start payload as args, verbatim and case-sensitive", () => {
    expect(parseCommand("/start ABC123")).toEqual({ command: "/start", args: "ABC123" });
    expect(parseCommand("  /start   AbC-123  ")).toEqual({ command: "/start", args: "AbC-123" });
  });

  it("is case-insensitive on the command word itself", () => {
    expect(parseCommand("/START")?.command).toBe("/start");
    expect(parseCommand("/MyItems")?.command).toBe("/myitems");
  });

  it("strips the @botname suffix Telegram clients add in groups", () => {
    expect(parseCommand("/myitems@calibur_parts_bot")).toEqual({
      command: "/myitems",
      args: "",
    });
    expect(parseCommand("/start@calibur_parts_bot CODE9")).toEqual({
      command: "/start",
      args: "CODE9",
    });
  });

  it("does NOT treat /starting as /start (the old startsWith bug)", () => {
    expect(parseCommand("/starting")).toBeNull();
    expect(parseCommand("/startle")).toBeNull();
    expect(parseCommand("/starts now")).toBeNull();
  });

  it("returns null for plain text and unknown commands", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand("")).toBeNull();
    expect(parseCommand("   ")).toBeNull();
    expect(parseCommand("/nope")).toBeNull();
    expect(parseCommand("where is my motor")).toBeNull();
    // A slash mid-sentence is not a command.
    expect(parseCommand("ask /help please")).toBeNull();
  });
});

describe("buildMyItemsText", () => {
  it("says so plainly when nothing is out", () => {
    expect(buildMyItemsText([])).toBe("You have nothing out right now.");
    // A holder with no items is the same thing as no holders.
    expect(buildMyItemsText([holder("Hero", [])])).toBe("You have nothing out right now.");
  });

  it("groups items under their holder, with a leading total", () => {
    const text = buildMyItemsText([
      holder("Hero", [
        ["GM6020", 2, "pcs"],
        ["Center board", 1, "pcs"],
      ]),
      holder("Personal / bench", [["Livox LiDAR", 1, "pcs"]]),
    ]);

    expect(text).toBe(
      [
        "You have 3 items out.",
        "",
        "Hero",
        "- GM6020 x2 pcs",
        "- Center board x1 pcs",
        "",
        "Personal / bench",
        "- Livox LiDAR x1 pcs",
      ].join("\n"),
    );
  });

  it("singularises a single item", () => {
    const text = buildMyItemsText([holder("Hero", [["GM6020", 1, "pcs"]])]);
    expect(text.startsWith("You have 1 item out.")).toBe(true);
  });

  it("does not leave a trailing space when a product has no unit", () => {
    const text = buildMyItemsText([holder("Hero", [["Mystery part", 1, ""]])]);
    expect(text).toContain("- Mystery part x1");
    expect(text.split("\n").every((line) => line === line.trimEnd())).toBe(true);
  });
});

describe("help and fallback text", () => {
  it("lists every command the dispatcher actually handles", () => {
    for (const text of [buildHelpText(), buildFallbackText()]) {
      expect(text).toContain("/myitems");
      expect(text).toContain("/help");
      expect(text).toContain("/start");
    }
  });

  it("opens the fallback by admitting it didn't understand", () => {
    expect(buildFallbackText().startsWith("I didn't understand that.")).toBe(true);
    expect(buildHelpText().startsWith("I didn't understand that.")).toBe(false);
  });

  it("is plain text: no emoji and no Markdown/HTML markup", () => {
    const texts = [
      buildHelpText(),
      buildFallbackText(),
      buildUnknownMemberText(),
      buildMyItemsText([holder("Hero", [["GM6020", 2, "pcs"]])]),
    ];
    for (const text of texts) {
      // No emoji/pictographs -- the app's no-emoji rule applies to bot
      // messages too (src/lib/telegram/receipt.ts).
      expect(/\p{Extended_Pictographic}/u.test(text)).toBe(false);
      // No parse_mode is sent, so markup would show up literally.
      expect(text).not.toMatch(/[*_`<>]/);
    }
  });
});
