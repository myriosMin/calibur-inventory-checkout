import "../../scripts/_env";

import { afterAll, describe, expect, it } from "vitest";

import { POST } from "@/app/api/tg/webhook/route";
import { getServiceRoleClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// tests/integration/webhook-bind.test.ts
//
// Exercises src/app/api/tg/webhook/route.ts (WP10) end-to-end against the
// REAL live "calibur-inventory" Supabase project -- this codebase's
// convention is integration tests against the real remote dev project, no
// mocking of the DB layer.
//
// The one thing we deliberately don't mock is the Telegram Bot API call:
// TELEGRAM_BOT_TOKEN in .env.local is a real bot token, so `sendMessage`
// calls made against the fabricated chat ids used below genuinely fail at
// Telegram's API ("chat not found") -- which is exactly the failure mode the
// route's try/catch around the reply-send is meant to survive. Rather than
// stub bot-api.ts with test-only conditionals, we let that real failure
// happen and assert the route still returns 200.
//
// Fake Telegram user/chat ids used here are drawn from the same
// 900000000000+ range scripts/seed-fixtures.ts reserves for exactly this
// purpose (real Telegram ids are currently far below 2^32), picking ids
// other than the pre-bound fixture 900000000001 so we don't collide with it.
// All rows this file creates (or member bindings it makes) are cleaned up in
// afterAll so the live DB is left exactly as it was found.
// ---------------------------------------------------------------------------

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!WEBHOOK_SECRET) {
  throw new Error(
    "TELEGRAM_WEBHOOK_SECRET is not set -- check .env.local before running integration tests.",
  );
}

const WEBHOOK_URL = "http://localhost/api/tg/webhook";

const FIXTURE_USERNAME = "alextan_nus"; // scripts/seed-fixtures.ts -- unbound member

// Fresh fake ids per run, not the reserved 900000000001: this repo has many
// work packages under active parallel development against the same live
// project, so other sessions may run this same suite concurrently. A fixed
// constant here previously caused a one-off race (two runs inserting the
// same telegram_bind_attempts row at once); a per-run nonce keeps runs
// independent while staying safely inside the 900000000000+ reserved range.
const RUN_NONCE = Date.now() % 1_000_000;
const BIND_FAKE_ID = 900_100_000_000 + RUN_NONCE;
const UNRECOGNIZED_FAKE_ID = 900_200_000_000 + RUN_NONCE;
const NO_WRITE_FAKE_ID = 900_300_000_000 + RUN_NONCE;

function buildUpdate(opts: {
  fromId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  text: string;
}) {
  return {
    update_id: Math.floor(Math.random() * 1_000_000_000),
    message: {
      message_id: 1,
      chat: { id: opts.fromId },
      from: {
        id: opts.fromId,
        username: opts.username,
        first_name: opts.firstName,
        last_name: opts.lastName,
      },
      text: opts.text,
    },
  };
}

function buildRequest(body: unknown, secret?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (secret !== undefined) {
    headers["x-telegram-bot-api-secret-token"] = secret;
  }
  return new Request(WEBHOOK_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const db = getServiceRoleClient();

async function getMemberByUsername(username: string) {
  const { data, error } = await db
    .from("members")
    .select("id, telegram_user_id, telegram_bound_at")
    .eq("telegram_username", username)
    .single();
  if (error) throw error;
  return data;
}

async function countBindAttempts(telegramUserId: number) {
  const { count, error } = await db
    .from("telegram_bind_attempts")
    .select("id", { count: "exact", head: true })
    .eq("telegram_user_id", telegramUserId);
  if (error) throw error;
  return count ?? 0;
}

describe("POST /api/tg/webhook (WP10 identity binding)", () => {
  afterAll(async () => {
    // Reset the fixture member back to unbound -- other work packages
    // depend on it staying that way.
    await db
      .from("members")
      .update({ telegram_user_id: null, telegram_bound_at: null })
      .eq("telegram_username", FIXTURE_USERNAME);

    // Remove any bind-queue rows this suite created.
    await db
      .from("telegram_bind_attempts")
      .delete()
      .in("telegram_user_id", [
        BIND_FAKE_ID,
        UNRECOGNIZED_FAKE_ID,
        NO_WRITE_FAKE_ID,
      ]);
  });

  it("(a) rejects a missing/wrong secret header with 401 and makes zero DB writes", async () => {
    const beforeCount = await countBindAttempts(NO_WRITE_FAKE_ID);

    const update = buildUpdate({
      fromId: NO_WRITE_FAKE_ID,
      username: "totally_unrecognized_handle_zzz",
      firstName: "Ghost",
      text: "/start",
    });

    // No header at all.
    const res1 = await POST(buildRequest(update));
    expect(res1.status).toBe(401);

    // Wrong secret.
    const res2 = await POST(buildRequest(update, `${WEBHOOK_SECRET}-wrong`));
    expect(res2.status).toBe(401);

    const afterCount = await countBindAttempts(NO_WRITE_FAKE_ID);
    expect(afterCount).toBe(beforeCount);
  });

  it("(b) binds a fixture-seeded member on /start from a new fake id", async () => {
    const before = await getMemberByUsername(FIXTURE_USERNAME);
    expect(before.telegram_user_id).toBeNull();

    const update = buildUpdate({
      fromId: BIND_FAKE_ID,
      // Mixed case + no leading "@" -- exercises normalizeTelegramHandle.
      username: "AlexTan_NUS",
      firstName: "Alex",
      lastName: "Tan",
      text: "/start",
    });

    const res = await POST(buildRequest(update, WEBHOOK_SECRET));
    expect(res.status).toBe(200);

    const after = await getMemberByUsername(FIXTURE_USERNAME);
    expect(after.telegram_user_id).toBe(BIND_FAKE_ID);
    expect(after.telegram_bound_at).not.toBeNull();
  });

  it("(c) re-sending /start for the now-bound user is idempotent (no duplicate bind-queue row)", async () => {
    const beforeCount = await countBindAttempts(BIND_FAKE_ID);

    const update = buildUpdate({
      fromId: BIND_FAKE_ID,
      username: "AlexTan_NUS",
      firstName: "Alex",
      lastName: "Tan",
      text: "/start",
    });

    const res = await POST(buildRequest(update, WEBHOOK_SECRET));
    expect(res.status).toBe(200);

    const after = await getMemberByUsername(FIXTURE_USERNAME);
    expect(after.telegram_user_id).toBe(BIND_FAKE_ID);

    const afterCount = await countBindAttempts(BIND_FAKE_ID);
    expect(afterCount).toBe(beforeCount);
  });

  it("(d) queues an unrecognized user in telegram_bind_attempts", async () => {
    const beforeCount = await countBindAttempts(UNRECOGNIZED_FAKE_ID);
    expect(beforeCount).toBe(0);

    const update = buildUpdate({
      fromId: UNRECOGNIZED_FAKE_ID,
      username: "definitely_not_a_club_member_xyz",
      firstName: "Stray",
      lastName: "Visitor",
      text: "/start SOMECODE123",
    });

    const res = await POST(buildRequest(update, WEBHOOK_SECRET));
    expect(res.status).toBe(200);

    const { data, error } = await db
      .from("telegram_bind_attempts")
      .select("username, display_name, scan_code")
      .eq("telegram_user_id", UNRECOGNIZED_FAKE_ID)
      .single();

    expect(error).toBeNull();
    expect(data?.username).toBe("definitely_not_a_club_member_xyz");
    expect(data?.display_name).toBe("Stray Visitor");
    expect(data?.scan_code).toBe("SOMECODE123");
  });

  it("gracefully returns 200 even though sending the Telegram reply itself fails (fake chat id)", async () => {
    // Every case above sends chat_id = the fabricated from.id, which is not
    // a real Telegram chat -- Telegram's API genuinely rejects the
    // sendMessage call ("chat not found"). All of the above already prove
    // this doesn't crash the route (every case returned 200); this test
    // just states that guarantee explicitly using the same fake-id pattern.
    const fakeId = NO_WRITE_FAKE_ID + 1;
    const update = buildUpdate({
      fromId: fakeId,
      username: "another_unrecognized_handle",
      firstName: "Another",
      text: "/start",
    });

    const res = await POST(buildRequest(update, WEBHOOK_SECRET));
    expect(res.status).toBe(200);

    // Clean up this one too.
    await db.from("telegram_bind_attempts").delete().eq("telegram_user_id", fakeId);
  });
});
