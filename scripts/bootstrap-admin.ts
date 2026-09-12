import "./_env";

import { createClient } from "@supabase/supabase-js";

import { getServiceRoleClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

// ---------------------------------------------------------------------------
// scripts/bootstrap-admin.ts
//
// One idempotent command for the chicken-and-egg documented in
// docs/tele-qr/checkpoint.md ("Known gaps" #1): the very first admin can't be
// created through /admin/members, because reaching that page already requires
// being an admin. Until now the escape hatch was two manual halves --
//
//   1. a `members` row with role = 'admin' and a matching `nus_email`
//      (hand-inserted, e.g. via the Supabase SQL editor), plus
//   2. `npx tsx scripts/create-admin-user.ts <email> <password>` for the
//      Supabase Auth side
//
// -- and they are trivially easy to get subtly wrong, because nothing joins
// them but a string. `is_admin()` (0009_rls_policies.sql, tightened by
// 0012-0014) is:
//
//     select exists (select 1 from members m
//                    where m.nus_email = auth.email()
//                      and m.role = 'admin' and m.active)
//
// If the two emails differ by so much as a capital letter, `is_admin()`
// returns false and you get a dashboard that loads, signs you in, and then
// shows nothing but empty tables -- because RLS is silently refusing every
// query. That failure looks exactly like "the app is broken", not like "your
// email doesn't match".
//
// So this script does both halves AND then actually proves the join works, by
// signing in with the anon key as that user and calling is_admin() through a
// genuinely authenticated (non-service-role) session. A service-role check
// would prove nothing: the service role bypasses RLS entirely, which is
// precisely why RLS bugs stayed invisible in this codebase before (see
// CLAUDE.md, "RLS/security gotchas").
//
// Idempotent: re-running against an existing member and/or existing auth user
// updates them into the right state instead of failing. Safe to run twice, and
// safe to run to repair a half-finished first attempt.
//
// Run: npx tsx scripts/bootstrap-admin.ts <email> <password> ["Full Name"]
// ---------------------------------------------------------------------------

function fail(message: string): never {
  console.error(`bootstrap-admin: ${message}`);
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    fail(`Missing ${name}. Check .env.local (see .env.local.example).`);
  }
  return value;
}

/**
 * Finds an auth user by email, paging through the admin list.
 *
 * `auth.admin` has no get-by-email, and `listUsers` is paginated (default 50).
 * A club roster is small enough that walking the pages is fine; the cap exists
 * only so a misconfigured project can't spin forever.
 */
async function findAuthUserByEmail(
  admin: ReturnType<typeof getServiceRoleClient>,
  email: string,
): Promise<{ id: string; email?: string } | null> {
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
  const [, , rawEmail, password, ...nameParts] = process.argv;

  if (!rawEmail || !password) {
    fail(
      'Usage: npx tsx scripts/bootstrap-admin.ts <email> <password> ["Full Name"]\n' +
        "  <email>     becomes BOTH the Supabase Auth login and members.nus_email.\n" +
        "              They must match exactly -- that is the whole point of this script.\n" +
        "  <password>  the /admin sign-in password. On a re-run, this RESETS the\n" +
        "              existing auth user's password (so the verification step can\n" +
        "              actually sign in and prove the join works).\n" +
        '  "Full Name" optional; defaults to the local part of the email.',
    );
  }

  // Supabase Auth stores and compares emails lowercased, and is_admin() joins
  // members.nus_email = auth.email() with plain `=`. Lowercasing both sides
  // here is what removes the single most likely way to get this wrong.
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    fail(`"${rawEmail}" does not look like an email address.`);
  }
  if (email !== rawEmail.trim()) {
    console.log(`Note: normalised "${rawEmail.trim()}" to "${email}" (Supabase Auth lowercases emails).`);
  }

  const fullName = nameParts.join(" ").trim() || email.split("@")[0];

  const supabaseUrl = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  requireEnv("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const admin = getServiceRoleClient();

  // -------------------------------------------------------------------------
  // Half 1: the members row.
  // -------------------------------------------------------------------------
  const { data: existingMember, error: memberLookupError } = await admin
    .from("members")
    .select("*")
    .eq("nus_email", email)
    .maybeSingle();
  if (memberLookupError) fail(`Failed to look up members row: ${memberLookupError.message}`);

  let memberId: string;
  if (existingMember) {
    // Promote/reactivate rather than skip: the common repair case is "the row
    // exists but role is 'member'", or "was offboarded and is coming back".
    const needsChange =
      existingMember.role !== "admin" || !existingMember.active;
    const { data: updated, error: updateError } = await admin
      .from("members")
      .update({ role: "admin", active: true, left_at: null })
      .eq("id", existingMember.id)
      .select()
      .single();
    if (updateError) fail(`Failed to promote members row: ${updateError.message}`);
    memberId = updated.id;
    console.log(
      needsChange
        ? `Promoted existing members row to an active admin (${updated.full_name}).`
        : `members row already an active admin (${updated.full_name}) — left as is.`,
    );
  } else {
    // Inserting also fires the `create_member_holder` trigger
    // (0003_holders.sql), so the linked `member`-kind holders row appears for
    // free -- no separate holder step here either.
    const { data: inserted, error: insertError } = await admin
      .from("members")
      .insert({
        full_name: fullName,
        nus_email: email,
        role: "admin",
        active: true,
      } satisfies Database["public"]["Tables"]["members"]["Insert"])
      .select()
      .single();
    if (insertError) fail(`Failed to create members row: ${insertError.message}`);
    memberId = inserted.id;
    console.log(`Created members row for "${fullName}" (role=admin, active=true).`);
  }

  // -------------------------------------------------------------------------
  // Half 2: the Supabase Auth user.
  // -------------------------------------------------------------------------
  const existingUser = await findAuthUserByEmail(admin, email);
  let authUserId: string;

  if (existingUser) {
    // Resetting the password looks heavy-handed, but it's what makes a re-run
    // idempotent AND verifiable: without a password we know, the sign-in check
    // below can't run, and an unverified bootstrap is exactly the state this
    // script exists to eliminate.
    const { error: updateError } = await admin.auth.admin.updateUserById(existingUser.id, {
      password,
      email_confirm: true,
    });
    if (updateError) fail(`Failed to update existing auth user: ${updateError.message}`);
    authUserId = existingUser.id;
    console.log(`Auth user already existed — password reset to the one supplied.`);
  } else {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (error || !data.user) {
      fail(`Failed to create auth user: ${error?.message ?? "unknown error"}`);
    }
    authUserId = data.user.id;
    console.log(`Created Supabase Auth user.`);
  }

  // -------------------------------------------------------------------------
  // Verify the join for real.
  // -------------------------------------------------------------------------
  console.log("\nVerifying is_admin() through a real authenticated session…");
  const asUser = createClient<Database>(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: signInError } = await asUser.auth.signInWithPassword({ email, password });
  if (signInError) {
    fail(
      `Could not sign in as ${email}: ${signInError.message}\n` +
        "The members row and auth user exist, but the sign-in half is broken — " +
        "check whether email confirmations or a password policy are enforced on this project.",
    );
  }

  const { data: isAdmin, error: rpcError } = await asUser.rpc("is_admin");
  if (rpcError) {
    fail(
      `is_admin() could not be called as this user: ${rpcError.message}\n` +
        "Check the grants in supabase/migrations/0012-0014 — is_admin() must be " +
        "executable by the `authenticated` role.",
    );
  }

  if (isAdmin !== true) {
    await asUser.auth.signOut();
    fail(
      `is_admin() returned ${isAdmin} for ${email}.\n` +
        "The two halves exist but do not join. is_admin() matches " +
        "members.nus_email = auth.email() exactly, so check for a stray space " +
        "or a second members row carrying this email with role != 'admin'.",
    );
  }

  // A signed-in non-admin passes middleware but gets empty results from RLS,
  // so also prove a real admin-gated read actually returns rows.
  const { error: readError } = await asUser.from("members").select("id").limit(1);
  await asUser.auth.signOut();
  if (readError) {
    fail(`is_admin() is true but reading members as this user failed: ${readError.message}`);
  }

  console.log("  is_admin() = true, and an RLS-gated members read succeeded.");
  console.log("\nBootstrap complete.");
  console.log(`  email:       ${email}`);
  console.log(`  members.id:  ${memberId}`);
  console.log(`  auth uid:    ${authUserId}`);
  console.log(
    "\nSign in at /admin/login with that email and password. Every admin after " +
      "this one can be added through /admin/members (set role = admin, and make " +
      "sure their NUS email matches the Supabase Auth account you create for them).",
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
