import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/server/member-auth";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { sendMessageSafely } from "@/lib/telegram/bot-api";
import { buildReceiptText } from "@/lib/telegram/receipt";

export const runtime = "nodejs";

const lineSchema = z.object({
  productId: z.string().min(1),
  qty: z.number().int().positive(),
  scanCode: z.string().min(1).optional(),
  entryMethod: z.enum(["scan", "group_pick", "search"]),
});

const bodySchema = z
  .object({
    mode: z.enum(["borrow", "return"]),
    destHolderId: z.string().min(1).optional(),
    sourceHolderId: z.string().min(1).optional(),
    lines: z.array(lineSchema).nonempty(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.mode === "borrow" && !data.destHolderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["destHolderId"],
        message: "destHolderId is required when mode is 'borrow'",
      });
    }
    if (data.mode === "return" && !data.sourceHolderId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceHolderId"],
        message: "sourceHolderId is required when mode is 'return'",
      });
    }
  });

export async function POST(request: Request) {
  // Validation happens before any auth/DB call: a malformed body must never
  // reach requireMember or the RPC, so a 400 always means zero DB writes.
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "malformed_body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  const auth = await requireMember(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { mode, destHolderId, sourceHolderId, lines } = parsed.data;
  const supabase = getServiceRoleClient();

  // The generated Args type for submit_cart declares p_dest_holder_id /
  // p_source_holder_id as non-nullable `string`, but the underlying SQL
  // function's parameters are plain `uuid` (nullable) -- exactly one of
  // these is null depending on `mode`, which the function relies on.
  const { data, error } = await supabase.rpc("submit_cart", {
    p_member_id: auth.member.id,
    p_mode: mode,
    p_dest_holder_id: (destHolderId ?? null) as unknown as string,
    p_source_holder_id: (sourceHolderId ?? null) as unknown as string,
    p_source: "miniapp",
    p_lines: lines,
  });

  if (error) {
    // Generic retryable error only -- the raw Postgres error is never
    // exposed to the client (docs/tele-qr/architecture.md's single-
    // transaction contract: the client must not clear its cart on a 500).
    console.error("submit_cart RPC failed:", error);
    return NextResponse.json({ error: "submit_failed" }, { status: 500 });
  }

  // Best-effort text receipt over Telegram: the cart is already committed
  // above, so a failure here (a lookup query, or sendMessage itself, which
  // already swallows its own errors) must never turn a successful submit
  // into a 500 for the member -- there is deliberately no retry/outbox for
  // this, it's a nice-to-have summary, not part of the write.
  try {
    const holderId = (mode === "borrow" ? destHolderId : sourceHolderId)!;
    const productIds = [...new Set(lines.map((line) => line.productId))];

    const [{ data: products }, { data: holder }] = await Promise.all([
      supabase.from("products").select("id, name, unit").in("id", productIds),
      supabase.from("holders").select("name").eq("id", holderId).single(),
    ]);

    const productById = new Map((products ?? []).map((product) => [product.id, product]));
    const receiptLines = lines.map((line) => {
      const product = productById.get(line.productId);
      return { name: product?.name ?? "Unknown item", qty: line.qty, unit: product?.unit ?? "" };
    });

    const text = buildReceiptText({ mode, holderName: holder?.name ?? "—", lines: receiptLines });
    await sendMessageSafely(auth.telegramUserId, text);
  } catch (err) {
    console.error("Failed to send cart receipt:", err);
  }

  return NextResponse.json({ sessionId: data, movementCount: lines.length });
}
