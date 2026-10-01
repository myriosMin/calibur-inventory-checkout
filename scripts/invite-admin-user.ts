import "./_env";

import {
  DEFAULT_INVITE_REDIRECT,
  STAFF_ROLES,
  inviteStaff,
  isStaffRole,
} from "@/lib/server/staff-invite";

// ---------------------------------------------------------------------------
// scripts/invite-admin-user.ts
//
// Onboards a staff account without the committee ever choosing or relaying a
// password: Supabase emails the person a link, and they set their own on
// /admin/login.
//
// The same thing is available in the UI (/admin/members -> a member's page ->
// "Send sign-in invite"); both call inviteStaff(). This script stays for
// bootstrapping -- when no admin exists yet, there is nobody who can sign in
// to click that button -- and for pointing a link somewhere other than
// production with --redirect-to.
//
// Run: npx tsx scripts/invite-admin-user.ts <email> <admin|procurement> ["Full Name"] [--redirect-to <url>]
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`invite-admin-user: ${message}`);
  process.exit(1);
}

async function main() {
  const argv = process.argv.slice(2);

  const redirectFlag = argv.indexOf("--redirect-to");
  let redirectTo = DEFAULT_INVITE_REDIRECT;
  if (redirectFlag !== -1) {
    const value = argv[redirectFlag + 1];
    if (!value) fail("--redirect-to needs a URL.");
    redirectTo = value;
    argv.splice(redirectFlag, 2);
  }

  const [email, role, ...nameParts] = argv;

  if (!email || !role) {
    fail(
      'Usage: npx tsx scripts/invite-admin-user.ts <email> <admin|procurement> ["Full Name"] [--redirect-to <url>]\n' +
        "  <email>         becomes BOTH the Supabase Auth login and members.nus_email.\n" +
        "  <role>          required and explicit, so dashboard access is never granted by accident.\n" +
        '  "Full Name"     optional; defaults to the local part of the email.\n' +
        "  --redirect-to   where the email link lands. Defaults to production;\n" +
        "                  pass http://localhost:3000/admin/login to test locally.",
    );
  }

  if (!isStaffRole(role)) {
    fail(`<role> must be one of: ${STAFF_ROLES.join(", ")}. Got "${role}".`);
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check .env.local.");
  }

  const result = await inviteStaff({
    email,
    role,
    fullName: nameParts.join(" "),
    redirectTo,
  });

  console.log(`members row for ${result.memberName} is an active ${role}.`);
  console.log(
    result.outcome === "invited"
      ? `Invite email sent to ${result.email}.`
      : `${result.email} already had an auth user — sent a password-reset email instead.`,
  );
  console.log(`\nLink lands on: ${result.redirectTo}`);
  console.log(
    "It is single-use and expires in 1 hour. Re-run this command to send another " +
      "(the shared Supabase mailer is rate-limited to a couple of emails per hour).",
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
