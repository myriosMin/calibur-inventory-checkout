import { describe, expect, it } from "vitest";

import {
  buildFallbackText,
  buildHelpText,
  buildMyItemsText,
  buildJoinPromptText,
  buildUnknownMemberText,
  parseCommand,
  routeMessage,
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
    expect(parseCommand("/start")).toEqual({ command: "/start", args: "", mention: null });
    expect(parseCommand("/myitems")).toEqual({ command: "/myitems", args: "", mention: null });
    expect(parseCommand("/help")).toEqual({ command: "/help", args: "", mention: null });
  });

  it("returns the start payload as args, verbatim and case-sensitive", () => {
    expect(parseCommand("/start ABC123")).toEqual({
      command: "/start",
      args: "ABC123",
      mention: null,
    });
    expect(parseCommand("  /start   AbC-123  ")).toEqual({
      command: "/start",
      args: "AbC-123",
      mention: null,
    });
  });

  it("is case-insensitive on the command word itself", () => {
    expect(parseCommand("/START")?.command).toBe("/start");
    expect(parseCommand("/MyItems")?.command).toBe("/myitems");
  });

  it("strips the @botname suffix Telegram clients add in groups", () => {
    expect(parseCommand("/myitems@calibur_parts_bot")).toEqual({
      command: "/myitems",
      args: "",
      mention: "calibur_parts_bot",
    });
    expect(parseCommand("/start@calibur_parts_bot CODE9")).toEqual({
      command: "/start",
      args: "CODE9",
      mention: "calibur_parts_bot",
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
      buildJoinPromptText(),
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

// ---------------------------------------------------------------------------
// Group chats. The alert-chat feature puts this bot IN the club group, which
// is what makes these rules load-bearing: before them, every `/whatever` any
// of ~120 members typed in that group got a public "I didn't understand
// that", and a `/start` ran identity binding and announced it to everyone.
// ---------------------------------------------------------------------------

const ME = "calibur_parts_bot";

describe("routeMessage in a private chat", () => {
  it("handles a known command, exactly as before", () => {
    expect(routeMessage("/start CODE9", "private", ME)).toEqual({
      action: "handle",
      command: "/start",
      args: "CODE9",
    });
  });

  it("still answers plain text and typos with the fallback (flows.md §8)", () => {
    expect(routeMessage("where is my motor", "private", ME)).toEqual({ action: "fallback" });
    expect(routeMessage("/starting", "private", ME)).toEqual({ action: "fallback" });
  });

  it("does not require the command to be addressed to anyone", () => {
    expect(routeMessage("/myitems", "private", ME)).toMatchObject({ action: "handle" });
    expect(routeMessage("/myitems@" + ME, "private", ME)).toMatchObject({ action: "handle" });
  });

  it("treats an update with no chat type as a DM rather than losing the reply", () => {
    expect(routeMessage("/help", undefined, ME)).toMatchObject({ action: "handle" });
    expect(routeMessage("hello", undefined, ME)).toEqual({ action: "fallback" });
  });
});

describe("routeMessage in a group chat", () => {
  it("never emits the unrecognised-message fallback", () => {
    for (const chatType of ["group", "supergroup", "channel"]) {
      expect(routeMessage("lunch at 12?", chatType, ME)).toEqual({ action: "ignore" });
      expect(routeMessage("/randomcommand", chatType, ME)).toEqual({ action: "ignore" });
    }
  });

  it("stays silent on an unaddressed command -- including /start", () => {
    expect(routeMessage("/start", "supergroup", ME)).toEqual({ action: "ignore" });
    expect(routeMessage("/myitems", "group", ME)).toEqual({ action: "ignore" });
  });

  it("ignores a command addressed to a different bot in the same group", () => {
    expect(routeMessage("/start@some_other_bot", "supergroup", ME)).toEqual({ action: "ignore" });
  });

  it("answers only a command explicitly addressed to this bot", () => {
    expect(routeMessage("/myitems@calibur_parts_bot", "supergroup", ME)).toEqual({
      action: "handle",
      command: "/myitems",
      args: "",
    });
  });

  it("matches the bot username case-insensitively and with or without the @", () => {
    expect(routeMessage("/help@Calibur_Parts_Bot", "group", "@Calibur_Parts_Bot")).toMatchObject({
      action: "handle",
      command: "/help",
    });
  });

  it("falls back to silence when the bot username is not configured", () => {
    // Nothing can be "addressed to us" if we do not know our own name, and
    // guessing would mean answering another bot's commands in public.
    expect(routeMessage("/help@calibur_parts_bot", "group", "")).toEqual({ action: "ignore" });
    expect(routeMessage("/help@calibur_parts_bot", "group", undefined)).toEqual({
      action: "ignore",
    });
  });
});
