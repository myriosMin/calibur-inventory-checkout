import "./_env";

import { createClient } from "@supabase/supabase-js";

import { dbSchemaOption } from "@/lib/supabase/schema";
import { getServiceRoleClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// scripts/invite-admin-user.ts
//
// Onboards a staff account WITHOUT the committee ever choosing or relaying a
// password: Supabase emails the person a link, and they set their own on
// /admin/login (which branches into a set-password form when it lands with an
// invite fragment).
//
// Same two halves, and the same trap, as bootstrap-admin.ts: is_admin() /
// is_staff() join `members.nus_email = auth.email()` with a plain `=`, so an
// auth user with no matching members row signs in successfully and then sees
// an empty dashboard, which looks exactly like "the app is broken". This
// script therefore always writes the members row, not just the invite.
//
// Idempotent. If the auth user already exists (a re-run, or an invite that
// expired -- the links are single-use and last otp_expiry, 1 hour), it sends
// a password-reset email instead, which lands on the same form.
//
// Run: npx tsx scripts/invite-admin-user.ts <email> <admin|procurement> ["Full Name"] [--redirect-to <url>]
// ---------------------------------------------------------------------------

const STAFF_ROLES = ["admin", "procurement"] as const;
type StaffRole = (typeof STAFF_ROLES)[number];

const DEFAULT_REDIRECT = "https://calibur-checkout.vercel.app/admin/login";

function fail(message: string): never {
  console.error(`invite-admin-user: ${message}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) fail(`Missing ${name}. Check .env.local (see .env.local.example).`);
  return value;
}

/** `auth.admin` has no get-by-email; listUsers is paginated. Same walk as bootstrap-admin.ts. */
async function findAuthUserByEmail(
  admin: ReturnType<typeof getServiceRoleClient>,
  email: string,
): Promise<{ id: string } | null> {
  const perPage = 1000;
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) fail(`Failed to list auth users: ${error.message}`);
    const match = data.users.find((u) => u.email?.toLowerCase() === email);
    if (match) return match;
    if (data.users.length < perPage) return null;
  }
  return null;
}

async function main() {
  const argv = process.argv.slice(2);

  const redirectFlag = argv.indexOf("--redirect-to");
  let redirectTo = DEFAULT_REDIRECT;
  if (redirectFlag !== -1) {
    const value = argv[redirectFlag + 1];
    if (!value) fail("--redirect-to needs a URL.");
    redirectTo = value;
    argv.splice(redirectFlag, 2);
  }

  const [rawEmail, rawRole, ...nameParts] = argv;

  if (!rawEmail || !rawRole) {
    fail(
      'Usage: npx tsx scripts/invite-admin-user.ts <email> <admin|procurement> ["Full Name"] [--redirect-to <url>]\n' +
        "  <email>         becomes BOTH the Supabase Auth login and members.nus_email.\n" +
        "  <role>          required and explicit, so dashboard access is never granted by accident.\n" +
        '  "Full Name"     optional; defaults to the local part of the email.\n' +
        "  --redirect-to   where the email link lands. Defaults to production;\n" +
        "                  pass http://localhost:3000/admin/login to test locally.",
    );
  }

  if (!(STAFF_ROLES as readonly string[]).includes(rawRole)) {
    fail(`<role> must be one of: ${STAFF_ROLES.join(", ")}. Got "${rawRole}".`);
  }
  const role = rawRole as StaffRole;

  // Supabase Auth lowercases emails, and is_admin()/is_staff() compare with a
  // plain `=`. Lowercasing both sides is what removes the likeliest mistake.
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(`"${rawEmail}" does not look like an email address.`);
  }

  const fullName = nameParts.join(" ").trim() || email.split("@")[0];

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const admin = getServiceRoleClient();

  // ---------------------------------------------------------------------
  // Half 1: the members row.
  // ---------------------------------------------------------------------
  const { data: existingMember, error: lookupError } = await admin
    .from("members")
    .select("id, full_name, role, active")
    .eq("nus_email", email)
    .maybeSingle();
  if (lookupError) fail(`Failed to look up members row: ${lookupError.message}`);

  if (existingMember) {
    const { data: updated, error: updateError } = await admin
      .from("members")
      .update({ role, active: true, left_at: null })
      .eq("id", existingMember.id)
      .select("full_name")
      .single();
    if (updateError) fail(`Failed to update members row: ${updateError.message}`);
    console.log(`members row for ${updated.full_name} set to an active ${role}.`);
  } else {
    // The insert also fires create_member_holder, so they get a holder row.
    const { data: created, error: insertError } = await admin
      .from("members")
      .insert({ full_name: fullName, nus_email: email, role, active: true })
      .select("full_name")
      .single();
    if (insertError) fail(`Failed to create members row: ${insertError.message}`);
    console.log(`Created members row for ${created.full_name} as ${role}.`);
  }

  // ---------------------------------------------------------------------
  // Half 2: the email.
  // ---------------------------------------------------------------------
  const existingAuthUser = await findAuthUserByEmail(admin, email);

  if (!existingAuthUser) {
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo });
    if (error || !data.user) {
      fail(`Failed to send invite: ${error?.message ?? "unknown error"}`);
    }
    console.log(`Invite email sent to ${data.user.email}.`);
  } else {
    // Already has an auth user, so inviteUserByEmail would refuse. A reset
    // email reaches the same set-password form (type=recovery).
    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      db: dbSchemaOption(),
    });
    const { error } = await anon.auth.resetPasswordForEmail(email, { redirectTo });
    if (error) fail(`Failed to send password-reset email: ${error.message}`);
    console.log(`${email} already had an auth user — sent a password-reset email instead.`);
  }

  console.log(`\nLink lands on: ${redirectTo}`);
  console.log(
    "It is single-use and expires in 1 hour. Re-run this command to send another " +
      "(the shared Supabase mailer is rate-limited to a couple of emails per hour).",
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
