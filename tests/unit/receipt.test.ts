import { describe, expect, it } from "vitest";
import { buildReceiptText } from "@/lib/telegram/receipt";

describe("buildReceiptText", () => {
  it("formats a borrow receipt with an arrow to the destination", () => {
    const text = buildReceiptText({
      mode: "borrow",
      holderName: "Hero",
      lines: [
        { name: "GM6020", qty: 1, unit: "unit" },
        { name: "XT30 right angle M", qty: 3, unit: "pcs" },
      ],
    });

    expect(text).toBe(
      "Borrowed -> Hero\n- GM6020 x1 unit\n- XT30 right angle M x3 pcs",
    );
  });

  it("formats a return receipt with 'from' the source", () => {
    const text = buildReceiptText({
      mode: "return",
      holderName: "Personal",
      lines: [{ name: "GM6020", qty: 2, unit: "unit" }],
    });

    expect(text).toBe("Returned from Personal\n- GM6020 x2 unit");
  });

  it("handles a single-line cart with no trailing newline", () => {
    const text = buildReceiptText({
      mode: "borrow",
      holderName: "Robot Alpha",
      lines: [{ name: "Resistor 10k", qty: 5, unit: "pcs" }],
    });

    expect(text.endsWith("pcs")).toBe(true);
    expect(text.split("\n")).toHaveLength(2);
  });
});
