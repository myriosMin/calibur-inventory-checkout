import { NextResponse } from "next/server";

import { getMemberHistory } from "@/lib/server/member-activity";
import { requireMember } from "@/lib/server/member-auth";
import { getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

/**
 * GET /api/store/me/history?limit=<1..50>
 *
 * This member's own recent borrow/return activity -- docs/tele-qr/pdpa.md:
 * "A member can see their own history in the Mini App and ask an admin to
 * correct an error."
 *
 * Scoped by the member id resolved from HMAC-verified initData, never by
 * anything the client supplies. `limit` is clamped rather than rejected: a
 * silly value is a client bug, not an attack, and a 400 here would be a
 * worse experience than quietly showing a sane page.
 */
export async function GET(request: Request) {
  const auth = await requireMember(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const rawLimit = new URL(request.url).searchParams.get("limit");
  const parsedLimit = rawLimit === null ? DEFAULT_LIMIT : Number.parseInt(rawLimit, 10);
  const limit = Number.isFinite(parsedLimit)
    ? Math.min(Math.max(parsedLimit, 1), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const supabase = getServiceRoleClient();
  const events = await getMemberHistory(supabase, auth.member.id, limit);

  return NextResponse.json({ events });
}
