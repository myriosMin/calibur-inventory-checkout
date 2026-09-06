import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/database";

export type HolderSummary = {
  id: string;
  name: string;
  kind: string;
};

/**
 * The set of holders a member may pick as a *return source* (docs/tele-qr/flows.md
 * §3): every active `robot` holder they have ever borrowed something to, plus
 * their own personal (`kind='member'`) holder, always. Shared by
 * `/api/store/holdings/sources` (which returns this list directly) and
 * `/api/store/holdings` (which uses it as the allow-list for the `holderId`
 * a caller may query -- see that route for the 403 defense).
 */
export async function getReturnSourceHolders(
  supabase: SupabaseClient<Database>,
  memberId: string,
): Promise<HolderSummary[]> {
  const { data: movementRows, error: movementError } = await supabase
    .from("stock_movements")
    .select("to_holder_id")
    .eq("actor_member_id", memberId);
  if (movementError) throw movementError;

  const candidateHolderIds = [
    ...new Set((movementRows ?? []).map((row) => row.to_holder_id)),
  ];

  let robotHolders: HolderSummary[] = [];
  if (candidateHolderIds.length > 0) {
    const { data: holders, error: holdersError } = await supabase
      .from("holders")
      .select("id, name, kind")
      .in("id", candidateHolderIds)
      .eq("kind", "robot")
      .eq("active", true);
    if (holdersError) throw holdersError;
    robotHolders = holders ?? [];
  }

  const { data: personalHolder, error: personalError } = await supabase
    .from("holders")
    .select("id, name, kind")
    .eq("member_id", memberId)
    .eq("kind", "member")
    .maybeSingle();
  if (personalError) throw personalError;

  // De-duplicate defensively (kind differs between the two categories in
  // practice, so this should never collapse anything real).
  const byId = new Map<string, HolderSummary>();
  for (const holder of robotHolders) byId.set(holder.id, holder);
  if (personalHolder) byId.set(personalHolder.id, personalHolder);

  return [...byId.values()];
}

/**
 * The set of holders a member may pick as a *borrow destination*
 * (docs/tele-qr/flows.md §2: "Where is this going?" [Hero] [Standard]
 * [Sentry] ... [Personal/bench]): every active `robot` holder, full stop,
 * plus the member's own personal holder. Deliberately NOT filtered by prior
 * borrow history -- unlike `getReturnSourceHolders` (where "never borrowed
 * to this robot" correctly means "nothing to return from there"), a member
 * must be able to choose ANY robot as a borrow destination the very first
 * time, including one they've never used before. Reusing the return-source
 * list here would mean a fresh member could never borrow to a robot for the
 * first time, since that robot would never appear until after a borrow
 * already happened -- so this is a separate query, not a filter on the one
 * above.
 */
export async function getBorrowDestinationHolders(
  supabase: SupabaseClient<Database>,
  memberId: string,
): Promise<HolderSummary[]> {
  const { data: robotHolders, error: robotsError } = await supabase
    .from("holders")
    .select("id, name, kind")
    .eq("kind", "robot")
    .eq("active", true)
    .order("name");
  if (robotsError) throw robotsError;

  const { data: personalHolder, error: personalError } = await supabase
    .from("holders")
    .select("id, name, kind")
    .eq("member_id", memberId)
    .eq("kind", "member")
    .maybeSingle();
  if (personalError) throw personalError;

  const holders: HolderSummary[] = [...(robotHolders ?? [])];
  if (personalHolder) holders.push(personalHolder);

  return holders;
}
