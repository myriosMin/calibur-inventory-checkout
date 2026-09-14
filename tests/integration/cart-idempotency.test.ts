import "../../scripts/_env";
import "./_schema-guard";

import { execFileSync } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/store/cart/submit/route";

// ---------------------------------------------------------------------------
// The client half of the submit idempotency fix: migration 0019 gave
// submit_cart a p_client_token that dedups, but it stays dormant until a
// caller sends one. These tests drive the real route against the LIVE dev
// Supabase project with a token, which is what the Mini App now does (the
// cart mints one token per cart in cartReducer and re-sends it on retry).
//
// Also covers the `loose`-tier "took the last of it" flag, which is recorded
// as a stock_counts row against the store after the commit.
//
// Cleanup: watermark on max(stock_movements.id) in beforeAll; in afterAll
// delete the stock_counts rows first (they FK to both sessions and
// movements), then movements above the watermark, then this file's sessions.
// ---------------------------------------------------------------------------

const TEST_TELEGRAM_USER_ID = 900000000001;
const SUBMIT_URL = "http://localhost/api/store/cart/submit";

function generateInitData(telegramUserId: number): string {
  const scriptPath = path.resolve(__dirname, "../../scripts/dev-mock-init-data.ts");
  return execFileSync("npx", ["tsx", scriptPath, String(telegramUserId)], {
    encoding: "utf-8",
  }).trim();
}

const db = getServiceRoleClient();

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

async function countMovementsForSession(sessionId: string): Promise<number> {
  const { count, error } = await db
    .from("stock_movements")
    .select("*", { count: "exact", head: true })
    .eq("session_id", sessionId);
  if (error) throw error;
  return count ?? 0;
}

describe("POST /api/store/cart/submit -- idempotency + 'took the last of it'", () => {
  let initDataHeader: string;
  let memberId: string;
  let robotHolderId: string;
  let storeHolderId: string;
  let assetProductId: string;
  let looseProductId: string;
  let baselineMaxId: number;
  const createdSessionIds: string[] = [];

  function submit(body: unknown) {
    return POST(
      new Request(SUBMIT_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": initDataHeader,
        },
        body: JSON.stringify(body),
      }),
    );
  }

  beforeAll(async () => {
    initDataHeader = generateInitData(TEST_TELEGRAM_USER_ID);

    const { data: member, error: memberErr } = await db
      .from("members")
      .select("id")
      .eq("telegram_user_id", TEST_TELEGRAM_USER_ID)
      .single();
    if (memberErr) throw memberErr;
    memberId = member.id;

    const { data: robot, error: robotErr } = await db
      .from("holders")
      .select("id")
      .eq("kind", "robot")
      .eq("active", true)
      .limit(1)
      .single();
    if (robotErr) throw robotErr;
    robotHolderId = robot.id;

    const { data: store, error: storeErr } = await db
      .from("holders")
      .select("id")
      .eq("kind", "store")
      .eq("active", true)
      .single();
    if (storeErr) throw storeErr;
    storeHolderId = store.id;

    const { data: asset, error: assetErr } = await db
      .from("products")
      .select("id")
      .eq("name", "DJI GM6020 motor")
      .eq("active", true)
      .single();
    if (assetErr) throw assetErr;
    assetProductId = asset.id;

    const { data: loose, error: looseErr } = await db
      .from("products")
      .select("id")
      .eq("tier", "loose")
      .eq("active", true)
      .order("name")
      .limit(1)
      .single();
    if (looseErr) throw looseErr;
    looseProductId = loose.id;

    baselineMaxId = await maxStockMovementId();
  });

  afterAll(async () => {
    if (createdSessionIds.length > 0) {
      const { error: delCountsErr } = await db
        .from("stock_counts")
        .delete()
        .in("session_id", createdSessionIds);
      if (delCountsErr) throw delCountsErr;
    }

  // Scoped to this file's own sessions, not a blanket "everything above the
  // watermark": several agents run this suite against the same live project
  // concurrently, and a blanket delete eats the rows another run is still
  // asserting on. The watermark is kept as a guard (nothing below it can be
  // touched) and as the final "nothing of ours remains" check.
    if (createdSessionIds.length > 0) {
      const { error: delMovementsErr } = await db
        .from("stock_movements")
        .delete()
        .gt("id", baselineMaxId)
        .in("session_id", createdSessionIds);
      if (delMovementsErr) throw delMovementsErr;

      const { error: delSessionsErr } = await db
        .from("sessions")
        .delete()
        .in("id", createdSessionIds);
      if (delSessionsErr) throw delSessionsErr;

      const { count: leftover, error: leftoverErr } = await db
        .from("stock_movements")
        .select("*", { count: "exact", head: true })
        .in("session_id", createdSessionIds);
      if (leftoverErr) throw leftoverErr;
      expect(leftover).toBe(0);
    }
  });

  it("rejects a clientToken that isn't a UUID, before touching the DB", async () => {
    const before = await maxStockMovementId();
    const res = await submit({
      mode: "borrow",
      destHolderId: robotHolderId,
      clientToken: "not-a-uuid",
      lines: [{ productId: assetProductId, qty: 1, entryMethod: "scan" }],
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_request");
    expect(await maxStockMovementId()).toBe(before);
  });

  it("the same token twice -> one session, one set of movements, same response shape", async () => {
    const clientToken = randomUUID();
    const body = {
      mode: "borrow",
      destHolderId: robotHolderId,
      clientToken,
      lines: [
        { productId: assetProductId, qty: 1, entryMethod: "scan" as const },
      ],
    };

    const first = await submit(body);
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    createdSessionIds.push(firstJson.sessionId);

    const movementsAfterFirst = await countMovementsForSession(firstJson.sessionId);
    expect(movementsAfterFirst).toBe(1);

    // The double-tap / retry-after-timeout replay.
    const second = await submit(body);
    expect(second.status).toBe(200);
    const secondJson = await second.json();

    // Same session back, and the response shape is unchanged -- the client
    // cannot (and need not) tell a replay from a first write.
    expect(secondJson.sessionId).toBe(firstJson.sessionId);
    expect(secondJson.movementCount).toBe(1);
    expect(Object.keys(secondJson).sort()).toEqual(["movementCount", "sessionId"]);

    // Nothing extra was written.
    expect(await countMovementsForSession(firstJson.sessionId)).toBe(1);

    const { count: sessionCount, error } = await db
      .from("sessions")
      .select("*", { count: "exact", head: true })
      .eq("client_token", clientToken);
    if (error) throw error;
    expect(sessionCount).toBe(1);
  });

  it("a different token is a genuinely new write", async () => {
    const lines = [{ productId: assetProductId, qty: 1, entryMethod: "scan" as const }];

    const first = await submit({
      mode: "borrow",
      destHolderId: robotHolderId,
      clientToken: randomUUID(),
      lines,
    });
    const second = await submit({
      mode: "borrow",
      destHolderId: robotHolderId,
      clientToken: randomUUID(),
      lines,
    });

    const firstJson = await first.json();
    const secondJson = await second.json();
    createdSessionIds.push(firstJson.sessionId, secondJson.sessionId);

    expect(secondJson.sessionId).not.toBe(firstJson.sessionId);
    expect(await countMovementsForSession(firstJson.sessionId)).toBe(1);
    expect(await countMovementsForSession(secondJson.sessionId)).toBe(1);
  });

  it("omitting the token keeps the pre-0019 behaviour (every submit is its own session)", async () => {
    const body = {
      mode: "borrow",
      destHolderId: robotHolderId,
      lines: [{ productId: assetProductId, qty: 1, entryMethod: "scan" as const }],
    };

    const first = await submit(body);
    const second = await submit(body);
    const firstJson = await first.json();
    const secondJson = await second.json();
    createdSessionIds.push(firstJson.sessionId, secondJson.sessionId);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(secondJson.sessionId).not.toBe(firstJson.sessionId);
  });

  it("'took the last of it' on a loose line records a zero count against the store", async () => {
    const clientToken = randomUUID();
    const body = {
      mode: "borrow",
      destHolderId: robotHolderId,
      clientToken,
      lines: [
        { productId: looseProductId, qty: 1, entryMethod: "scan" as const, tookLast: true },
      ],
    };

    const res = await submit(body);
    expect(res.status).toBe(200);
    const { sessionId, movementCount } = await res.json();
    createdSessionIds.push(sessionId);

    // The flag changes nothing about the movement itself -- flows.md §4:
    // loose items never get an exact count.
    expect(movementCount).toBe(1);
    expect(await countMovementsForSession(sessionId)).toBe(1);

    const { data: counts, error } = await db
      .from("stock_counts")
      .select("product_id, holder_id, counted_qty, counted_by, note")
      .eq("session_id", sessionId);
    if (error) throw error;

    expect(counts).toHaveLength(1);
    expect(counts![0].product_id).toBe(looseProductId);
    expect(counts![0].holder_id).toBe(storeHolderId);
    expect(counts![0].counted_qty).toBe(0);
    expect(counts![0].counted_by).toBe(memberId);
    expect(counts![0].note).toContain("took the last of it");

    // A replay must not double-record the flag either.
    const replay = await submit(body);
    expect(replay.status).toBe(200);
    expect((await replay.json()).sessionId).toBe(sessionId);

    const { count: afterReplay, error: replayErr } = await db
      .from("stock_counts")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);
    if (replayErr) throw replayErr;
    expect(afterReplay).toBe(1);
  });

  it("ignores tookLast on a non-loose line (the tier comes from the DB, not the client)", async () => {
    const res = await submit({
      mode: "borrow",
      destHolderId: robotHolderId,
      clientToken: randomUUID(),
      lines: [{ productId: assetProductId, qty: 1, entryMethod: "scan", tookLast: true }],
    });
    expect(res.status).toBe(200);
    const { sessionId } = await res.json();
    createdSessionIds.push(sessionId);

    const { count, error } = await db
      .from("stock_counts")
      .select("*", { count: "exact", head: true })
      .eq("session_id", sessionId);
    if (error) throw error;
    expect(count).toBe(0);
  });

  it("a RETURN replayed with the same token writes one set of movements", async () => {
    // The return walk has its own Stage machine (it does not use
    // cartReducer), and shipped WITHOUT sending a clientToken at all -- so
    // its own Retry button re-wrote every return movement. This is the
    // server half of that fix: the same token twice is one session.
    const borrowToken = randomUUID();
    const borrow = await submit({
      mode: "borrow",
      destHolderId: robotHolderId,
      clientToken: borrowToken,
      lines: [{ productId: assetProductId, qty: 1, entryMethod: "scan" as const }],
    });
    expect(borrow.status).toBe(200);
    const { sessionId: borrowSessionId } = await borrow.json();
    createdSessionIds.push(borrowSessionId);

    const returnToken = randomUUID();
    const returnBody = {
      mode: "return",
      sourceHolderId: robotHolderId,
      clientToken: returnToken,
      // Exactly what buildReturnSubmitBody produces for a checklist row.
      lines: [{ productId: assetProductId, qty: 1, entryMethod: "search" as const }],
    };

    const first = await submit(returnBody);
    expect(first.status).toBe(200);
    const firstJson = await first.json();
    createdSessionIds.push(firstJson.sessionId);
    expect(await countMovementsForSession(firstJson.sessionId)).toBe(1);

    // The Retry-after-timeout replay.
    const second = await submit(returnBody);
    expect(second.status).toBe(200);
    const secondJson = await second.json();

    expect(secondJson.sessionId).toBe(firstJson.sessionId);
    expect(await countMovementsForSession(firstJson.sessionId)).toBe(1);

    const { count: sessionCount, error } = await db
      .from("sessions")
      .select("*", { count: "exact", head: true })
      .eq("client_token", returnToken);
    if (error) throw error;
    expect(sessionCount).toBe(1);
  });
});
