import "../../scripts/_env";

import { execFileSync } from "node:child_process";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase/server";
import { GET as getMyHoldings } from "@/app/api/store/me/holdings/route";
import { GET as getMyHistory } from "@/app/api/store/me/history/route";
import { POST as submitCart } from "@/app/api/store/cart/submit/route";

// ---------------------------------------------------------------------------
// Integration test for /api/store/me/* ("my items" -- the access half of
// docs/tele-qr/pdpa.md's access-and-correction obligation). Runs against the
// LIVE dev Supabase project, no mocking, driving the route handlers directly
// with `new Request(...)`.
//
// Cleanup follows the suite-wide contract: capture max(stock_movements.id)
// in beforeAll, delete everything above that watermark in afterAll (plus the
// sessions this file committed), and assert nothing remains.
// ---------------------------------------------------------------------------

const TEST_TELEGRAM_USER_ID = 900000000001;

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

describe("GET /api/store/me/* (integration, live DB)", () => {
  let initDataHeader: string;
  let memberId: string;
  let robotHolderId: string;
  let robotHolderName: string;
  let assetProductId: string;
  let assetProductName: string;
  let baselineMaxId: number;
  const createdSessionIds: string[] = [];

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
      .select("id, name")
      .eq("kind", "robot")
      .eq("active", true)
      .order("name")
      .limit(1)
      .single();
    if (robotErr) throw robotErr;
    robotHolderId = robot.id;
    robotHolderName = robot.name;

    const { data: product, error: productErr } = await db
      .from("products")
      .select("id, name")
      .eq("name", "GM6020")
      .eq("active", true)
      .single();
    if (productErr) throw productErr;
    assetProductId = product.id;
    assetProductName = product.name;

    baselineMaxId = await maxStockMovementId();

    // Give this member something to see: one borrow of a known asset to a
    // known robot, through the real submit route.
    const res = await submitCart(
      new Request("http://localhost/api/store/cart/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Telegram-Init-Data": initDataHeader,
        },
        body: JSON.stringify({
          mode: "borrow",
          destHolderId: robotHolderId,
          lines: [{ productId: assetProductId, qty: 1, entryMethod: "scan" }],
        }),
      }),
    );
    expect(res.status).toBe(200);
    createdSessionIds.push((await res.json()).sessionId);
  });

  afterAll(async () => {
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

  function request(url: string, headers: Record<string, string> = {}) {
    return new Request(url, { headers });
  }

  it("holdings: 401s without an init-data header (no anonymous access to anyone's items)", async () => {
    const res = await getMyHoldings(request("http://localhost/api/store/me/holdings"));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("missing_init_data");
  });

  it("history: 401s without an init-data header", async () => {
    const res = await getMyHistory(request("http://localhost/api/store/me/history"));
    expect(res.status).toBe(401);
  });

  it("holdings: 401s on a tampered init-data string", async () => {
    // Flip the last character OF the hash rather than appending to it:
    // Buffer.from(hash, "hex") stops decoding at the first non-hex
    // character, so trailing junk leaves the decoded hash (and its length)
    // untouched and still verifies.
    const last = initDataHeader.slice(-1);
    const tampered = initDataHeader.slice(0, -1) + (last === "0" ? "1" : "0");

    const res = await getMyHoldings(
      request("http://localhost/api/store/me/holdings", {
        "X-Telegram-Init-Data": tampered,
      }),
    );
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("bad_signature");
  });

  it("holdings: returns the member's own items grouped by holder, with no holderId supplied", async () => {
    const res = await getMyHoldings(
      request("http://localhost/api/store/me/holdings", {
        "X-Telegram-Init-Data": initDataHeader,
      }),
    );
    expect(res.status).toBe(200);

    const { holders } = (await res.json()) as {
      holders: Array<{
        holderId: string;
        holderName: string;
        items: Array<{ productId: string; name: string; qty: number }>;
      }>;
    };

    const group = holders.find((entry) => entry.holderId === robotHolderId);
    expect(group, `expected a group for ${robotHolderName}`).toBeDefined();
    expect(group!.holderName).toBe(robotHolderName);

    const item = group!.items.find((entry) => entry.productId === assetProductId);
    expect(item, `expected ${assetProductName} in the ${robotHolderName} group`).toBeDefined();
    expect(item!.qty).toBeGreaterThanOrEqual(1);

    // Every holder returned must be one this member actually holds from --
    // a member must never see another member's personal holder.
    const { data: otherMemberHolders, error } = await db
      .from("holders")
      .select("id")
      .eq("kind", "member")
      .neq("member_id", memberId);
    if (error) throw error;
    const forbidden = new Set((otherMemberHolders ?? []).map((holder) => holder.id));
    for (const entry of holders) {
      expect(forbidden.has(entry.holderId)).toBe(false);
    }

    // No empty groups: "my items" is a list of items.
    for (const entry of holders) {
      expect(entry.items.length).toBeGreaterThan(0);
    }
  });

  it("history: returns this member's own recent movements, newest first", async () => {
    const res = await getMyHistory(
      request("http://localhost/api/store/me/history", {
        "X-Telegram-Init-Data": initDataHeader,
      }),
    );
    expect(res.status).toBe(200);

    const { events } = (await res.json()) as {
      events: Array<{
        id: number;
        reason: string | null;
        qty: number;
        productName: string;
        toHolderName: string;
      }>;
    };

    expect(events.length).toBeGreaterThan(0);

    const ids = events.map((event) => event.id);
    expect([...ids].sort((a, b) => b - a)).toEqual(ids);

    const newest = events[0];
    expect(newest.productName).toBe(assetProductName);
    expect(newest.reason).toBe("borrow");
    expect(newest.toHolderName).toBe(robotHolderName);
    expect(newest.qty).toBe(1);

    // Every returned movement must belong to this member.
    const { data: mine, error } = await db
      .from("stock_movements")
      .select("id")
      .eq("actor_member_id", memberId)
      .in("id", ids);
    if (error) throw error;
    expect(mine?.length).toBe(ids.length);
  });

  it("history: clamps the limit instead of rejecting silly values", async () => {
    for (const limit of ["1", "0", "-5", "9999", "banana"]) {
      const res = await getMyHistory(
        request(`http://localhost/api/store/me/history?limit=${limit}`, {
          "X-Telegram-Init-Data": initDataHeader,
        }),
      );
      expect(res.status).toBe(200);
      const { events } = (await res.json()) as { events: unknown[] };
      expect(events.length).toBeGreaterThanOrEqual(1);
      expect(events.length).toBeLessThanOrEqual(50);
      if (limit === "1") expect(events.length).toBe(1);
    }
  });
});
