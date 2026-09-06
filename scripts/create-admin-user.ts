import "./_env";

import { getServiceRoleClient } from "@/lib/supabase/server";

function fail(message: string): never {
  console.error(`create-admin-user: ${message}`);
  process.exit(1);
}

async function main() {
  const [, , email, password] = process.argv;

  if (!email || !password) {
    fail(
      "Usage: npx tsx scripts/create-admin-user.ts <email> <password>\n" +
        "Both <email> and <password> are required.",
    );
  }

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
    fail(
      "Missing NEXT_PUBLIC_SUPABASE_URL. Check .env.local (see .env.local.example).",
    );
  }
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    fail(
      "Missing SUPABASE_SERVICE_ROLE_KEY. Check .env.local (see .env.local.example).",
    );
  }

  const supabase = getServiceRoleClient();

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (error || !data.user) {
    fail(`Failed to create user: ${error?.message ?? "unknown error"}`);
  }

  console.log(`Created Supabase Auth user.`);
  console.log(`  id:    ${data.user.id}`);
  console.log(`  email: ${data.user.email}`);
  console.log(
    "\nRemember: a `members` row with role='admin' and nus_email matching " +
      "this exact email must also exist for is_admin() to return true for " +
      "this account.",
  );
}

main().catch((err) => {
  fail(err instanceof Error ? err.message : String(err));
});
