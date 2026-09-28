import "../../scripts/_env";
import "./_schema-guard";

import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET as joinGET, POST as joinPOST } from "@/app/api/store/join/route";
import { generateJoinCode } from "@/lib/join/code";
import { getServiceRoleClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// tests/integration/join.test.ts
//
// Self-service onboarding (0026_join_codes.sql + /api/store/join) against the
// live `test` schema. Everything is created per run with ids from the
// 900000000000+ range scripts/seed-test-schema.ts reserves, and removed in
// afterAll.
// ---------------------------------------------------------------------------

const RUN_NONCE = Date.now() % 1_000_000;
const tgId = (n: number) => 900_500_000_000 + RUN_NONCE * 10 + n;
const USERS = {
  newcomer: tgId(1),
  sameEmail: tgId(2),
  rosterMatch: tgId(3),
  late: tgId(4),
  staffEmail: tgId(5),
  guesser: tgId(6),
  expired: tgId(7),
};
const ALL_IDS = Object.values(USERS);
const email = (label: string) => `join.${label}.${RUN_NONCE}@example.invalid`;
const JOIN_URL = "http://localhost/api/store/join";

function buildInitData(telegramUserId: number, username?: string): string {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("Missing TELEGRAM_BOT_TOKEN. Check .env.local.");
  const fields: Record<string, string> = {
    query_id: "test",
    user: JSON.stringify({ id: telegramUserId, ...(username ? { username } : {}) }),
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

function join(telegramUserId: number, body: Record<string, unknown>, username?: string) {
  return joinPOST(
    new Request(JOIN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": buildInitData(telegramUserId, username),
      },
      body: JSON.stringify({ acceptedNotice: true, ...body }),
    }),
  );
}

async function status(telegramUserId: number): Promise<string> {
  const res = await joinGET(
    new Request(JOIN_URL, { headers: { "X-Telegram-Init-Data": buildInitData(telegramUserId) } }),
  );
  expect(res.status).toBe(200);
  return ((await res.json()) as { status: string }).status;
}

const db = getServiceRoleClient();

async function createCode(maxUses: number): Promise<{ id: string; code: string }> {
  const code = generateJoinCode();
  const { data, error } = await db
    .from("join_codes")
    .insert({
      code,
      max_uses: maxUses,
      valid_minutes: 5,
      note: `join.test ${RUN_NONCE}`,
      expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    })
    .select("id, code")
    .single();
  if (error) throw error;
  return data;
}

describe("join codes (live DB)", () => {
  let code: { id: string; code: string };
  let rosterMemberId: string;
  let staffMemberId: string;
  const codeIds: string[] = [];
  const extraMemberIds: string[] = [];

  beforeAll(async () => {
    code = await createCode(2);
    codeIds.push(code.id);

    const { data: roster, error: rosterError } = await db
      .from("members")
      .insert({ full_name: `Roster Person ${RUN_NONCE}`, nus_email: email("roster"), role: "member" })
      .select("id")
      .single();
    if (rosterError) throw rosterError;
    rosterMemberId = roster.id;

    const { data: staff, error: staffError } = await db
      .from("members")
      .insert({ full_name: `Staff Person ${RUN_NONCE}`, nus_email: email("staff"), role: "procurement" })
      .select("id")
      .single();
    if (staffError) throw staffError;
    staffMemberId = staff.id;
    extraMemberIds.push(rosterMemberId, staffMemberId);
  });

  afterAll(async () => {
    await db.from("join_code_attempts").delete().in("telegram_user_id", ALL_IDS);
    await db.from("telegram_bind_attempts").delete().in("telegram_user_id", ALL_IDS);

    const { data: joined } = await db.from("members").select("id").in("telegram_user_id", ALL_IDS);
    const memberIds = [...new Set([...extraMemberIds, ...(joined ?? []).map((m) => m.id)])];
    await db.from("holders").delete().in("member_id", memberIds);
    await db.from("members").delete().in("id", memberIds);
    await db.from("join_codes").delete().in("id", codeIds);

    const { data: leftovers } = await db.from("members").select("id").in("id", memberIds);
    expect(leftovers ?? []).toHaveLength(0);
  });

  it("refuses a request without signed initData", async () => {
    const res = await joinPOST(new Request(JOIN_URL, { method: "POST", body: "{}" }));
    expect(res.status).toBe(401);
  });

  it("rejects an invalid form without touching the code", async () => {
    const res = await join(USERS.newcomer, { code: code.code, fullName: "", email: "nope" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fields: Record<string, string> };
    expect(Object.keys(body.fields).sort()).toEqual(["email", "fullName"]);
  });

  it("creates a new member from a valid code", async () => {
    expect(await status(USERS.newcomer)).toBe("not_registered");

    const res = await join(
      USERS.newcomer,
      { code: code.code.toLowerCase(), fullName: "Join Newcomer", email: email("new").toUpperCase() },
      `JoinNew${RUN_NONCE}`,
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe("created");
    expect(await status(USERS.newcomer)).toBe("member");

    const { data: member } = await db
      .from("members")
      .select("id, full_name, nus_email, telegram_username, role, notice_accepted_at, join_code_id")
      .eq("telegram_user_id", USERS.newcomer)
      .single();
    expect(member).toMatchObject({
      full_name: "Join Newcomer",
      nus_email: email("new"),
      telegram_username: `joinnew${RUN_NONCE}`,
      role: "member",
      join_code_id: code.id,
    });
    expect(member?.notice_accepted_at).not.toBeNull();

    // The create_member_holder trigger gives them somewhere to borrow to.
    const { data: holder } = await db.from("holders").select("id").eq("member_id", member!.id);
    expect(holder).toHaveLength(1);
  });

  it("answers a second join by the same person without using up the code", async () => {
    const res = await join(USERS.newcomer, { code: code.code, fullName: "Join Newcomer", email: email("new") });
    expect(((await res.json()) as { outcome: string }).outcome).toBe("already_member");

    const { data } = await db.from("join_codes").select("used_count").eq("id", code.id).single();
    expect(data?.used_count).toBe(1);
  });

  it("refuses an email that is already linked to another Telegram account", async () => {
    const res = await join(USERS.sameEmail, { code: code.code, fullName: "Someone Else", email: email("new") });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { outcome: string }).outcome).toBe("email_taken");
  });

  it("links to an unbound roster row by email instead of creating a duplicate", async () => {
    const res = await join(USERS.rosterMatch, {
      code: code.code,
      fullName: "A Different Spelling",
      email: email("roster").toUpperCase(),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { outcome: string }).outcome).toBe("linked");

    const { data: roster } = await db
      .from("members")
      .select("telegram_user_id, full_name, notice_accepted_at")
      .eq("id", rosterMemberId)
      .single();
    expect(roster?.telegram_user_id).toBe(USERS.rosterMatch);
    // The roster's own record wins over what was typed.
    expect(roster?.full_name).toBe(`Roster Person ${RUN_NONCE}`);
    expect(roster?.notice_accepted_at).not.toBeNull();
  });

  it("stops at the use limit and logs the latecomer", async () => {
    const res = await join(USERS.late, { code: code.code, fullName: "Too Late", email: email("late") });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { outcome: string }).outcome).toBe("exhausted");

    const { data: attempts } = await db
      .from("join_code_attempts")
      .select("outcome")
      .eq("join_code_id", code.id)
      .order("id");
    expect((attempts ?? []).map((a) => a.outcome)).toEqual([
      "created",
      "email_taken",
      "linked",
      "exhausted",
    ]);
  });

  it("refuses an expired code", async () => {
    const short = await createCode(5);
    codeIds.push(short.id);
    await db.from("join_codes").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("id", short.id);

    const res = await join(USERS.expired, { code: short.code, fullName: "Expired", email: email("expired") });
    expect(((await res.json()) as { outcome: string }).outcome).toBe("expired");
  });

  it("never links a staff row by typed email, and queues it for the committee", async () => {
    const fresh = await createCode(5);
    codeIds.push(fresh.id);

    const res = await join(USERS.staffEmail, { code: fresh.code, fullName: "Claims Staff", email: email("staff") });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { outcome: string }).outcome).toBe("needs_committee");

    const { data: staff } = await db.from("members").select("telegram_user_id").eq("id", staffMemberId).single();
    expect(staff?.telegram_user_id).toBeNull();

    const { data: queued } = await db
      .from("telegram_bind_attempts")
      .select("display_name")
      .eq("telegram_user_id", USERS.staffEmail)
      .is("resolved_member", null);
    expect(queued).toEqual([{ display_name: "Claims Staff" }]);
  });

  it("rate-limits repeated wrong codes from one account", async () => {
    const wrong = { fullName: "Guesser", email: email("guess") };
    for (let i = 0; i < 5; i++) {
      const res = await join(USERS.guesser, { ...wrong, code: generateJoinCode() });
      expect(((await res.json()) as { outcome: string }).outcome).toBe("unknown_code");
    }
    const res = await join(USERS.guesser, { ...wrong, code: generateJoinCode() });
    expect(res.status).toBe(429);
  });
});
