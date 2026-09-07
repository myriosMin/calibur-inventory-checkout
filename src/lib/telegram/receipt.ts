export interface ReceiptLine {
  name: string;
  qty: number;
  unit: string;
}

export interface ReceiptParams {
  mode: "borrow" | "return";
  /** Destination holder name for a borrow, source holder name for a return. */
  holderName: string;
  lines: ReceiptLine[];
}

/**
 * Plain-text order summary DM'd to the member right after a successful cart
 * submit (src/app/api/store/cart/submit/route.ts). The app has no
 * order-history screen, so this is the only standing record a member gets
 * that a submit actually went through -- plain text, no emoji, per the
 * app's existing icon/palette convention (docs/tele-qr/checkpoint.md).
 */
export function buildReceiptText({ mode, holderName, lines }: ReceiptParams): string {
  const heading = mode === "borrow" ? `Borrowed -> ${holderName}` : `Returned from ${holderName}`;
  const body = lines.map((line) => `- ${line.name} x${line.qty} ${line.unit}`).join("\n");
  return `${heading}\n${body}`;
}
