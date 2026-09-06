import { NextResponse } from "next/server";

import { getBorrowDestinationHolders } from "@/lib/server/holdings-sources";
import { requireMember } from "@/lib/server/member-auth";
import { getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/store/destinations
 *
 * The borrow flow's "Where is this going?" picker (docs/tele-qr/flows.md
 * §2): every active robot holder, plus the member's own personal holder.
 *
 * This is intentionally a separate endpoint from /api/store/holdings/sources
 * (which lists *return* sources -- robots the member has already borrowed
 * to). A destination picker must offer every robot, including ones this
 * member has never used before; filtering by prior history here would make
 * it impossible to ever borrow to a robot for the first time.
 */
export async function GET(request: Request) {
  const auth = await requireMember(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getServiceRoleClient();
  const holders = await getBorrowDestinationHolders(supabase, auth.member.id);

  return NextResponse.json({ holders });
}
