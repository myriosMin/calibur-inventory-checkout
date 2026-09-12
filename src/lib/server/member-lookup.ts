import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/database";

export type MemberIdentity = Pick<
  Database["public"]["Tables"]["members"]["Row"],
  "id" | "full_name" | "display_name" | "active"
>;

/**
 * Resolve a Telegram user id to a members row.
 *
 * The bot webhook's counterpart to `requireMember()`
 * (src/lib/server/member-auth.ts): `requireMember` is initData-only and takes
 * a `Request`, so it cannot be used from `/api/tg/webhook`, where identity
 * arrives as `message.from.id` on an update whose authenticity is already
 * established by the shared webhook secret. Both `/start` (the "already
 * bound, welcome back" branch) and `/myitems` need this same lookup, so it
 * lives here rather than being inlined twice in the route.
 *
 * Returns `null` when no member is bound to that Telegram id. Throws on a
 * genuine query failure so callers can tell "unknown user" apart from
 * "database is down" -- the webhook treats the latter as "ack and stay
 * silent" rather than telling a real member they're not recognised.
 */
export async function findMemberByTelegramUserId(
  supabase: SupabaseClient<Database>,
  telegramUserId: number,
): Promise<MemberIdentity | null> {
  const { data, error } = await supabase
    .from("members")
    .select("id, full_name, display_name, active")
    .eq("telegram_user_id", telegramUserId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

/** The name to greet a member by: their preferred display name, else their
 * full name. Mirrors the `display_name ?? full_name` fallback used across
 * the admin dashboard. */
export function memberDisplayName(member: Pick<MemberIdentity, "full_name" | "display_name">): string {
  return member.display_name ?? member.full_name;
}
