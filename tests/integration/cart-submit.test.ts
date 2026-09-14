import "../../scripts/_env";
import "./_schema-guard";

import { execFileSync } from "node:child_process";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/store/cart/submit/route";

// ---------------------------------------------------------------------------
// Integration test for WP14 (/api/store/cart/submit). Runs against the `test`
// schema of the live Supabase project (no mocking, real RPC calls): a snapshot
// of the real catalog plus scripts/seed-test-schema.ts's test accounts. Hits the route
// handler directly by constructing `Request` objects.
//
// Cleanup strategy: capture the max stock_movements.id and sessions row
// count before the suite runs, then in afterAll delete every
// stock_movements/sessions row created above that watermark so the live DB
// is left clean for other work packages' holdings/search tests.
// ---------------------------------------------------------------------------

const TEST_TELEGRAM_USER_ID = 900000000001;
const SUBMIT_URL = "http://localhost/api/store/cart/submit";

function generateInitData(telegramUserId: number): string {
  const scriptPath = path.resolve(__dirname, "../../scripts/dev-mock-init-data.ts");
  const stdout = execFileSync("npx", ["tsx", scriptPath, String(telegramUserId)], {
    encoding: "utf-8",
  });
  return stdout.trim();
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(SUBMIT_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const db = getServiceRoleClient();

async function countStockMovements(): Promise<number> {
  const { count, error } = await db
    .from("stock_movements")
    .select("*", { count: "exact", head: true });
  if (error) throw error;
  return count ?? 0;
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

/**
 * Mirrors submit_cart's own held-qty computation (sum of qty into
 * holderId minus qty out of holderId, for this product) so the over-return
 * test is robust against any pre-existing movements against this
 * product/holder pair left by other work packages' fixtures or tests,
 * rather than assuming a from-zero baseline.
 */
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

  const sumInto = (into ?? []).reduce((acc, r) => acc + r.qty, 0);
  const sumOut = (outOf ?? []).reduce((acc, r) => acc + r.qty, 0);
  return sumInto - sumOut;
}

describe("POST /api/store/cart/submit (integration, live DB)", () => {
  let initDataHeader: string;
  let memberId: string;
  let storeHolderId: string;
  let robotHolderId: string;
  let memberPersonalHolderId: string;
  let assetProductId: string;
  let bulkProductId: string;
  let baselineMaxId: number;

  beforeAll(async () => {
    initDataHeader = generateInitData(TEST_TELEGRAM_USER_ID);

    const { data: member, error: memberErr } = await db
      .from("members")
      .select("id")
      .eq("telegram_user_id", TEST_TELEGRAM_USER_ID)
      .single();
    if (memberErr) throw memberErr;
    memberId = member.id;

    const { data: personalHolder, error: personalErr } = await db
      .from("holders")
      .select("id")
      .eq("kind", "member")
      .eq("member_id", memberId)
      .single();
    if (personalErr) throw personalErr;
    memberPersonalHolderId = personalHolder.id;

    const { data: storeHolder, error: storeErr } = await db
      .from("holders")
      .select("id")
      .eq("kind", "store")
      .eq("active", true)
      .single();
    if (storeErr) throw storeErr;
    storeHolderId = storeHolder.id;

    const { data: robotHolder, error: robotErr } = await db
      .from("holders")
      .select("id")
      .eq("kind", "robot")
      .eq("active", true)
      .limit(1)
      .single();
    if (robotErr) throw robotErr;
    robotHolderId = robotHolder.id;

    const { data: assetProduct, error: assetErr } = await db
      .from("products")
      .select("id")
      .eq("name", "DJI GM6020 motor")
      .eq("active", true)
      .single();
    if (assetErr) throw assetErr;
    assetProductId = assetProduct.id;

    const { data: bulkProduct, error: bulkErr } = await db
      .from("products")
      .select("id")
      .eq("name", "XT30 right angle M")
      .eq("active", true)
      .single();
    if (bulkErr) throw bulkErr;
    bulkProductId = bulkProduct.id;

    baselineMaxId = await maxStockMovementId();
  });

  afterAll(async () => {
    // Delete every stock_movements row created above the baseline watermark,
    // then every sessions row created by this member during the test run.
    const { error: delMovementsErr } = await db
      .from("stock_movements")
      .delete()
      .gt("id", baselineMaxId);
    if (delMovementsErr) throw delMovementsErr;

    const { error: delSessionsErr } = await db
      .from("sessions")
      .delete()
      .eq("member_id", memberId)
      .eq("source", "miniapp");
    if (delSessionsErr) throw delSessionsErr;

    const finalCount = await countStockMovements();
    const finalMaxId = await maxStockMovementId();
    // Sanity: after cleanup, nothing above the baseline watermark remains.
    expect(finalMaxId).toBeLessThanOrEqual(baselineMaxId);
    void finalCount;
  });

  it("borrows an asset-tier product to a robot holder -> one 'borrow' movement", async () => {
    const before = await countStockMovements();

    const request = makeRequest(
      {
        mode: "borrow",
        destHolderId: robotHolderId,
        lines: [
          {
            productId: assetProductId,
            qty: 1,
            entryMethod: "scan",
          },
        ],
      },
      { "X-Telegram-Init-Data": initDataHeader },
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.movementCount).toBe(1);
    expect(typeof json.sessionId).toBe("string");

    const after = await countStockMovements();
    expect(after - before).toBe(1);

    const { data: movements, error } = await db
      .from("stock_movements")
      .select("*")
      .eq("session_id", json.sessionId);
    if (error) throw error;
    expect(movements).toHaveLength(1);
    expect(movements![0].reason).toBe("borrow");
    expect(movements![0].to_holder_id).toBe(robotHolderId);
    expect(movements![0].product_id).toBe(assetProductId);
    expect(movements![0].qty).toBe(1);
  });

  it("borrows a bulk-tier product to a robot holder -> one 'consume' movement, to_holder = robot", async () => {
    const before = await countStockMovements();

    const request = makeRequest(
      {
        mode: "borrow",
        destHolderId: robotHolderId,
        lines: [
          {
            productId: bulkProductId,
            qty: 3,
            entryMethod: "scan",
          },
        ],
      },
      { "X-Telegram-Init-Data": initDataHeader },
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();

    const after = await countStockMovements();
    expect(after - before).toBe(1);

    const { data: movements, error } = await db
      .from("stock_movements")
      .select("*")
      .eq("session_id", json.sessionId);
    if (error) throw error;
    expect(movements).toHaveLength(1);
    expect(movements![0].reason).toBe("consume");
    expect(movements![0].to_holder_id).toBe(robotHolderId);
  });

  it("borrows a bulk-tier product to the member's personal holder -> one 'consume' movement, to_holder = consumed pseudo-holder", async () => {
    const { data: consumedHolder, error: consumedErr } = await db
      .from("holders")
      .select("id")
      .eq("kind", "consumed")
      .eq("active", true)
      .single();
    if (consumedErr) throw consumedErr;

    const before = await countStockMovements();

    const request = makeRequest(
      {
        mode: "borrow",
        destHolderId: memberPersonalHolderId,
        lines: [
          {
            productId: bulkProductId,
            qty: 2,
            entryMethod: "scan",
          },
        ],
      },
      { "X-Telegram-Init-Data": initDataHeader },
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();

    const after = await countStockMovements();
    expect(after - before).toBe(1);

    const { data: movements, error } = await db
      .from("stock_movements")
      .select("*")
      .eq("session_id", json.sessionId);
    if (error) throw error;
    expect(movements).toHaveLength(1);
    expect(movements![0].reason).toBe("consume");
    expect(movements![0].to_holder_id).toBe(consumedHolder.id);
    expect(movements![0].to_holder_id).not.toBe(memberPersonalHolderId);
  });

  it("over-return: borrow 2 then return 5 -> a 'return' movement (qty 2) plus a 'return_adjustment' movement (qty 3) from the adjustment holder", async () => {
    const { data: adjustmentHolder, error: adjErr } = await db
      .from("holders")
      .select("id")
      .eq("kind", "adjustment")
      .eq("active", true)
      .single();
    if (adjErr) throw adjErr;

    // Use a fresh robot as the source-of-truth holder for this scenario to
    // keep the "held qty" computation isolated from other tests' movements
    // against the same product/holder pair.
    const { data: robots, error: robotsErr } = await db
      .from("holders")
      .select("id")
      .eq("kind", "robot")
      .eq("active", true);
    if (robotsErr) throw robotsErr;
    const sourceHolderId = robots![robots!.length - 1].id;

    // Robust against any pre-existing movements this product/holder pair
    // may already have from other work packages' fixtures/tests: compute
    // the actual held qty via the same formula submit_cart uses, rather
    // than assuming a from-zero baseline.
    const heldBeforeBorrow = await heldQty(assetProductId, sourceHolderId);

    // Step 1: borrow qty 2 to sourceHolderId (asset-tier so it goes straight
    // to that holder as 'borrow'), bringing held qty to heldBeforeBorrow + 2.
    const borrowRequest = makeRequest(
      {
        mode: "borrow",
        destHolderId: sourceHolderId,
        lines: [{ productId: assetProductId, qty: 2, entryMethod: "scan" }],
      },
      { "X-Telegram-Init-Data": initDataHeader },
    );
    const borrowResponse = await POST(borrowRequest);
    expect(borrowResponse.status).toBe(200);

    const heldAfterBorrow = heldBeforeBorrow + 2;
    const before = await countStockMovements();

    // Step 2: return more than what's held (held + 3), forcing the
    // over-return split: one 'return' movement for the full held amount,
    // one 'return_adjustment' movement for the excess (3).
    const overReturnQty = heldAfterBorrow + 3;
    const returnRequest = makeRequest(
      {
        mode: "return",
        sourceHolderId,
        lines: [{ productId: assetProductId, qty: overReturnQty, entryMethod: "scan" }],
      },
      { "X-Telegram-Init-Data": initDataHeader },
    );
    const returnResponse = await POST(returnRequest);
    expect(returnResponse.status).toBe(200);
    const returnJson = await returnResponse.json();

    const after = await countStockMovements();
    expect(after - before).toBe(2);

    const { data: movements, error } = await db
      .from("stock_movements")
      .select("*")
      .eq("session_id", returnJson.sessionId)
      .order("id", { ascending: true });
    if (error) throw error;
    expect(movements).toHaveLength(2);

    const returnMovement = movements!.find((m) => m.reason === "return");
    const adjustmentMovement = movements!.find((m) => m.reason === "return_adjustment");

    expect(returnMovement).toBeDefined();
    expect(returnMovement!.qty).toBe(heldAfterBorrow);
    expect(returnMovement!.from_holder_id).toBe(sourceHolderId);
    expect(returnMovement!.to_holder_id).toBe(storeHolderId);

    expect(adjustmentMovement).toBeDefined();
    expect(adjustmentMovement!.qty).toBe(3);
    expect(adjustmentMovement!.from_holder_id).toBe(adjustmentHolder.id);
    expect(adjustmentMovement!.to_holder_id).toBe(storeHolderId);
  });

  it("two lines with the same productId in one submission produce two separate movement rows (no server-side merging)", async () => {
    const before = await countStockMovements();

    const request = makeRequest(
      {
        mode: "borrow",
        destHolderId: robotHolderId,
        lines: [
          { productId: assetProductId, qty: 1, entryMethod: "scan" },
          { productId: assetProductId, qty: 1, entryMethod: "scan" },
        ],
      },
      { "X-Telegram-Init-Data": initDataHeader },
    );

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.movementCount).toBe(2);

    const after = await countStockMovements();
    expect(after - before).toBe(2);

    const { data: movements, error } = await db
      .from("stock_movements")
      .select("*")
      .eq("session_id", json.sessionId);
    if (error) throw error;
    expect(movements).toHaveLength(2);
  });

  describe("malformed bodies -> 400, zero DB writes", () => {
    it("missing lines", async () => {
      const before = await countStockMovements();
      const request = makeRequest(
        { mode: "borrow", destHolderId: robotHolderId },
        { "X-Telegram-Init-Data": initDataHeader },
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(await countStockMovements()).toBe(before);
    });

    it("qty: 0", async () => {
      const before = await countStockMovements();
      const request = makeRequest(
        {
          mode: "borrow",
          destHolderId: robotHolderId,
          lines: [{ productId: assetProductId, qty: 0, entryMethod: "scan" }],
        },
        { "X-Telegram-Init-Data": initDataHeader },
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(await countStockMovements()).toBe(before);
    });

    it("qty: -1", async () => {
      const before = await countStockMovements();
      const request = makeRequest(
        {
          mode: "borrow",
          destHolderId: robotHolderId,
          lines: [{ productId: assetProductId, qty: -1, entryMethod: "scan" }],
        },
        { "X-Telegram-Init-Data": initDataHeader },
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(await countStockMovements()).toBe(before);
    });

    it("mode: 'borrow' without destHolderId", async () => {
      const before = await countStockMovements();
      const request = makeRequest(
        {
          mode: "borrow",
          lines: [{ productId: assetProductId, qty: 1, entryMethod: "scan" }],
        },
        { "X-Telegram-Init-Data": initDataHeader },
      );
      const response = await POST(request);
      expect(response.status).toBe(400);
      expect(await countStockMovements()).toBe(before);
    });
  });

  it("THE ATOMICITY TEST: a submission with a valid first line and a non-existent productId second line fails entirely (500) with zero rows written for any line", async () => {
    const before = await countStockMovements();

    const request = makeRequest(
      {
        mode: "borrow",
        destHolderId: robotHolderId,
        lines: [
          { productId: assetProductId, qty: 1, entryMethod: "scan" },
          { productId: randomUUID(), qty: 1, entryMethod: "scan" },
        ],
      },
      { "X-Telegram-Init-Data": initDataHeader },
    );

    const response = await POST(request);
    expect(response.status).toBe(500);
    const json = await response.json();
    expect(json).toEqual({ error: "submit_failed" });

    const after = await countStockMovements();
    expect(after).toBe(before);
  });
});
