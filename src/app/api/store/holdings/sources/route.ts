import { NextResponse } from "next/server";

import { getReturnSourceHolders } from "@/lib/server/holdings-sources";
import { requireMember } from "@/lib/server/member-auth";
import { getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/store/holdings/sources
 *
 * "Returning from where?" (docs/tele-qr/flows.md §3): the robots this member
 * has ever borrowed something to, plus their personal holder (always).
 */
export async function GET(request: Request) {
  const auth = await requireMember(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getServiceRoleClient();
  const holders = await getReturnSourceHolders(supabase, auth.member.id);

  return NextResponse.json({ holders });
}
