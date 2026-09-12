import { NextResponse } from "next/server";
import { z } from "zod";

import { isReplayCommit } from "@/lib/server/cart-replay";
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
  /** `loose` tier only: "Took the last of it" rather than "Took some"
   * (docs/tele-qr/flows.md §4). Recorded after the commit as a
   * level-is-now-empty count -- see recordEmptyLevels below. */
  tookLast: z.boolean().optional(),
});

const bodySchema = z
  .object({
    mode: z.enum(["borrow", "return"]),
    destHolderId: z.string().min(1).optional(),
    sourceHolderId: z.string().min(1).optional(),
    /** The cart's idempotency key, minted once per cart by the client
     * (src/app/store/components/cartReducer.ts) and re-sent unchanged on
     * every retry. `.strict()` rejects UNKNOWN keys, not absent optional
     * ones, so a caller that omits this -- including every existing
     * integration test -- still gets byte-identical 0010 behaviour: a NULL
     * token never conflicts on the NULLS-DISTINCT unique index. */
    clientToken: z.string().uuid().optional(),
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

/**
 * Record "took the last of it" for every `loose` line flagged by the client
 * (docs/tele-qr/flows.md §4: "loose items never get an exact count -- 'took
 * the last of it' sets the level to empty and raises a restock flag").
 *
 * Shape, and why this shape: a `loose` item's quantity is meaningless by
 * definition, so the signal cannot live in `stock_movements.qty` (which is
 * `check (qty > 0)` and already carries the 1 the member took). What it is,
 * exactly, is a count: "as of now, the store holds none of this." That is
 * what `stock_counts` records -- product, holder, counted_qty, expected_qty,
 * who, and which session -- so the flag is a first-class row a low-stock
 * cron or an admin can query (`counted_qty = 0`), not a parsed note.
 *
 * What it deliberately does NOT do is write the variance movement that would
 * actually zero the store's ledger balance. That movement belongs inside
 * submit_cart's transaction, not in a second round-trip after the commit,
 * and getting it there needs an RPC signature change -- see the report. The
 * row written here is the flag; the correction remains an admin action.
 *
 * Best-effort and after the commit, exactly like the receipt below: the cart
 * is already written, so nothing here may turn a successful submit into a
 * 500. On an idempotent replay the same session id comes back and the
 * (session_id, product_id) unique index turns the re-insert into a no-op
 * 23505, which is the correct outcome.
 */
async function recordEmptyLevels(
  supabase: ReturnType<typeof getServiceRoleClient>,
  sessionId: string,
  memberId: string,
  productIds: string[],
) {
  const { data: looseProducts, error: productsError } = await supabase
    .from("products")
    .select("id")
    .in("id", productIds)
    // Trust the tier from the DB, never the client: `tookLast` on an asset
    // or bulk line is a client bug (or a forged body) and must not produce a
    // count row.
    .eq("tier", "loose")
    .eq("active", true);
  if (productsError) throw productsError;
  if (!looseProducts || looseProducts.length === 0) return;

  const { data: storeHolder, error: storeError } = await supabase
    .from("holders")
    .select("id")
    .eq("kind", "store")
    .eq("active", true)
    .single();
  if (storeError) throw storeError;

  const looseIds = looseProducts.map((product) => product.id);
  const { data: storeHoldings, error: holdingsError } = await supabase
    .from("holdings")
    .select("product_id, qty")
    .eq("holder_id", storeHolder.id)
    .in("product_id", looseIds);
  if (holdingsError) throw holdingsError;

  // Post-commit balance: what the ledger still thinks is on the shelf after
  // this cart was written. That is the number the member just contradicted,
  // so it is the right `expected_qty` for the variance an admin will see.
  const expectedByProductId = new Map(
    (storeHoldings ?? []).map((row) => [row.product_id, Math.round(row.qty ?? 0)]),
  );

  const { error: insertError } = await supabase.from("stock_counts").insert(
    looseIds.map((productId) => ({
      product_id: productId,
      holder_id: storeHolder.id,
      counted_qty: 0,
      expected_qty: expectedByProductId.get(productId) ?? 0,
      counted_by: memberId,
      session_id: sessionId,
      note: "Reported empty from the Mini App (took the last of it)",
    })),
  );
  // 23505 = the replay case above; anything else is worth a log line.
  if (insertError && insertError.code !== "23505") throw insertError;
}

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

  const { mode, destHolderId, sourceHolderId, clientToken, lines } = parsed.data;
  const supabase = getServiceRoleClient();

  // Captured before the RPC so it can be compared against the returned
  // session's `committed_at` afterwards -- see the replay check below.
  const requestStartedAt = new Date();

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
    // Omitted from the JSON body entirely when undefined, so submit_cart's
    // `default null` applies and dedup is simply off for that call.
    p_client_token: clientToken,
  });

  if (error) {
    // Generic retryable error only -- the raw Postgres error is never
    // exposed to the client (docs/tele-qr/architecture.md's single-
    // transaction contract: the client must not clear its cart on a 500).
    console.error("submit_cart RPC failed:", error);
    return NextResponse.json({ error: "submit_failed" }, { status: 500 });
  }

  // Was this a replay? `submit_cart` hands back the ORIGINAL session id when
  // the token has already been committed, and says nothing about it -- so a
  // retry-after-timeout would otherwise re-run both best-effort steps below
  // and send a second receipt for one cart. A session committed before this
  // request even started cannot have been written by it.
  //
  // Best-effort like everything else after the commit: a failed lookup is
  // logged and treated as a fresh write (a possibly-duplicate receipt beats a
  // silently swallowed real one), and can never fail the request.
  // Only meaningful when a token was sent: without one every submit is its
  // own session by construction, so the extra round trip would buy nothing.
  let isReplay = false;
  if (clientToken && typeof data === "string") {
    try {
      const { data: session, error: sessionError } = await supabase
        .from("sessions")
        .select("committed_at")
        .eq("id", data)
        .maybeSingle();
      if (sessionError) throw sessionError;
      isReplay = isReplayCommit(session?.committed_at, requestStartedAt);
    } catch (err) {
      console.error("Failed to check whether this submit was a replay:", err);
    }
  }

  // Restock flag for `loose` lines the member marked "took the last of it".
  // Same best-effort positioning as the receipt: after the commit, never
  // able to fail it.
  const emptiedProductIds = [
    ...new Set(lines.filter((line) => line.tookLast).map((line) => line.productId)),
  ];
  if (!isReplay && mode === "borrow" && emptiedProductIds.length > 0 && typeof data === "string") {
    try {
      await recordEmptyLevels(supabase, data, auth.member.id, emptiedProductIds);
    } catch (err) {
      console.error("Failed to record 'took the last of it' levels:", err);
    }
  }

  // Best-effort text receipt over Telegram: the cart is already committed
  // above, so a failure here (a lookup query, or sendMessage itself, which
  // already swallows its own errors) must never turn a successful submit
  // into a 500 for the member -- there is deliberately no retry/outbox for
  // this, it's a nice-to-have summary, not part of the write.
  //
  // Skipped entirely on a replay: one cart, one receipt. The member already
  // got this exact summary when the token first committed, and a second copy
  // reads as a second borrow they did not make.
  if (!isReplay) {
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
  }

  return NextResponse.json({ sessionId: data, movementCount: lines.length });
}
