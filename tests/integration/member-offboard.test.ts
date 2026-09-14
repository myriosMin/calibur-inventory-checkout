import "../../scripts/_env";
import "./_schema-guard";

import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as destinationsGET } from "@/app/api/store/destinations/route";
import {
  buildOffboardPatch,
  buildUnbindPatch,
  todayIsoDate,
} from "@/app/admin/members/memberLifecycle";
import { getServiceRoleClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// tests/integration/member-offboard.test.ts
//
// Proves the PDPA commitment in docs/tele-qr/pdpa.md end-to-end against the
// REAL live Supabase project: "On leaving the club, or on request: clear
// `telegram_user_id`, set `active = false`, unlink the Telegram binding" —
// AND its retention counterpart, that the member record and the borrowing
// history survive ("Retained as club inventory records").
//
// The claim actually under test is pdpa.md design rule 5: *"Deactivation is
// immediate and effective. Clearing the binding must lock the account out on
// the NEXT REQUEST, not at the next deploy."* Asserting that requires a real
// request through requireMember() rather than a unit test, because what makes
// it true is that requireMember re-reads the members row on every call — there
// is no cached session, token or in-memory member to go stale.
//
// This file deliberately does NOT touch the shared fixture member
// (telegram_user_id 900000000001) that every other integration suite depends
// on: offboarding that row would deactivate it for the whole suite. It creates
// its own throwaway member (plus one throwaway movement), and deletes both in
// afterAll. Ids come from the 900000000000+ range scripts/seed-test-schema.ts
// reserves, with a per-run nonce so concurrent runs can't collide.
// ---------------------------------------------------------------------------

const RUN_NONCE = Date.now() % 1_000_000;
const THROWAWAY_TELEGRAM_USER_ID = 900_400_000_000 + RUN_NONCE;
const THROWAWAY_EMAIL = `offboard.test.${RUN_NONCE}@example.invalid`;
const THROWAWAY_HANDLE = `offboardtest${RUN_NONCE}`;
const DESTINATIONS_URL = "http://localhost/api/store/destinations";

/** Mirrors tests/integration/holdings.test.ts — an independent implementation
 *  of Telegram's initData signing, used only to build a valid header. */
function buildValidInitData(telegramUserId: number): string {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("Missing TELEGRAM_BOT_TOKEN. Check .env.local.");

  const fields: Record<string, string> = {
    query_id: "test",
    user: JSON.stringify({ id: telegramUserId }),
    auth_date: String(Math.floor(Date.now() / 1000)),
  };
  const dataCheckString = Object.keys(fields)
    .sort()
    .map((key) => `${key}=${fields[key]}`)
    .join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hash = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const db = getServiceRoleClient();

describe("member offboarding (live DB)", () => {
  let memberId: string;
  let movementId: number | null = null;
  let baselineMaxMovementId = 0;
  let initData: string;

  beforeAll(async () => {
    const { data: maxRow } = await db
      .from("stock_movements")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    baselineMaxMovementId = maxRow?.id ?? 0;

    const { data: member, error } = await db
      .from("members")
      .insert({
        full_name: `Offboard Test ${RUN_NONCE}`,
        nus_email: THROWAWAY_EMAIL,
        telegram_username: THROWAWAY_HANDLE,
        telegram_user_id: THROWAWAY_TELEGRAM_USER_ID,
        telegram_bound_at: new Date().toISOString(),
        role: "member",
        active: true,
      })
      .select()
      .single();
    if (error) throw error;
    memberId = member.id;
    initData = buildValidInitData(THROWAWAY_TELEGRAM_USER_ID);

    // One borrow-shaped movement attributed to this member, so "history is
    // retained, not deleted" is a claim with something behind it. The member's
    // own holder was created by the create_member_holder trigger on insert.
    const { data: memberHolder, error: holderError } = await db
      .from("holders")
      .select("id")
      .eq("member_id", memberId)
      .eq("kind", "member")
      .single();
    if (holderError) throw holderError;

    const { data: storeHolder, error: storeError } = await db
      .from("holders")
      .select("id")
      .eq("kind", "store")
      .eq("name", "Store")
      .single();
    if (storeError) throw storeError;

    const { data: product, error: productError } = await db
      .from("products")
      .select("id")
      .limit(1)
      .single();
    if (productError) throw productError;

    const { data: movement, error: movementError } = await db
      .from("stock_movements")
      .insert({
        product_id: product.id,
        from_holder_id: storeHolder.id,
        to_holder_id: memberHolder.id,
        qty: 1,
        actor_member_id: memberId,
        reason: "borrow",
        entry_method: "admin",
        scan_code: `TEST-OFFBOARD-${RUN_NONCE}`,
      })
      .select()
      .single();
    if (movementError) throw movementError;
    movementId = movement.id;
  });

  afterAll(async () => {
    // Movements first (they reference the member), then the member. The
    // member's holder row goes with it only if nothing else references it, so
    // delete it explicitly.
    await db.from("stock_movements").delete().gt("id", baselineMaxMovementId);
    await db.from("holders").delete().eq("member_id", memberId);
    await db.from("members").delete().eq("id", memberId);

    const { data: finalMax } = await db
      .from("stock_movements")
      .select("id")
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    expect(finalMax?.id ?? 0).toBeLessThanOrEqual(baselineMaxMovementId);

    const { data: leftovers } = await db.from("members").select("id").eq("id", memberId);
    expect(leftovers ?? []).toHaveLength(0);
  });

  it("an active bound member can reach a /api/store/* route", async () => {
    const response = await destinationsGET(
      new Request(DESTINATIONS_URL, { headers: { "X-Telegram-Init-Data": initData } }),
    );
    expect(response.status).toBe(200);
  });

  it("unbinding alone clears the binding but leaves the member active", async () => {
    const { data: unbound, error } = await db
      .from("members")
      .update(buildUnbindPatch())
      .eq("id", memberId)
      .select()
      .single();
    if (error) throw error;

    expect(unbound.telegram_user_id).toBeNull();
    expect(unbound.telegram_bound_at).toBeNull();
    expect(unbound.active).toBe(true);
    // The handle survives, which is what lets the bind queue match them again
    // (flows.md §5: "they changed their Telegram handle").
    expect(unbound.telegram_username).toBe(THROWAWAY_HANDLE);

    // With the binding gone, the same initData no longer resolves to anyone.
    const response = await destinationsGET(
      new Request(DESTINATIONS_URL, { headers: { "X-Telegram-Init-Data": initData } }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "not_registered" });

    // Re-bind for the offboard test below.
    const { error: rebindError } = await db
      .from("members")
      .update({
        telegram_user_id: THROWAWAY_TELEGRAM_USER_ID,
        telegram_bound_at: new Date().toISOString(),
      })
      .eq("id", memberId);
    if (rebindError) throw rebindError;
  });

  it("offboarding locks the member out on their NEXT request, not at the next deploy", async () => {
    // Deliberately offboard with the binding still in place, so the 403 below
    // can only come from the `active` check — not from the row having become
    // unfindable. This is the pdpa.md design-rule-5 assertion.
    const { data: offboarded, error } = await db
      .from("members")
      .update({ active: false, left_at: todayIsoDate() })
      .eq("id", memberId)
      .select()
      .single();
    if (error) throw error;
    expect(offboarded.active).toBe(false);
    expect(offboarded.telegram_user_id).toBe(THROWAWAY_TELEGRAM_USER_ID);

    const response = await destinationsGET(
      new Request(DESTINATIONS_URL, { headers: { "X-Telegram-Init-Data": initData } }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "inactive" });
  });

  it("the full offboard patch unlinks and deactivates in one write", async () => {
    const today = todayIsoDate();
    const { data: before } = await db
      .from("members")
      .select("left_at")
      .eq("id", memberId)
      .single();

    const { data: offboarded, error } = await db
      .from("members")
      .update(buildOffboardPatch(today, before?.left_at ?? null))
      .eq("id", memberId)
      .select()
      .single();
    if (error) throw error;

    expect(offboarded.telegram_user_id).toBeNull();
    expect(offboarded.telegram_bound_at).toBeNull();
    expect(offboarded.active).toBe(false);
    expect(offboarded.left_at).toBe(before?.left_at ?? today);

    const response = await destinationsGET(
      new Request(DESTINATIONS_URL, { headers: { "X-Telegram-Init-Data": initData } }),
    );
    expect(response.status).toBe(403);
  });

  it("keeps the member row and their borrowing history (pdpa.md retention)", async () => {
    // pdpa.md: the member record is "Deactivated on leaving; kept for
    // historical attribution", and history is "Retained as club inventory
    // records" — it only stops being linked to a live Telegram account.
    const { data: stillThere, error } = await db
      .from("members")
      .select("id, full_name, nus_email")
      .eq("id", memberId)
      .single();
    if (error) throw error;
    expect(stillThere.full_name).toContain("Offboard Test");
    expect(stillThere.nus_email).toBe(THROWAWAY_EMAIL);

    const { data: movement, error: movementError } = await db
      .from("stock_movements")
      .select("id, actor_member_id, qty")
      .eq("id", movementId!)
      .single();
    if (movementError) throw movementError;
    expect(movement.actor_member_id).toBe(memberId);
    expect(movement.qty).toBe(1);
  });
});
