import "../../scripts/_env";

import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as holdingsGET } from "@/app/api/store/holdings/route";
import { GET as sourcesGET } from "@/app/api/store/holdings/sources/route";
import { getServiceRoleClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// tests/integration/holdings.test.ts (WP13)
//
// Exercises /api/store/holdings and /api/store/holdings/sources against the
// REAL live calibur-inventory project -- no mocking. Uses the pre-bound
// fixture test member (telegram_user_id 900000000001, see
// scripts/seed-fixtures.ts) and a single throwaway stock_movements row
// (simulating a prior borrow to the seeded "Hero" robot) that this file
// inserts in a `describe` block and always deletes afterwards, marked by a
// distinguishing `scan_code` so a crashed prior run can never leave a
// permanent trace.
// ---------------------------------------------------------------------------

const TEST_TELEGRAM_USER_ID = 900000000001;
const THROWAWAY_SCAN_CODE = "TEST-WP13-THROWAWAY";

/**
 * Independent re-implementation of Telegram's initData signing scheme
 * (mirrors scripts/dev-mock-init-data.ts / tests/unit/init-data.test.ts),
 * used only to build a validly-signed header for the real test member.
 */
function signInitData(fields: Record<string, string>, botToken: string): string {
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  return new URLSearchParams({ ...fields, hash }).toString();
}

function buildValidInitData(telegramUserId: number): string {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("Missing TELEGRAM_BOT_TOKEN. Check .env.local.");
  return signInitData(
    {
      query_id: "test",
      user: JSON.stringify({ id: telegramUserId }),
      auth_date: String(Math.floor(Date.now() / 1000)),
    },
    botToken,
  );
}

function request(url: string, initData?: string): Request {
  const headers = new Headers();
  if (initData !== undefined) headers.set("X-Telegram-Init-Data", initData);
  return new Request(url, { headers });
}

const db = getServiceRoleClient();

describe("holdings routes (live DB)", () => {
  let memberId: string;
  let personalHolderId: string;
  let heroHolderId: string;
  let standardHolderId: string;
  let storeHolderId: string;
  let productId: string;
  let validInitData: string;

  beforeAll(async () => {
    const { data: member, error: memberError } = await db
      .from("members")
      .select("id")
      .eq("telegram_user_id", TEST_TELEGRAM_USER_ID)
      .single();
    if (memberError) throw memberError;
    memberId = member.id;

    const { data: personalHolder, error: personalError } = await db
      .from("holders")
      .select("id")
      .eq("member_id", memberId)
      .eq("kind", "member")
      .single();
    if (personalError) throw personalError;
    personalHolderId = personalHolder.id;

    const { data: hero, error: heroError } = await db
      .from("holders")
      .select("id")
      .eq("kind", "robot")
      .eq("name", "Hero")
      .single();
    if (heroError) throw heroError;
    heroHolderId = hero.id;

    const { data: standard, error: standardError } = await db
      .from("holders")
      .select("id")
      .eq("kind", "robot")
      .eq("name", "Standard")
      .single();
    if (standardError) throw standardError;
    standardHolderId = standard.id;

    const { data: store, error: storeError } = await db
      .from("holders")
      .select("id")
      .eq("kind", "store")
      .eq("active", true)
      .single();
    if (storeError) throw storeError;
    storeHolderId = store.id;

    const { data: product, error: productError } = await db
      .from("products")
      .select("id")
      .eq("name", "GM6020")
      .single();
    if (productError) throw productError;
    productId = product.id;

    validInitData = buildValidInitData(TEST_TELEGRAM_USER_ID);

    // Defensive: if a previous run of this file crashed before its own
    // cleanup ran, remove any leftover throwaway row before we start.
    await db.from("stock_movements").delete().eq("scan_code", THROWAWAY_SCAN_CODE);
  });

  afterAll(async () => {
    await db.from("stock_movements").delete().eq("scan_code", THROWAWAY_SCAN_CODE);
  });

  describe("auth", () => {
    it("GET /holdings/sources with no init data header -> 401", async () => {
      const res = await sourcesGET(request("http://localhost/api/store/holdings/sources"));
      expect(res.status).toBe(401);
    });

    it("GET /holdings/sources with a malformed init data header -> 401", async () => {
      const res = await sourcesGET(
        request("http://localhost/api/store/holdings/sources", "not-a-valid-init-data-string"),
      );
      expect(res.status).toBe(401);
    });

    it("GET /holdings with no init data header -> 401", async () => {
      const res = await holdingsGET(
        request(`http://localhost/api/store/holdings?holderId=${personalHolderId}`),
      );
      expect(res.status).toBe(401);
    });
  });

  describe("without the throwaway movement", () => {
    it("sources includes the member's personal holder and not Hero", async () => {
      const res = await sourcesGET(
        request("http://localhost/api/store/holdings/sources", validInitData),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { holders: { id: string; name: string; kind: string }[] };
      const ids = body.holders.map((h) => h.id);

      expect(ids).toContain(personalHolderId);
      expect(ids).not.toContain(heroHolderId);
      // Every returned holder really is either the personal holder or an
      // active robot -- no stray kinds leak through.
      for (const h of body.holders) {
        expect(["member", "robot"]).toContain(h.kind);
      }
    });

    it("holdings?holderId=<Hero, not yet an allowed source> -> 403", async () => {
      const res = await holdingsGET(
        request(`http://localhost/api/store/holdings?holderId=${heroHolderId}`, validInitData),
      );
      expect(res.status).toBe(403);
    });

    it("holdings?holderId=<some unrelated robot> -> 403", async () => {
      const res = await holdingsGET(
        request(`http://localhost/api/store/holdings?holderId=${standardHolderId}`, validInitData),
      );
      expect(res.status).toBe(403);
    });

    it("holdings?holderId=<own personal holder> -> 200 (always allowed)", async () => {
      const res = await holdingsGET(
        request(`http://localhost/api/store/holdings?holderId=${personalHolderId}`, validInitData),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { items: unknown[] };
      expect(Array.isArray(body.items)).toBe(true);
    });
  });

  describe("with a throwaway borrow-to-Hero movement", () => {
    const BORROWED_QTY = 3;
    let movementId: number;
    let baselineHeroQty: number;

    beforeAll(async () => {
      const { data: baseline, error: baselineError } = await db
        .from("holdings")
        .select("qty")
        .eq("holder_id", heroHolderId)
        .eq("product_id", productId)
        .maybeSingle();
      if (baselineError) throw baselineError;
      baselineHeroQty = baseline?.qty ?? 0;

      const { data: inserted, error: insertError } = await db
        .from("stock_movements")
        .insert({
          product_id: productId,
          from_holder_id: storeHolderId,
          to_holder_id: heroHolderId,
          qty: BORROWED_QTY,
          actor_member_id: memberId,
          reason: "borrow",
          scan_code: THROWAWAY_SCAN_CODE,
          entry_method: "scan",
        })
        .select("id")
        .single();
      if (insertError) throw insertError;
      movementId = inserted.id;
    });

    afterAll(async () => {
      const { error } = await db.from("stock_movements").delete().eq("id", movementId);
      if (error) throw error;
    });

    it("sources now includes Hero", async () => {
      const res = await sourcesGET(
        request("http://localhost/api/store/holdings/sources", validInitData),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as { holders: { id: string }[] };
      expect(body.holders.map((h) => h.id)).toContain(heroHolderId);
    });

    it("holdings?holderId=Hero now returns the borrowed product at the correct outstanding qty", async () => {
      const res = await holdingsGET(
        request(`http://localhost/api/store/holdings?holderId=${heroHolderId}`, validInitData),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        items: { productId: string; name: string; tier: string; unit: string; qty: number }[];
      };
      const line = body.items.find((item) => item.productId === productId);
      expect(line).toBeDefined();
      expect(line?.qty).toBe(baselineHeroQty + BORROWED_QTY);
      expect(line?.name).toBe("GM6020");
    });

    it("holdings?holderId=<still-unrelated robot> -> 403", async () => {
      const res = await holdingsGET(
        request(`http://localhost/api/store/holdings?holderId=${standardHolderId}`, validInitData),
      );
      expect(res.status).toBe(403);
    });
  });
});
