import "../../scripts/_env";

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Integration test for the stocktake commit path. Runs against the LIVE dev
// Supabase project (no mocking) using fixture rows from
// scripts/seed-fixtures.ts, calling `admin_commit_stocktake` exactly as the
// /admin/stocktake page does -- except for the auth leg: the page calls it
// with a signed-in admin's anon session (is_admin() via RLS), while this
// calls it with the service-role key, which the function's guard admits via
// `current_user = 'service_role'` and which then honours p_actor_member_id.
//
// Cleanup: capture max(stock_movements.id) in beforeAll, delete everything
// above that watermark in afterAll (plus this run's stock_counts and
// sessions, which are keyed by session id, not by the watermark), and assert
// nothing remains.
// ---------------------------------------------------------------------------

const db = getServiceRoleClient();
const ADMIN_EMAIL = "admin@example.com";

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

/**
 * Movements written by ONE commit. Deliberately scoped to the session rather
 * than a global `count(*)` delta: the dev project is shared, so a global
 * count is a race against anything else touching the ledger, while "what did
 * this session write" is exactly the claim each test is making.
 */
async function movementsForSession(sessionId: string) {
  const { data, error } = await db
    .from("stock_movements")
    .select("*")
    .eq("session_id", sessionId);
  if (error) throw error;
  return data ?? [];
}

/** A rolled-back commit leaves no session behind, not even an empty one. */
async function sessionExistsForToken(clientToken: string): Promise<boolean> {
  const { count, error } = await db
    .from("sessions")
    .select("*", { count: "exact", head: true })
    .eq("client_token", clientToken);
  if (error) throw error;
  return (count ?? 0) > 0;
}

/** The same sum the RPC recomputes server-side: in minus out, for one pair. */
async function heldQty(productId: string, holderId: string): Promise<number> {
  const { data: into, error: intoErr } = await db
    .from("stock_movements")
    .select("qty")
    .eq("to_holder_id", holderId)
    .eq("product_id", productId);
  if (intoErr) throw intoErr;

  const { data: outOf, error: outErr } = await db
    .from("stock_movements")
    .select("qty")
    .eq("from_holder_id", holderId)
    .eq("product_id", productId);
  if (outErr) throw outErr;

  return (
    (into ?? []).reduce((sum, r) => sum + r.qty, 0) -
    (outOf ?? []).reduce((sum, r) => sum + r.qty, 0)
  );
}

async function productIdByName(name: string): Promise<string> {
  const { data, error } = await db
    .from("products")
    .select("id")
    .eq("name", name)
    .eq("active", true)
    .single();
  if (error) throw error;
  return data.id;
}

async function holderIdByKind(kind: string): Promise<string> {
  const { data, error } = await db
    .from("holders")
    .select("id")
    .eq("kind", kind)
    .eq("active", true)
    .single();
  if (error) throw error;
  return data.id;
}

describe("admin_commit_stocktake (integration, live DB)", () => {
  const sessionIds = new Set<string>();
  let adminMemberId: string;
  let storeHolderId: string;
  let adjustmentHolderId: string;
  let locationId: string | null = null;
  let gainProductId: string;
  let lossProductId: string;
  let matchProductId: string;
  let baselineMaxId: number;

  async function commit(
    counts: { productId: string; countedQty: number }[],
    clientToken: string,
    withLocation = false,
  ): Promise<string> {
    const { data, error } = await db.rpc("admin_commit_stocktake", {
      p_counts: counts,
      p_client_token: clientToken,
      p_actor_member_id: adminMemberId,
      p_note: "integration test walk",
      ...(withLocation && locationId ? { p_location_id: locationId } : {}),
    });
    if (error) throw error;
    const sessionId = data as string;
    sessionIds.add(sessionId);
    return sessionId;
  }

  beforeAll(async () => {
    const { data: admin, error: adminErr } = await db
      .from("members")
      .select("id")
      .eq("nus_email", ADMIN_EMAIL)
      .single();
    if (adminErr) throw adminErr;
    adminMemberId = admin.id;

    storeHolderId = await holderIdByKind("store");
    adjustmentHolderId = await holderIdByKind("adjustment");

    const { data: location } = await db
      .from("locations")
      .select("id")
      .limit(1)
      .maybeSingle();
    locationId = location?.id ?? null;

    // Three distinct fixture products so each scenario's holdings stay
    // independent of the others.
    gainProductId = await productIdByName("M2006");
    lossProductId = await productIdByName("Damiao 4310");
    matchProductId = await productIdByName("C620 ESC");

    baselineMaxId = await maxStockMovementId();
  });

  afterAll(async () => {
    const ids = [...sessionIds];
    if (ids.length > 0) {
      // stock_counts first: its rows reference the movements below.
      const { error: countsErr } = await db
        .from("stock_counts")
        .delete()
        .in("session_id", ids);
      if (countsErr) throw countsErr;
    }

    const { error: movementsErr } = await db
      .from("stock_movements")
      .delete()
      .gt("id", baselineMaxId);
    if (movementsErr) throw movementsErr;

    if (ids.length > 0) {
      const { error: sessionsErr } = await db
        .from("sessions")
        .delete()
        .in("id", ids);
      if (sessionsErr) throw sessionsErr;

      const { count: leftoverCounts, error: leftoverErr } = await db
        .from("stock_counts")
        .select("*", { count: "exact", head: true })
        .in("session_id", ids);
      if (leftoverErr) throw leftoverErr;
      expect(leftoverCounts ?? 0).toBe(0);
    }

    expect(await maxStockMovementId()).toBeLessThanOrEqual(baselineMaxId);
  });

  it("positive variance -> one stocktake_gain movement from the adjustment holder", async () => {
    const expected = await heldQty(gainProductId, storeHolderId);
    const counted = expected + 5;

    const sessionId = await commit(
      [{ productId: gainProductId, countedQty: counted }],
      randomUUID(),
      true,
    );

    const { data: session, error: sessionErr } = await db
      .from("sessions")
      .select("mode, source, location_id, member_id")
      .eq("id", sessionId)
      .single();
    if (sessionErr) throw sessionErr;
    expect(session.mode).toBe("stocktake");
    expect(session.source).toBe("admin");
    expect(session.member_id).toBe(adminMemberId);
    if (locationId) expect(session.location_id).toBe(locationId);

    const movements = await movementsForSession(sessionId);
    expect(movements).toHaveLength(1);
    expect(movements[0].reason).toBe("stocktake_gain");
    expect(movements[0].from_holder_id).toBe(adjustmentHolderId);
    expect(movements[0].to_holder_id).toBe(storeHolderId);
    expect(movements[0].qty).toBe(5);

    const { data: counts, error: countsErr } = await db
      .from("stock_counts")
      .select("*")
      .eq("session_id", sessionId);
    if (countsErr) throw countsErr;
    expect(counts).toHaveLength(1);
    // `expected` is recomputed server-side, not taken from the client.
    expect(counts![0].expected_qty).toBe(expected);
    expect(counts![0].counted_qty).toBe(counted);
    expect(counts![0].holder_id).toBe(storeHolderId);
    expect(counts![0].movement_id).toBe(movements[0].id);
    expect(counts![0].counted_by).toBe(adminMemberId);

    // The ledger now agrees with what was counted.
    expect(await heldQty(gainProductId, storeHolderId)).toBe(counted);
  });

  it("negative variance -> one stocktake_loss movement to the adjustment holder", async () => {
    const expected = await heldQty(lossProductId, storeHolderId);
    expect(expected).toBeGreaterThanOrEqual(2); // fixture seeds a positive qty
    const counted = expected - 2;

    const sessionId = await commit(
      [{ productId: lossProductId, countedQty: counted }],
      randomUUID(),
    );

    const movements = await movementsForSession(sessionId);
    expect(movements).toHaveLength(1);
    expect(movements[0].reason).toBe("stocktake_loss");
    expect(movements[0].from_holder_id).toBe(storeHolderId);
    expect(movements[0].to_holder_id).toBe(adjustmentHolderId);
    expect(movements[0].qty).toBe(2);

    const { data: counts, error: countsErr } = await db
      .from("stock_counts")
      .select("*")
      .eq("session_id", sessionId);
    if (countsErr) throw countsErr;
    expect(counts![0].expected_qty).toBe(expected);
    expect(counts![0].movement_id).toBe(movements[0].id);

    expect(await heldQty(lossProductId, storeHolderId)).toBe(counted);
  });

  it("ZERO VARIANCE WRITES NO MOVEMENT — only a stock_counts row with movement_id null", async () => {
    const expected = await heldQty(matchProductId, storeHolderId);

    const sessionId = await commit(
      [{ productId: matchProductId, countedQty: expected }],
      randomUUID(),
    );

    // The whole point: qty > 0 and no_self_move both forbid a zero-quantity
    // self-transfer, so a matched count must write nothing to the ledger.
    expect(await movementsForSession(sessionId)).toHaveLength(0);

    const { data: counts, error: countsErr } = await db
      .from("stock_counts")
      .select("*")
      .eq("session_id", sessionId);
    if (countsErr) throw countsErr;
    expect(counts).toHaveLength(1);
    expect(counts![0].movement_id).toBeNull();
    expect(counts![0].counted_qty).toBe(expected);
    expect(counts![0].expected_qty).toBe(expected);

    expect(await heldQty(matchProductId, storeHolderId)).toBe(expected);
  });

  it("a mixed walk writes a movement only for the products that drifted", async () => {
    const gainExpected = await heldQty(gainProductId, storeHolderId);
    const matchExpected = await heldQty(matchProductId, storeHolderId);

    const sessionId = await commit(
      [
        { productId: gainProductId, countedQty: gainExpected + 1 },
        { productId: matchProductId, countedQty: matchExpected },
      ],
      randomUUID(),
    );

    expect(await movementsForSession(sessionId)).toHaveLength(1);

    const { data: counts, error: countsErr } = await db
      .from("stock_counts")
      .select("product_id, movement_id")
      .eq("session_id", sessionId);
    if (countsErr) throw countsErr;
    expect(counts).toHaveLength(2);
    expect(
      counts!.find((c) => c.product_id === gainProductId)!.movement_id,
    ).not.toBeNull();
    expect(
      counts!.find((c) => c.product_id === matchProductId)!.movement_id,
    ).toBeNull();
  });

  it("replaying the same client token returns the original session and writes nothing new", async () => {
    const token = randomUUID();
    const expected = await heldQty(gainProductId, storeHolderId);

    const firstSessionId = await commit(
      [{ productId: gainProductId, countedQty: expected + 3 }],
      token,
    );
    const movementsAfterFirst = await movementsForSession(firstSessionId);
    const ledgerAfterFirst = await heldQty(gainProductId, storeHolderId);

    // Same token, deliberately different numbers: a retry of an interrupted
    // commit must be a no-op, not a second correction.
    const replaySessionId = await commit(
      [{ productId: gainProductId, countedQty: expected + 999 }],
      token,
    );

    expect(replaySessionId).toBe(firstSessionId);
    expect(await movementsForSession(firstSessionId)).toHaveLength(
      movementsAfterFirst.length,
    );
    expect(await heldQty(gainProductId, storeHolderId)).toBe(ledgerAfterFirst);

    const { data: counts, error: countsErr } = await db
      .from("stock_counts")
      .select("counted_qty")
      .eq("session_id", firstSessionId);
    if (countsErr) throw countsErr;
    expect(counts).toHaveLength(1);
    expect(counts![0].counted_qty).toBe(expected + 3);
  });

  it("rejects a negative counted quantity, writing nothing", async () => {
    const expected = await heldQty(gainProductId, storeHolderId);
    const token = randomUUID();

    const { error } = await db.rpc("admin_commit_stocktake", {
      p_counts: [{ productId: gainProductId, countedQty: -1 }],
      p_client_token: token,
      p_actor_member_id: adminMemberId,
    });

    expect(error).not.toBeNull();
    expect(await heldQty(gainProductId, storeHolderId)).toBe(expected);
    expect(await sessionExistsForToken(token)).toBe(false);
  });

  it("is atomic: an unknown product in the payload rolls the whole walk back", async () => {
    const expected = await heldQty(gainProductId, storeHolderId);
    const token = randomUUID();

    const { error } = await db.rpc("admin_commit_stocktake", {
      p_counts: [
        { productId: gainProductId, countedQty: expected + 4 },
        { productId: randomUUID(), countedQty: 1 },
      ],
      p_client_token: token,
      p_actor_member_id: adminMemberId,
    });

    expect(error).not.toBeNull();
    // The first line's correction must not survive the second line's failure.
    expect(await heldQty(gainProductId, storeHolderId)).toBe(expected);
    expect(await sessionExistsForToken(token)).toBe(false);
  });
});
