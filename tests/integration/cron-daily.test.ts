import "../../scripts/_env";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/cron/daily/route";

// ---------------------------------------------------------------------------
// Integration test for /api/cron/daily. Runs against the LIVE dev Supabase
// project (no mocking) and hits the route handler directly with a
// `new Request(...)`, like every other integration file here.
//
// SAFETY -- read before adding a test that omits `dryRun=1`:
//
//   This route's whole job is to SEND TELEGRAM MESSAGES and DELETE ROWS.
//   Two guards keep a test run from reaching a real person:
//
//   1. `TELEGRAM_ALERT_CHAT_ID` is unset in the test env, which makes every
//      club-chat message a no-op. That is asserted below rather than
//      assumed, and the real-run test skips itself if the variable ever
//      appears in someone's .env.local.
//   2. Overdue nudges are DMs and are NOT gated on that variable -- they go
//      to whichever member is holding something. The live dev project does
//      contain a member bound to a real Telegram account. So the real-run
//      test first asks the route, in dry-run mode, how many DMs it would
//      send, and skips itself unless the answer is zero.
//
// Cleanup: the only row this suite creates is one deliberately-ancient
// `telegram_bind_attempts` record used to prove the PDPA retention purge
// actually deletes something. Its id is recorded up front and removed in
// afterAll if the purge did not already take it.
// ---------------------------------------------------------------------------

const CRON_URL = "http://localhost/api/cron/daily";
const TEST_SECRET = "integration-test-cron-secret-value";

/** Fabricated, in the same 9xx… range the other fixtures use. */
const PURGE_FIXTURE_TELEGRAM_USER_ID = 999000000001;

function makeRequest(options: { secret?: string | null; dryRun?: boolean; raw?: string } = {}): Request {
  const url = options.dryRun ? `${CRON_URL}?dryRun=1` : CRON_URL;
  const headers: Record<string, string> = {};
  if (options.raw !== undefined) headers.Authorization = options.raw;
  else if (options.secret !== null && options.secret !== undefined) {
    headers.Authorization = `Bearer ${options.secret}`;
  }
  return new Request(url, { method: "GET", headers });
}

const db = getServiceRoleClient();

const RETENTION_DAYS = 90;

/** Bind attempts INSIDE the retention window — the rows the purge must not touch. */
async function countRecentBindAttempts(): Promise<number> {
  const { count, error } = await db
    .from("telegram_bind_attempts")
    .select("*", { count: "exact", head: true })
    .gte("created_at", new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString());
  if (error) throw error;
  return count ?? 0;
}

describe("GET /api/cron/daily (integration, live DB)", () => {
  let originalCronSecret: string | undefined;
  let purgeFixtureId: string;
  let recentBindAttempts: number;

  beforeAll(async () => {
    originalCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = TEST_SECRET;

    recentBindAttempts = await countRecentBindAttempts();

    // 120 days old: comfortably past pdpa.md's 90-day retention line for
    // telegram_bind_attempts.
    const createdAt = new Date(Date.now() - 120 * 86_400_000).toISOString();
    const { data, error } = await db
      .from("telegram_bind_attempts")
      .insert({
        telegram_user_id: PURGE_FIXTURE_TELEGRAM_USER_ID,
        username: "cron_purge_fixture",
        display_name: "Cron Purge Fixture",
        created_at: createdAt,
      })
      .select("id")
      .single();
    if (error) throw error;
    purgeFixtureId = data.id;
  });

  afterAll(async () => {
    const { error } = await db.from("telegram_bind_attempts").delete().eq("id", purgeFixtureId);
    if (error) throw error;

    const { data } = await db
      .from("telegram_bind_attempts")
      .select("id")
      .eq("id", purgeFixtureId)
      .maybeSingle();
    expect(data).toBeNull();

    if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = originalCronSecret;
  });

  // -------------------------------------------------------------------------
  // Auth
  // -------------------------------------------------------------------------

  it("returns 401 with no Authorization header", async () => {
    const response = await GET(makeRequest({ secret: null }));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 for a wrong secret", async () => {
    const response = await GET(makeRequest({ secret: "not-the-secret-at-all-no" }));
    expect(response.status).toBe(401);
  });

  it("returns 401 for the bare secret without the Bearer scheme", async () => {
    const response = await GET(makeRequest({ raw: TEST_SECRET }));
    expect(response.status).toBe(401);
  });

  it("returns 401 when CRON_SECRET is unset, even with a plausible header", async () => {
    // Fails closed: a deploy that forgets the variable gets a silent cron,
    // not an open public endpoint.
    delete process.env.CRON_SECRET;
    try {
      const response = await GET(makeRequest({ secret: TEST_SECRET }));
      expect(response.status).toBe(401);
    } finally {
      process.env.CRON_SECRET = TEST_SECRET;
    }
  });

  // -------------------------------------------------------------------------
  // Dry run
  // -------------------------------------------------------------------------

  it("runs the whole pipeline in dry-run mode without sending or deleting anything", async () => {
    const response = await GET(makeRequest({ secret: TEST_SECRET, dryRun: true }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(typeof body.ranAt).toBe("string");

    // Every report ran and produced a number, even though nothing was sent.
    expect(body.overdue).toMatchObject({
      outstandingLots: expect.any(Number),
      overdueLots: expect.any(Number),
      dueForNudge: expect.any(Number),
      membersNotified: expect.any(Number),
      membersUnreachable: expect.any(Number),
    });
    expect(body.lowStock).toMatchObject({
      total: expect.any(Number),
      newlyLow: expect.any(Number),
      alerted: false,
    });
    expect(body.negativeStock).toMatchObject({ total: expect.any(Number), alerted: false });
    expect(typeof body.digest.due).toBe("boolean");
    expect(body.digest.sent).toBe(false);

    // Nothing was purged, and the 120-day-old fixture is still there.
    expect(body.retention).toMatchObject({
      table: "telegram_bind_attempts",
      olderThanDays: 90,
      deleted: null,
    });
    const { data } = await db
      .from("telegram_bind_attempts")
      .select("id")
      .eq("id", purgeFixtureId)
      .maybeSingle();
    expect(data?.id).toBe(purgeFixtureId);
  });

  it("no-ops club-chat alerts gracefully when TELEGRAM_ALERT_CHAT_ID is unset", async () => {
    // The guard the rest of this file leans on. If this ever fails, the
    // real-run test below is no longer safe either.
    expect(process.env.TELEGRAM_ALERT_CHAT_ID ?? "").toBe("");

    const body = await (await GET(makeRequest({ secret: TEST_SECRET, dryRun: true }))).json();
    expect(body.alertChatConfigured).toBe(false);
    expect(body.lowStock.alerted).toBe(false);
    expect(body.negativeStock.alerted).toBe(false);
    expect(body.digest.sent).toBe(false);
  });

  it("defaults the overdue threshold to 21 days and honours the env override", async () => {
    const defaultBody = await (
      await GET(makeRequest({ secret: TEST_SECRET, dryRun: true }))
    ).json();
    expect(defaultBody.thresholdDays).toBe(21);
    expect(defaultBody.nudgeCadenceDays).toBe(7);

    const original = process.env.OVERDUE_THRESHOLD_DAYS;
    process.env.OVERDUE_THRESHOLD_DAYS = "7";
    try {
      const body = await (await GET(makeRequest({ secret: TEST_SECRET, dryRun: true }))).json();
      expect(body.thresholdDays).toBe(7);
    } finally {
      if (original === undefined) delete process.env.OVERDUE_THRESHOLD_DAYS;
      else process.env.OVERDUE_THRESHOLD_DAYS = original;
    }

    // A nonsense value falls back rather than throwing -- a typo'd env var
    // must never turn a cron run red.
    process.env.OVERDUE_THRESHOLD_DAYS = "not-a-number";
    try {
      const body = await (await GET(makeRequest({ secret: TEST_SECRET, dryRun: true }))).json();
      expect(body.thresholdDays).toBe(21);
    } finally {
      if (original === undefined) delete process.env.OVERDUE_THRESHOLD_DAYS;
      else process.env.OVERDUE_THRESHOLD_DAYS = original;
    }
  });

  // -------------------------------------------------------------------------
  // Real run (guarded)
  // -------------------------------------------------------------------------

  it("purges telegram_bind_attempts older than 90 days on a real run", async (ctx) => {
    if ((process.env.TELEGRAM_ALERT_CHAT_ID ?? "") !== "") {
      ctx.skip();
      return;
    }

    // Ask what a real run would send before letting it send anything.
    const plan = await (await GET(makeRequest({ secret: TEST_SECRET, dryRun: true }))).json();
    if (plan.overdue.membersNotified > 0) {
      // Somebody in the dev project is genuinely holding an overdue asset.
      // Running for real here would DM a real person about fixture data.
      ctx.skip();
      return;
    }

    const response = await GET(makeRequest({ secret: TEST_SECRET }));
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body.dryRun).toBe(false);
    expect(body.alertChatConfigured).toBe(false);
    expect(body.retention.deleted).toBeGreaterThanOrEqual(1);

    const { data } = await db
      .from("telegram_bind_attempts")
      .select("id")
      .eq("id", purgeFixtureId)
      .maybeSingle();
    expect(data).toBeNull();
  });

  it("leaves recent bind attempts alone", async () => {
    // The purge is a retention rule, not a truncate: the bind queue an admin
    // is currently working through must survive it. `recentBindAttempts` was
    // counted before any run in this file.
    expect(await countRecentBindAttempts()).toBe(recentBindAttempts);
  });
});
