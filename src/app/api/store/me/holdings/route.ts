import { NextResponse } from "next/server";

import { getMemberHoldings } from "@/lib/server/member-activity";
import { requireMember } from "@/lib/server/member-auth";
import { getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/store/me/holdings
 *
 * "My items" (docs/tele-qr/architecture.md's /store surface; the access half
 * of docs/tele-qr/pdpa.md's access-and-correction obligation): everything
 * this member currently holds, across every holder they hold from, grouped
 * by holder.
 *
 * Unlike /api/store/holdings this takes NO holderId -- the client must not
 * have to enumerate holders to see its own stuff, and with no caller-supplied
 * id there is nothing to authorize beyond "who is calling". Every query is
 * scoped by the member id `requireMember` resolved from the HMAC-verified
 * initData, so a member can only ever see their own data.
 */
export async function GET(request: Request) {
  const auth = await requireMember(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = getServiceRoleClient();
  const holders = await getMemberHoldings(supabase, auth.member.id);

  return NextResponse.json({ holders });
}
