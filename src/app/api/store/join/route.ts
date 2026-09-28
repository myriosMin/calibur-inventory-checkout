import { NextResponse } from "next/server";

import {
  isJoinOutcome,
  joinOutcomeMessage,
  joinOutcomeStatus,
  validateJoinRequest,
} from "@/lib/join/request";
import { getServiceRoleClient } from "@/lib/supabase/server";
import { validateInitData } from "@/lib/telegram/init-data";
import type { ValidatedInitData } from "@/lib/telegram/types";

export const runtime = "nodejs";

const INIT_DATA_HEADER = "X-Telegram-Init-Data";

/**
 * The one /api/store/* route that does NOT go through requireMember(): its
 * caller is, by definition, not a member yet. Identity still comes only from
 * the HMAC-verified initData -- never from the body.
 */
function verifyTelegramUser(
  request: Request,
): { ok: true; data: ValidatedInitData } | { ok: false; response: Response } {
  const raw = request.headers.get(INIT_DATA_HEADER);
  if (!raw) {
    return { ok: false, response: NextResponse.json({ error: "missing_init_data" }, { status: 401 }) };
  }
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) throw new Error("Missing TELEGRAM_BOT_TOKEN. Check .env.local.");

  const result = validateInitData(raw, botToken);
  if (!result.ok) {
    const error = result.reason === "missing" ? "missing_init_data" : result.reason;
    return { ok: false, response: NextResponse.json({ error }, { status: 401 }) };
  }
  return { ok: true, data: result.data };
}

/** Is this Telegram account a member yet? Lets the Mini App decide to show the join form. */
export async function GET(request: Request) {
  const verified = verifyTelegramUser(request);
  if (!verified.ok) return verified.response;

  const db = getServiceRoleClient();
  const { data: member, error } = await db
    .from("members")
    .select("active")
    .eq("telegram_user_id", verified.data.user.id)
    .maybeSingle();
  if (error) throw error;

  const status = !member ? "not_registered" : member.active ? "member" : "inactive";
  return NextResponse.json({ status });
}

export async function POST(request: Request) {
  const verified = verifyTelegramUser(request);
  if (!verified.ok) return verified.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const validation = validateJoinRequest(raw);
  if (!validation.ok) {
    return NextResponse.json({ error: "invalid_body", fields: validation.errors }, { status: 400 });
  }

  const { user } = verified.data;
  const { body } = validation;
  const db = getServiceRoleClient();

  const { data, error } = await db.rpc("join_with_code", {
    p_code: body.code,
    p_telegram_user_id: user.id,
    p_telegram_username: user.username ?? "",
    p_full_name: body.fullName,
    p_display_name: body.displayName ?? "",
    p_email: body.email,
  });
  if (error) throw error;

  const result = (data ?? {}) as { outcome?: unknown };
  if (!isJoinOutcome(result.outcome)) {
    throw new Error(`join_with_code returned an unexpected outcome: ${String(result.outcome)}`);
  }
  const outcome = result.outcome;

  // The message for this outcome says "ask a committee member to check the
  // bind queue", so put them in it. Awaited: a Vercel function can be frozen
  // the moment the response is returned.
  if (outcome === "needs_committee") {
    await queueForCommittee(db, user.id, user.username ?? null, body.fullName);
  }

  return NextResponse.json(
    { outcome, message: joinOutcomeMessage(outcome) },
    { status: joinOutcomeStatus(outcome) },
  );
}

async function queueForCommittee(
  db: ReturnType<typeof getServiceRoleClient>,
  telegramUserId: number,
  username: string | null,
  fullName: string,
): Promise<void> {
  try {
    const { data: open } = await db
      .from("telegram_bind_attempts")
      .select("id")
      .eq("telegram_user_id", telegramUserId)
      .is("resolved_member", null)
      .limit(1);
    if (open && open.length > 0) return;

    const { error } = await db.from("telegram_bind_attempts").insert({
      telegram_user_id: telegramUserId,
      username,
      display_name: fullName,
    });
    if (error) throw error;
  } catch (error) {
    // The person already has their answer; a missed queue row must not
    // turn it into a 500.
    console.error("[/api/store/join] Failed to queue bind attempt:", error);
  }
}
