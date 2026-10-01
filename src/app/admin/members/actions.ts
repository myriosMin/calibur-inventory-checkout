"use server";

import { inviteStaff, isStaffRole, type InviteOutcome } from "@/lib/server/staff-invite";
import { getServerActionClient } from "@/lib/supabase/server-action";

/**
 * The one place in /admin where RLS is NOT the authorisation boundary.
 *
 * Everywhere else, admin pages talk to Postgres straight from the browser and
 * RLS decides what is allowed. Sending an invite isn't a database write
 * though -- it's Supabase's Auth admin API, which needs the service-role key,
 * which bypasses RLS entirely and must never reach a browser. So this runs
 * server-side and has to check the caller itself. Rendering the button behind
 * an admin page proves nothing: a Server Action is a callable endpoint, and
 * requests can skip the UI (next/dist/docs: "render-time gating ... is not a
 * security boundary").
 *
 * The check mirrors is_admin() (0009/0012) exactly -- own row, role 'admin',
 * active -- but evaluates it through RLS's `members_select_self` policy
 * (0024) using the caller's own session rather than trusting anything from
 * the client. is_admin() itself can't be called here: it is revoked from
 * public and anon and never granted to `authenticated` (0013, 0014).
 */

export type SendStaffInviteResult =
  | { ok: true; outcome: InviteOutcome; email: string; memberName: string }
  | { ok: false; error: string };

export async function sendStaffInvite(input: {
  email: string;
  role: string;
  fullName?: string;
}): Promise<SendStaffInviteResult> {
  if (!isStaffRole(input.role)) {
    return { ok: false, error: "Only admin and procurement accounts can be invited." };
  }

  const supabase = await getServerActionClient();

  // getUser() verifies the token against the Auth server rather than trusting
  // the cookie's contents.
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user?.email) {
    return { ok: false, error: "You are not signed in." };
  }

  const { data: caller, error: callerError } = await supabase
    .from("members")
    .select("role, active")
    .eq("nus_email", user.email)
    .maybeSingle();
  if (callerError) {
    return { ok: false, error: `Couldn't verify your account: ${callerError.message}` };
  }
  if (!caller || caller.role !== "admin" || !caller.active) {
    return { ok: false, error: "Only an active admin can send invites." };
  }

  try {
    const result = await inviteStaff({
      email: input.email,
      role: input.role,
      fullName: input.fullName,
    });
    // Deliberately narrow: action return values are serialised to the client,
    // so this returns what the UI shows and nothing else.
    return {
      ok: true,
      outcome: result.outcome,
      email: result.email,
      memberName: result.memberName,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
