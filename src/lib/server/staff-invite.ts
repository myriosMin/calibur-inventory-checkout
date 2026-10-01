import { createClient } from "@supabase/supabase-js";

import { dbSchemaOption } from "@/lib/supabase/schema";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Provisioning a staff account, shared by `scripts/invite-admin-user.ts` and
 * the `/admin/members` server action so the two cannot drift.
 *
 * Staff need two things that must match exactly: a `members` row carrying the
 * role, and a Supabase Auth user whose email equals `members.nus_email`.
 * is_admin()/is_staff() compare them with a plain `=`, so a one-character
 * mismatch produces a dashboard that signs in and then shows nothing but
 * empty tables -- indistinguishable from a broken app. Both halves therefore
 * always happen together, here.
 *
 * Service-role only (it writes members and calls the Auth admin API), so
 * every caller is responsible for authorising first. The server action does
 * that explicitly because RLS cannot: the service role bypasses it.
 */

export const STAFF_ROLES = ["admin", "procurement"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Where the emailed link lands. It must be a path that handles the auth
 * fragment, and it must be on Supabase's redirect allow-list
 * (`additional_redirect_urls` in supabase/config.toml) or Supabase silently
 * falls back to `site_url`.
 */
export const DEFAULT_INVITE_REDIRECT = "https://calibur-checkout.vercel.app/admin/login";

export type InviteOutcome =
  /** No auth user existed: a fresh invite email. */
  | "invited"
  /** One already did, so inviteUserByEmail would refuse: a reset email, which reaches the same form. */
  | "reset_sent";

export interface InviteStaffResult {
  outcome: InviteOutcome;
  email: string;
  memberName: string;
  redirectTo: string;
}

export function isStaffRole(value: unknown): value is StaffRole {
  return typeof value === "string" && (STAFF_ROLES as readonly string[]).includes(value);
}

/** Deliberately loose: catches "not an email", not "not a real mailbox". */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** `auth.admin` has no get-by-email, and listUsers is paginated. */
async function findAuthUserByEmail(
  admin: ReturnType<typeof getServiceRoleClient>,
  email: string,
): Promise<boolean> {
  const perPage = 1000;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Failed to list auth users: ${error.message}`);
    if (data.users.some((u) => u.email?.toLowerCase() === email)) return true;
    if (data.users.length < perPage) return false;
  }
  return false;
}

export async function inviteStaff(input: {
  email: string;
  role: StaffRole;
  fullName?: string;
  redirectTo?: string;
}): Promise<InviteStaffResult> {
  // Supabase Auth lowercases emails and is_admin() compares with `=`, so
  // lowercasing here removes the likeliest way to get this wrong.
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    throw new Error(`"${input.email}" does not look like an email address.`);
  }
  if (!isStaffRole(input.role)) {
    throw new Error(`Role must be one of: ${STAFF_ROLES.join(", ")}.`);
  }

  const redirectTo = input.redirectTo ?? DEFAULT_INVITE_REDIRECT;
  const fullName = input.fullName?.trim() || email.split("@")[0];

  const admin = getServiceRoleClient();

  // --- Half 1: the members row --------------------------------------------
  const { data: existing, error: lookupError } = await admin
    .from("members")
    .select("id, full_name")
    .eq("nus_email", email)
    .maybeSingle();
  if (lookupError) throw new Error(`Failed to look up members row: ${lookupError.message}`);

  let memberName: string;
  if (existing) {
    // Promote/reactivate rather than skip: the usual repair cases are "the row
    // exists but the role is wrong" and "was offboarded and is coming back".
    const { data: updated, error: updateError } = await admin
      .from("members")
      .update({ role: input.role, active: true, left_at: null })
      .eq("id", existing.id)
      .select("full_name")
      .single();
    if (updateError) throw new Error(`Failed to update members row: ${updateError.message}`);
    memberName = updated.full_name;
  } else {
    // The insert also fires create_member_holder, so they get a holder row.
    const { data: created, error: insertError } = await admin
      .from("members")
      .insert({ full_name: fullName, nus_email: email, role: input.role, active: true })
      .select("full_name")
      .single();
    if (insertError) throw new Error(`Failed to create members row: ${insertError.message}`);
    memberName = created.full_name;
  }

  // --- Half 2: the email ---------------------------------------------------
  if (await findAuthUserByEmail(admin, email)) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
    }
    const anon = createClient(url, anonKey, {
      auth: { persistSession: false },
      db: dbSchemaOption(),
    });
    const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) throw new Error(`Failed to send password-reset email: ${error.message}`);
    return { outcome: "reset_sent", email, memberName, redirectTo };
  }

  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
  if (error) throw new Error(`Failed to send invite: ${error.message}`);
  return { outcome: "invited", email, memberName, redirectTo };
}
