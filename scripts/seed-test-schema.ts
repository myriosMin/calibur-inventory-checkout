import "./_test-schema";
import "./_env";

import { generateScanCode } from "../src/lib/codes/generate";
import { dbSchema } from "../src/lib/supabase/schema";
import { getServiceRoleClient } from "../src/lib/supabase/server";
import type { TablesInsert } from "../src/lib/types/database";

// ---------------------------------------------------------------------------
// scripts/seed-test-schema.ts
//
// The `test` schema is a snapshot of the REAL catalog (loaded with
// `scripts/import-clean-data.ts --schema test`), so the integration tests
// exercise real product and robot names. This adds only what the real data
// cannot provide:
//   - an admin account and a pre-bound Telegram member for tests to act as
//   - scan codes, because no labels have been printed for the real catalog
//
// Replaces scripts/seed-fixtures.ts, whose invented catalog is gone.
// Idempotent. Refuses to run against anything but `test`.
//
//   npx tsx scripts/seed-test-schema.ts
// ---------------------------------------------------------------------------

if (dbSchema() !== "test") {
  throw new Error("seed-test-schema only ever writes to the test schema.");
}

const db = getServiceRoleClient();

// Check the client, not just the env var: this script once wrote a test member
// into the real inventory because the client ignored a correctly set variable.
const clientSchema = (db as unknown as { rest: { schemaName?: string } }).rest.schemaName;
if (clientSchema !== "test") {
  throw new Error(`Refusing to seed: the service-role client targets "${clientSchema ?? "public"}", not "test".`);
}

/** `admin@example.com` has a matching Supabase Auth user (create-admin-user.ts), so is_admin() is true for it. */
export const TEST_ADMIN_EMAIL = "admin@example.com";
/** Far above any id Telegram hands out, so a test can bind as it without a real account. */
export const TEST_TELEGRAM_USER_ID = 900000000001;
/** Handle of the member the /start binding test binds (webhook-bind.test.ts). */
export const TEST_UNBOUND_USERNAME = "calibur_test_unbound";

const TEST_MEMBERS: TablesInsert<"members">[] = [
  {
    full_name: "Test Admin",
    display_name: "TestAdmin",
    nus_email: TEST_ADMIN_EMAIL,
    telegram_username: "calibur_test_admin",
    role: "admin",
  },
  {
    full_name: "Test Bot Member",
    display_name: "TestBot",
    nus_email: null,
    telegram_username: "calibur_test_bot",
    telegram_user_id: TEST_TELEGRAM_USER_ID,
    telegram_bound_at: new Date().toISOString(),
    role: "member",
  },
  // Has a handle but no Telegram id yet: the /start binding test binds as it.
  // The real roster has no handles at all, so this has to be invented.
  {
    full_name: "Test Unbound Member",
    display_name: "TestUnbound",
    nus_email: "unbound-member@example.invalid",
    telegram_username: TEST_UNBOUND_USERNAME,
    role: "member",
  },
];

/** Real products that get a product scan code: one per tier plus the ones the tests name. */
const LABELLED_PRODUCTS = [
  "DJI GM6020 motor",
  "XT30 right angle M",
  "DJI C615 ESC",
  "Damiao DM4310 motor",
  "Terminal crimps",
];

/** Real locations that get a group code (the resistor book is the case group codes exist for). */
const GROUP_LOCATIONS = ["Resistor book (0402)"];

async function insertUniqueScanCode(base: Omit<TablesInsert<"scan_codes">, "code">): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateScanCode();
    const { error } = await db.from("scan_codes").insert({ ...base, code });
    if (!error) return code;
    if (error.code !== "23505") throw error;
  }
  throw new Error("Failed to generate a unique scan code after 5 attempts.");
}

async function main() {
  const { count, error: countError } = await db.from("products").select("*", { count: "exact", head: true });
  if (countError) throw countError;
  if (!count) {
    throw new Error(
      "The test schema has no products. Load the real catalog first:\n" +
        "  npx tsx scripts/import-clean-data.ts --schema test && supabase db query --linked -f data/clean/import.test.sql",
    );
  }

  for (const member of TEST_MEMBERS) {
    const lookup = member.nus_email
      ? db.from("members").select("id").eq("nus_email", member.nus_email)
      : db.from("members").select("id").eq("telegram_user_id", member.telegram_user_id!);
    const { data: existing, error } = await lookup.maybeSingle();
    if (error) throw error;
    if (existing) continue;
    const { error: insertError } = await db.from("members").insert(member);
    if (insertError) throw insertError;
    console.log(`Member: inserted ${member.full_name}.`);
  }

  for (const name of LABELLED_PRODUCTS) {
    const { data: product, error } = await db.from("products").select("id").eq("name", name).eq("active", true).single();
    if (error) throw new Error(`Real product "${name}" not found in the test schema: ${error.message}`);
    const { data: existing, error: codeError } = await db
      .from("scan_codes")
      .select("code")
      .eq("product_id", product.id)
      .eq("kind", "product")
      .maybeSingle();
    if (codeError) throw codeError;
    if (existing) continue;
    const code = await insertUniqueScanCode({ kind: "product", product_id: product.id, location_id: null, label: name });
    console.log(`Scan code: ${code} -> ${name}.`);
  }

  for (const name of GROUP_LOCATIONS) {
    const { data: location, error } = await db.from("locations").select("id").eq("name", name).single();
    if (error) throw new Error(`Real location "${name}" not found in the test schema: ${error.message}`);
    const { data: existing, error: codeError } = await db
      .from("scan_codes")
      .select("code")
      .eq("location_id", location.id)
      .eq("kind", "group")
      .maybeSingle();
    if (codeError) throw codeError;
    if (existing) continue;
    const code = await insertUniqueScanCode({ kind: "group", product_id: null, location_id: location.id, label: name });
    console.log(`Group code: ${code} -> ${name}.`);
  }

  console.log("Test schema seeded.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("seed-test-schema failed:", error);
    process.exit(1);
  });
