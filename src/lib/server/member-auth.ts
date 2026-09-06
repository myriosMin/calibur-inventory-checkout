import { validateInitData } from "@/lib/telegram/init-data";
import { getServiceRoleClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

export type Member = Database["public"]["Tables"]["members"]["Row"];

export type MemberAuthResult =
  | { ok: true; member: Member; telegramUserId: number }
  | {
      ok: false;
      status: 401 | 403;
      error:
        | "missing_init_data"
        | "bad_signature"
        | "expired"
        | "malformed"
        | "not_registered"
        | "inactive";
    };

const INIT_DATA_HEADER = "X-Telegram-Init-Data";

/**
 * Every /api/store/* route's sole auth mechanism. Reads the raw initData
 * string from the X-Telegram-Init-Data header, validates its HMAC signature
 * server-side (never trusting client-supplied identity), and resolves it to
 * an active, bound member row. See docs/tele-qr/architecture.md.
 */
export async function requireMember(request: Request): Promise<MemberAuthResult> {
  const raw = request.headers.get(INIT_DATA_HEADER);
  if (!raw) {
    return { ok: false, status: 401, error: "missing_init_data" };
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    throw new Error("Missing TELEGRAM_BOT_TOKEN. Check .env.local.");
  }

  const result = validateInitData(raw, botToken);
  if (!result.ok) {
    if (result.reason === "missing") {
      return { ok: false, status: 401, error: "missing_init_data" };
    }
    return { ok: false, status: 401, error: result.reason };
  }

  const telegramUserId = result.data.user.id;
  const supabase = getServiceRoleClient();
  const { data: member, error } = await supabase
    .from("members")
    .select("*")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!member) {
    return { ok: false, status: 403, error: "not_registered" };
  }

  if (!member.active) {
    return { ok: false, status: 403, error: "inactive" };
  }

  return { ok: true, member, telegramUserId };
}
