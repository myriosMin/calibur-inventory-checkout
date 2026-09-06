import "./_env";

import { getServiceRoleClient } from "../src/lib/supabase/server";
import { generateScanCode } from "../src/lib/codes/generate";
import type { TablesInsert } from "../src/lib/types/database";

// ---------------------------------------------------------------------------
// scripts/seed-fixtures.ts
//
// Seeds development/testing fixture data (WP7) into the LIVE calibur-inventory
// Supabase project: a handful of members, robot holders, a catalog spanning
// all three product tiers (including a resistor-book-style grouped location),
// matching scan_codes, and a `seed` stock_movements batch so every product
// shows a plausible non-zero `qty_in_store` via the `stock_summary` view.
//
// Idempotent by design: every insert is preceded by a lookup on a natural key
// (members.nus_email / telegram_username, holders (kind,name), products.name,
// products -> scan_codes 1:1, group location name) so running this twice
// creates zero duplicate rows. Run with:
//
//   npx tsx scripts/seed-fixtures.ts
// ---------------------------------------------------------------------------

const db = getServiceRoleClient();

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

// `admin@example.com` is a FIXTURE email only -- it does not exist as a real
// NUS mailbox. It exists so that `scripts/create-admin-user.ts <email>
// <password>` (WP9) can be pointed at this same address to create a matching
// Supabase Auth user; `is_admin()` joins on `members.nus_email = auth.email()`
// so the two rows (this `members` row + the Supabase Auth user) must share
// the exact email to make that account an admin.
type MemberFixture = {
  full_name: string;
  display_name: string;
  nus_email: string | null;
  telegram_username: string | null;
  telegram_user_id: number | null;
  role: "member" | "admin";
};

const MEMBERS: MemberFixture[] = [
  {
    full_name: "Alex Tan",
    display_name: "Alex",
    nus_email: "alex.tan@u.nus.edu",
    telegram_username: "alextan_nus",
    telegram_user_id: null,
    role: "member",
  },
  {
    full_name: "Priya Nair",
    display_name: "Priya",
    nus_email: "priya.nair@u.nus.edu",
    telegram_username: "priyanair",
    telegram_user_id: null,
    role: "member",
  },
  {
    full_name: "Admin Fixture",
    display_name: "Admin",
    nus_email: "admin@example.com",
    telegram_username: "calibur_admin",
    telegram_user_id: null,
    role: "admin",
  },
  // Pre-bound test member for automated integration tests (WP23). The real
  // Telegram bot API assigns user ids as ordinary (and currently much
  // smaller, well under 2^32) positive integers, so anything at or above
  // 900000000000 (9e11) is safely outside any range Telegram could ever
  // hand out for the foreseeable future -- reserved here as a fixed,
  // collision-free id a test suite can hardcode and bind against without
  // going through the real `/start` flow.
  {
    full_name: "Test Bot Member",
    display_name: "TestBot",
    nus_email: null,
    telegram_username: "calibur_test_bot",
    telegram_user_id: 900000000001,
    role: "member",
  },
];

// ---------------------------------------------------------------------------
// Robot holders (data-model.md's list)
// ---------------------------------------------------------------------------

const ROBOTS = ["DarkNUS", "Hero", "Standard", "Sentry", "Engineer"];

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

type ProductFixture = {
  name: string;
  tier: "asset" | "bulk" | "loose";
  category?: string;
  returnable?: boolean;
  min_stock?: number | null;
  unit?: string;
  part_number?: string | null;
  spec?: Record<string, unknown> | null;
  notes?: string | null;
  startQty: number; // plausible seed quantity into `store`
  group?: "resistor-book"; // marks products sharing the grouped location
};

const PRODUCTS: ProductFixture[] = [
  // --- asset tier -----------------------------------------------------
  {
    name: "GM6020",
    tier: "asset",
    category: "Assembled parts",
    returnable: true,
    min_stock: 4,
    unit: "pcs",
    part_number: "GM6020",
    startQty: 12,
  },
  {
    name: "M3508",
    tier: "asset",
    category: "Assembled parts",
    returnable: true,
    min_stock: 6,
    unit: "pcs",
    part_number: "M3508",
    startQty: 20,
  },
  {
    name: "M2006",
    tier: "asset",
    category: "Assembled parts",
    returnable: true,
    min_stock: 4,
    unit: "pcs",
    part_number: "M2006",
    startQty: 15,
  },
  {
    name: "Damiao 4310",
    tier: "asset",
    category: "Assembled parts",
    returnable: true,
    min_stock: 2,
    unit: "pcs",
    part_number: "DM-J4310",
    startQty: 6,
  },
  {
    name: "C620 ESC",
    tier: "asset",
    category: "Electronics",
    returnable: true,
    min_stock: 8,
    unit: "pcs",
    part_number: "C620",
    startQty: 18,
  },
  {
    name: "DJI Type C Development Board",
    tier: "asset",
    category: "Electronics",
    returnable: true,
    min_stock: 2,
    unit: "pcs",
    part_number: "TypeC-Dev",
    startQty: 5,
  },
  {
    name: "Referee System Base",
    tier: "asset",
    category: "Tools",
    returnable: true,
    min_stock: 1,
    unit: "pcs",
    startQty: 3,
  },
  // --- bulk tier --------------------------------------------------------
  {
    name: "XT30 right angle M",
    tier: "bulk",
    category: "Connectors",
    returnable: false,
    min_stock: 20,
    unit: "pcs",
    startQty: 80,
  },
  {
    name: "XT60 male",
    tier: "bulk",
    category: "Connectors",
    returnable: false,
    min_stock: 10,
    unit: "pcs",
    startQty: 40,
  },
  {
    name: "Resistor 1kΩ 0603",
    tier: "bulk",
    category: "SMD",
    returnable: false,
    min_stock: 50,
    unit: "pcs",
    spec: { value: "1k", package: "0603", tolerance: "1%", type: "resistor" },
    startQty: 200,
  },
  {
    name: "24AWG silicone wire (red)",
    tier: "bulk",
    category: "Wires",
    returnable: false,
    min_stock: 10,
    unit: "m",
    startQty: 30,
  },
  {
    name: "M3x8 socket head screw",
    tier: "bulk",
    category: "Fasteners",
    returnable: false,
    min_stock: 100,
    unit: "pcs",
    startQty: 500,
  },
  {
    name: "JST-PH 2-pin housing",
    tier: "bulk",
    category: "Connectors",
    returnable: false,
    min_stock: 20,
    unit: "pcs",
    startQty: 60,
  },
  // Spec-only search fixture: name deliberately has no value string; the
  // 10k/0402 value only lives in `spec`, so a search test for "10k" or
  // "0402" must hit this via jsonb, not via a name substring match.
  {
    name: "Resistor 0402",
    tier: "bulk",
    category: "SMD",
    returnable: false,
    min_stock: 50,
    unit: "pcs",
    spec: { value: "10k", package: "0402", tolerance: "1%", type: "resistor" },
    startQty: 150,
  },
  // --- resistor-book grouped products (share one `locations` row) -------
  {
    name: "Resistor 4.7kΩ 0402",
    tier: "bulk",
    category: "SMD",
    returnable: false,
    min_stock: 50,
    unit: "pcs",
    spec: { value: "4.7k", package: "0402", tolerance: "1%", type: "resistor" },
    startQty: 120,
    group: "resistor-book",
  },
  {
    name: "Resistor 10kΩ 0603",
    tier: "bulk",
    category: "SMD",
    returnable: false,
    min_stock: 50,
    unit: "pcs",
    spec: { value: "10k", package: "0603", tolerance: "1%", type: "resistor" },
    startQty: 130,
    group: "resistor-book",
  },
  {
    name: "Resistor 100Ω 0805",
    tier: "bulk",
    category: "SMD",
    returnable: false,
    min_stock: 50,
    unit: "pcs",
    spec: { value: "100", package: "0805", tolerance: "1%", type: "resistor" },
    startQty: 90,
    group: "resistor-book",
  },
  // --- loose tier ---------------------------------------------------------
  {
    name: "Heat shrink assorted",
    tier: "loose",
    category: "Wires",
    returnable: false,
    min_stock: null,
    unit: "lot",
    startQty: 1,
  },
  {
    name: "Terminal crimps",
    tier: "loose",
    category: "Connectors",
    returnable: false,
    min_stock: null,
    unit: "lot",
    startQty: 1,
  },
  {
    name: "Cable ties assorted",
    tier: "loose",
    category: "Wires",
    returnable: false,
    min_stock: null,
    unit: "lot",
    startQty: 1,
  },
];

async function main() {
  console.log("Seeding fixtures against the live calibur-inventory project...");

  // -------------------------------------------------------------------
  // 1. Members (upsert on nus_email when present, else telegram_username)
  // -------------------------------------------------------------------
  let membersUpserted = 0;
  for (const m of MEMBERS) {
    const lookupColumn = m.nus_email ? "nus_email" : "telegram_username";
    const lookupValue = m.nus_email ?? m.telegram_username;
    if (!lookupValue) throw new Error(`Member ${m.full_name} has no natural key`);

    const { data: existing, error: selErr } = await db
      .from("members")
      .select("id")
      .eq(lookupColumn, lookupValue)
      .maybeSingle();
    if (selErr) throw selErr;

    if (existing) {
      continue; // already seeded; leave any manual edits alone
    }

    const insert: TablesInsert<"members"> = {
      full_name: m.full_name,
      display_name: m.display_name,
      nus_email: m.nus_email,
      telegram_username: m.telegram_username,
      telegram_user_id: m.telegram_user_id,
      telegram_bound_at: m.telegram_user_id ? new Date().toISOString() : null,
      role: m.role,
      active: true,
    };
    const { error: insErr } = await db.from("members").insert(insert);
    if (insErr) throw insErr;
    membersUpserted++;
  }
  console.log(`Members: ${membersUpserted} newly inserted (of ${MEMBERS.length} fixtures).`);

  // -------------------------------------------------------------------
  // 2. Robot holders (unique on (kind, name) while active)
  // -------------------------------------------------------------------
  let robotsInserted = 0;
  for (const name of ROBOTS) {
    const { data: existing, error: selErr } = await db
      .from("holders")
      .select("id")
      .eq("kind", "robot")
      .eq("name", name)
      .maybeSingle();
    if (selErr) throw selErr;
    if (existing) continue;

    const insert: TablesInsert<"holders"> = { kind: "robot", name, active: true };
    const { error: insErr } = await db.from("holders").insert(insert);
    if (insErr) throw insErr;
    robotsInserted++;
  }
  console.log(`Robot holders: ${robotsInserted} newly inserted (of ${ROBOTS.length} fixtures).`);

  // -------------------------------------------------------------------
  // 3. Pseudo-holders: look up `store` and `adjustment` (already seeded by
  //    the 0003_holders.sql migration -- never created here).
  // -------------------------------------------------------------------
  const { data: storeHolder, error: storeErr } = await db
    .from("holders")
    .select("id")
    .eq("kind", "store")
    .eq("active", true)
    .maybeSingle();
  if (storeErr) throw storeErr;
  if (!storeHolder) {
    throw new Error(
      "No active 'store' pseudo-holder found. Expected it to already exist from the schema migration (0003_holders.sql).",
    );
  }

  const { data: adjustmentHolder, error: adjErr } = await db
    .from("holders")
    .select("id")
    .eq("kind", "adjustment")
    .eq("active", true)
    .maybeSingle();
  if (adjErr) throw adjErr;
  if (!adjustmentHolder) {
    throw new Error(
      "No active 'adjustment' pseudo-holder found. Expected it to already exist from the schema migration (0003_holders.sql).",
    );
  }

  // -------------------------------------------------------------------
  // 4. Resistor-book grouped location (one `locations` row shared by all
  //    products with group === 'resistor-book').
  // -------------------------------------------------------------------
  const GROUP_LOCATION_NAME = "Resistor book";
  let groupLocationId: string;
  {
    const { data: existing, error: selErr } = await db
      .from("locations")
      .select("id")
      .eq("name", GROUP_LOCATION_NAME)
      .maybeSingle();
    if (selErr) throw selErr;

    if (existing) {
      groupLocationId = existing.id;
    } else {
      const insert: TablesInsert<"locations"> = { name: GROUP_LOCATION_NAME };
      const { data: inserted, error: insErr } = await db
        .from("locations")
        .insert(insert)
        .select("id")
        .single();
      if (insErr) throw insErr;
      groupLocationId = inserted.id;
    }
  }

  // -------------------------------------------------------------------
  // 5. Products + matching scan_codes (kind='product') + seed movements.
  // -------------------------------------------------------------------
  let productsInserted = 0;
  let scanCodesInserted = 0;
  let movementsInserted = 0;

  for (const p of PRODUCTS) {
    const { data: existing, error: selErr } = await db
      .from("products")
      .select("id")
      .eq("name", p.name)
      .maybeSingle();
    if (selErr) throw selErr;

    let productId: string;

    if (existing) {
      productId = existing.id;
    } else {
      const insert: TablesInsert<"products"> = {
        name: p.name,
        tier: p.tier,
        category: p.category ?? null,
        location_id: p.group === "resistor-book" ? groupLocationId : null,
        returnable: p.returnable ?? false,
        min_stock: p.min_stock ?? null,
        unit: p.unit ?? "pcs",
        part_number: p.part_number ?? null,
        spec: (p.spec ?? null) as TablesInsert<"products">["spec"],
        notes: p.notes ?? null,
        active: true,
      };
      const { data: inserted, error: insErr } = await db
        .from("products")
        .insert(insert)
        .select("id")
        .single();
      if (insErr) throw insErr;
      productId = inserted.id;
      productsInserted++;
    }

    // Matching scan_codes row (kind='product'), only generated if this
    // product doesn't already have an active one.
    const { data: existingCode, error: codeSelErr } = await db
      .from("scan_codes")
      .select("code")
      .eq("product_id", productId)
      .eq("kind", "product")
      .maybeSingle();
    if (codeSelErr) throw codeSelErr;

    if (!existingCode) {
      const code = await insertUniqueScanCode(db, {
        kind: "product",
        product_id: productId,
        location_id: null,
        label: p.name,
        active: true,
      });
      if (code) scanCodesInserted++;
    }

    // Seed a starting quantity via a `seed` stock_movements row, but only
    // once per product (guard by checking whether any 'seed' movement
    // already exists for it) so re-running never double-seeds quantities.
    const { data: existingSeedMovement, error: movSelErr } = await db
      .from("stock_movements")
      .select("id")
      .eq("product_id", productId)
      .eq("reason", "seed")
      .limit(1)
      .maybeSingle();
    if (movSelErr) throw movSelErr;

    if (!existingSeedMovement) {
      const insert: TablesInsert<"stock_movements"> = {
        product_id: productId,
        from_holder_id: adjustmentHolder.id,
        to_holder_id: storeHolder.id,
        qty: p.startQty,
        reason: "seed",
        entry_method: "admin",
      };
      const { error: movInsErr } = await db.from("stock_movements").insert(insert);
      if (movInsErr) throw movInsErr;
      movementsInserted++;
    }
  }
  console.log(
    `Products: ${productsInserted} newly inserted (of ${PRODUCTS.length} fixtures).`,
  );
  console.log(`Scan codes (product): ${scanCodesInserted} newly inserted.`);
  console.log(`Stock movements (seed): ${movementsInserted} newly inserted.`);

  // -------------------------------------------------------------------
  // 6. Group scan_code (kind='group') pointing at the resistor-book
  //    location, so the group-pick UI has something to resolve.
  // -------------------------------------------------------------------
  const { data: existingGroupCode, error: groupCodeSelErr } = await db
    .from("scan_codes")
    .select("code")
    .eq("location_id", groupLocationId)
    .eq("kind", "group")
    .maybeSingle();
  if (groupCodeSelErr) throw groupCodeSelErr;

  let groupCodeInserted = false;
  if (!existingGroupCode) {
    const code = await insertUniqueScanCode(db, {
      kind: "group",
      product_id: null,
      location_id: groupLocationId,
      label: GROUP_LOCATION_NAME,
      active: true,
    });
    groupCodeInserted = code !== null;
  }
  console.log(`Group scan code: ${groupCodeInserted ? "1 newly inserted" : "already present"}.`);

  console.log("Seed complete.");
}

/**
 * Inserts a scan_codes row with a freshly generated code, retrying on the
 * (astronomically unlikely) chance of a collision with an existing PK.
 */
async function insertUniqueScanCode(
  db: ReturnType<typeof getServiceRoleClient>,
  base: Omit<TablesInsert<"scan_codes">, "code">,
): Promise<string | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateScanCode();
    const { error } = await db.from("scan_codes").insert({ ...base, code });
    if (!error) return code;
    // 23505 = unique_violation; retry with a new code. Any other error
    // should surface immediately.
    if (error.code !== "23505") throw error;
  }
  throw new Error("Failed to generate a unique scan code after 5 attempts.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("seed-fixtures failed:", err);
    process.exit(1);
  });
