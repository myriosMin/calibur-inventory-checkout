import "../../scripts/_env";
import "./_schema-guard";

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Integration test for the two admin write RPCs behind /admin/restock and
// /admin/movements: `admin_restock` and `admin_reverse_movement`. Runs
// against the LIVE dev Supabase project -- there is no mocked/local DB.
//
// The browser calls these as `authenticated`, where the actor is derived from
// auth.email(); here we call them as `service_role`, which is the one branch
// of admin_actor_member_id() that honours p_actor_member_id. That is
// deliberate in the function (see 0022's comment) and is the only way to
// exercise the RPCs without a real Supabase Auth session.
//
// Cleanup (shared-brief watermark contract): capture max(stock_movements.id)
// in beforeAll, delete every row above it in afterAll, delete the sessions we
// minted client tokens for, and assert nothing above the watermark remains.
// ---------------------------------------------------------------------------

const db = getServiceRoleClient();

/** Every client_token this suite mints, so afterAll deletes exactly its own
 *  sessions rather than every admin session on the project. */
const mintedTokens: string[] = [];

function token(): string {
  const value = randomUUID();
  mintedTokens.push(value);
  return value;
}

async function maxStockMovementId(): Promise<number> {
  const { data, error } = await db
    .from("stock_movements")
    .select("id")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.id ?? 0;
}

async function movementsAbove(watermark: number) {
  const { data, error } = await db
    .from("stock_movements")
    .select("*")
    .gt("id", watermark)
    .order("id", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

describe("admin_restock / admin_reverse_movement (integration, live DB)", () => {
  let adminMemberId: string;
  let storeHolderId: string;
  let adjustmentHolderId: string;
  let assetProductId: string;
  let bulkProductId: string;
  let baselineMaxId: number;

  beforeAll(async () => {
    const { data: admin, error: adminErr } = await db
      .from("members")
      .select("id")
      .eq("nus_email", "admin@example.com")
      .eq("role", "admin")
      .single();
    if (adminErr) throw adminErr;
    adminMemberId = admin.id;

    const { data: store, error: storeErr } = await db
      .from("holders")
      .select("id")
      .eq("kind", "store")
      .eq("active", true)
      .single();
    if (storeErr) throw storeErr;
    storeHolderId = store.id;

    const { data: adjustment, error: adjErr } = await db
      .from("holders")
      .select("id")
      .eq("kind", "adjustment")
      .eq("active", true)
      .single();
    if (adjErr) throw adjErr;
    adjustmentHolderId = adjustment.id;

    const { data: asset, error: assetErr } = await db
      .from("products")
      .select("id")
      .eq("name", "DJI GM6020 motor")
      .eq("active", true)
      .single();
    if (assetErr) throw assetErr;
    assetProductId = asset.id;

    const { data: bulk, error: bulkErr } = await db
      .from("products")
      .select("id")
      .eq("name", "XT30 right angle M")
      .eq("active", true)
      .single();
    if (bulkErr) throw bulkErr;
    bulkProductId = bulk.id;

    baselineMaxId = await maxStockMovementId();
  });

  afterAll(async () => {
    const { error: delMovementsErr } = await db
      .from("stock_movements")
      .delete()
      .gt("id", baselineMaxId);
    if (delMovementsErr) throw delMovementsErr;

    if (mintedTokens.length > 0) {
      const { error: delSessionsErr } = await db
        .from("sessions")
        .delete()
        .in("client_token", mintedTokens);
      if (delSessionsErr) throw delSessionsErr;
    }

    expect(await maxStockMovementId()).toBeLessThanOrEqual(baselineMaxId);
    expect(await movementsAbove(baselineMaxId)).toHaveLength(0);
  });

  it("writes one adjustment → store movement per line, in one session", async () => {
    const before = await maxStockMovementId();
    const { data: sessionId, error } = await db.rpc("admin_restock", {
      p_lines: [
        { productId: assetProductId, qty: 3 },
        { productId: bulkProductId, qty: 50 },
      ],
      p_note: "PO 4471, received from Cytron",
      p_client_token: token(),
      p_actor_member_id: adminMemberId,
    });

    expect(error).toBeNull();
    expect(typeof sessionId).toBe("string");

    const { data: session, error: sessionErr } = await db
      .from("sessions")
      .select("*")
      .eq("id", sessionId as string)
      .single();
    expect(sessionErr).toBeNull();
    expect(session!.mode).toBe("restock");
    expect(session!.source).toBe("admin");
    expect(session!.member_id).toBe(adminMemberId);
    expect(session!.dest_holder_id).toBe(storeHolderId);
    expect(session!.note).toBe("PO 4471, received from Cytron");
    expect(session!.committed_at).not.toBeNull();

    const written = await movementsAbove(before);
    expect(written).toHaveLength(2);
    for (const movement of written) {
      expect(movement.session_id).toBe(sessionId);
      expect(movement.from_holder_id).toBe(adjustmentHolderId);
      expect(movement.to_holder_id).toBe(storeHolderId);
      expect(movement.reason).toBe("restock");
      expect(movement.entry_method).toBe("admin");
      expect(movement.actor_member_id).toBe(adminMemberId);
      expect(movement.reverses_movement_id).toBeNull();
    }
    expect(
      written.map((m) => [m.product_id, m.qty]).sort(),
    ).toEqual([[assetProductId, 3], [bulkProductId, 50]].sort());
  });

  it("returns the original session and writes nothing when a client token is replayed", async () => {
    const replayToken = token();

    const { data: firstSession, error: firstErr } = await db.rpc("admin_restock", {
      p_lines: [{ productId: assetProductId, qty: 7 }],
      p_client_token: replayToken,
      p_actor_member_id: adminMemberId,
    });
    expect(firstErr).toBeNull();

    const afterFirst = await maxStockMovementId();

    // Same token, deliberately *different* lines: an idempotency key that
    // only worked when the payload matched would not protect the real failure
    // mode (a retried submit after an ambiguous network error).
    const { data: replaySession, error: replayErr } = await db.rpc("admin_restock", {
      p_lines: [
        { productId: assetProductId, qty: 999 },
        { productId: bulkProductId, qty: 999 },
      ],
      p_client_token: replayToken,
      p_actor_member_id: adminMemberId,
    });

    expect(replayErr).toBeNull();
    expect(replaySession).toBe(firstSession);
    expect(await maxStockMovementId()).toBe(afterFirst);
  });

  it("rejects an empty line list and an unknown product without writing a session", async () => {
    const emptyToken = token();
    const { error: emptyErr } = await db.rpc("admin_restock", {
      p_lines: [],
      p_client_token: emptyToken,
      p_actor_member_id: adminMemberId,
    });
    expect(emptyErr?.message).toMatch(/non-empty JSON array/i);

    const unknownToken = token();
    const before = await maxStockMovementId();
    const { error: unknownErr } = await db.rpc("admin_restock", {
      p_lines: [{ productId: randomUUID(), qty: 1 }],
      p_client_token: unknownToken,
      p_actor_member_id: adminMemberId,
    });
    expect(unknownErr?.message).toMatch(/unknown or inactive product/i);
    // The whole RPC is one transaction, so the session insert rolled back too.
    expect(await maxStockMovementId()).toBe(before);

    const { data: orphans, error: orphanErr } = await db
      .from("sessions")
      .select("id")
      .in("client_token", [emptyToken, unknownToken]);
    expect(orphanErr).toBeNull();
    expect(orphans).toHaveLength(0);
  });

  it("mirrors a movement into a correction row and refuses to do it twice", async () => {
    const { data: sessionId, error: restockErr } = await db.rpc("admin_restock", {
      p_lines: [{ productId: assetProductId, qty: 4 }],
      p_client_token: token(),
      p_actor_member_id: adminMemberId,
    });
    expect(restockErr).toBeNull();

    const { data: original, error: originalErr } = await db
      .from("stock_movements")
      .select("*")
      .eq("session_id", sessionId as string)
      .single();
    expect(originalErr).toBeNull();

    const { data: correctionId, error: reverseErr } = await db.rpc(
      "admin_reverse_movement",
      {
        p_movement_id: original!.id,
        p_note: "counted the pallet twice",
        p_client_token: token(),
        p_actor_member_id: adminMemberId,
      },
    );
    expect(reverseErr).toBeNull();
    expect(typeof correctionId).toBe("number");

    const { data: mirror, error: mirrorErr } = await db
      .from("stock_movements")
      .select("*")
      .eq("id", correctionId as number)
      .single();
    expect(mirrorErr).toBeNull();
    expect(mirror!.product_id).toBe(original!.product_id);
    expect(mirror!.qty).toBe(original!.qty);
    expect(mirror!.from_holder_id).toBe(original!.to_holder_id);
    expect(mirror!.to_holder_id).toBe(original!.from_holder_id);
    expect(mirror!.reason).toBe("correction");
    expect(mirror!.entry_method).toBe("admin");
    expect(mirror!.reverses_movement_id).toBe(original!.id);

    // The original is untouched -- the ledger is append-only.
    const { data: stillThere } = await db
      .from("stock_movements")
      .select("*")
      .eq("id", original!.id)
      .single();
    expect(stillThere).toEqual(original);

    // Net effect on the store for this product is zero.
    const { data: correctionSession } = await db
      .from("sessions")
      .select("mode, source, note, member_id")
      .eq("id", mirror!.session_id as string)
      .single();
    expect(correctionSession!.mode).toBe("correction");
    expect(correctionSession!.source).toBe("admin");
    expect(correctionSession!.note).toBe("counted the pallet twice");
    expect(correctionSession!.member_id).toBe(adminMemberId);

    // Second reversal of the same movement: refused (advisory check first,
    // and the partial unique index from 0021 behind it).
    const before = await maxStockMovementId();
    const { error: doubleErr } = await db.rpc("admin_reverse_movement", {
      p_movement_id: original!.id,
      p_note: "oops, again",
      p_client_token: token(),
      p_actor_member_id: adminMemberId,
    });
    expect(doubleErr?.message).toMatch(/already been reversed/i);
    expect(await maxStockMovementId()).toBe(before);

    // Reversing the correction itself: also refused.
    const { error: correctionErr } = await db.rpc("admin_reverse_movement", {
      p_movement_id: correctionId as number,
      p_note: "undo the undo",
      p_client_token: token(),
      p_actor_member_id: adminMemberId,
    });
    expect(correctionErr?.message).toMatch(/itself a correction/i);
    expect(await maxStockMovementId()).toBe(before);
  });

  it("rejects reversing a movement that does not exist", async () => {
    const { error } = await db.rpc("admin_reverse_movement", {
      p_movement_id: 2147483000,
      p_note: "nothing to see",
      p_client_token: token(),
      p_actor_member_id: adminMemberId,
    });
    expect(error?.message).toMatch(/unknown movement/i);
  });
});
