/**
 * Turns the cleaned data set in data/clean/ into ONE SQL transaction.
 *
 *   npx tsx scripts/import-clean-data.ts
 *       validate, then write data/clean/import.sql
 *   npx tsx scripts/import-clean-data.ts --rehearse [--with-migration]
 *       write data/clean/import.rehearse.sql, which runs every statement and
 *       then raises an exception reporting row counts -- so running it
 *       against a real database changes nothing. --with-migration puts the
 *       catalog migrations (0024, 0025) inside the same transaction, for a
 *       database that does not have them yet.
 *
 * Apply with the Supabase CLI (`supabase db push` does not work from here,
 * see docs/tele-qr/checkpoint.md):
 *
 *   supabase db query --linked -f data/clean/import.sql
 *
 * What lands:
 *   - action=import products, active; action=hold products, INACTIVE, so a
 *     reviewer can check and switch them on from /admin; action=drop, nothing
 *   - units, robot holders, locations, members
 *   - opening balances as `seed` movements, and open legacy loans with their
 *     original timestamps
 *   - every row of review_flags.csv, plus one per held loan, as review_items:
 *     the dashboard's review queue
 *
 * This script never connects to a database.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseCsv } from "../src/lib/csv/parse";
import { normalizeTelegramHandle } from "../src/lib/utils/normalize";

import { OPENING_BALANCE_AT } from "./clean-data/curation";

export const CLEAN_DIR = "data/clean";
export const CATALOG_MIGRATIONS = [
  "supabase/migrations/0024_catalog_import_ownership_criticality_roles.sql",
  "supabase/migrations/0025_review_queue_and_staff_stocktake.sql",
];
export const LEGACY_SESSION_NOTE = "Imported from the legacy checkout app";
const REVIEW_SOURCE = "catalog clean-up (data/clean)";

type Row = Record<string, string>;

const TIERS = ["asset", "bulk", "loose"];
const CRITICALITIES = ["critical", "standard", "expendable"];
const PRODUCT_OWNERSHIP = ["owned", "on_loan", "mixed"];
const UNIT_OWNERSHIP = ["owned", "on_loan"];
const CONDITIONS = ["ok", "faulty", "disposed", "missing", "unknown"];
const ROLES = ["member", "procurement", "admin"];
const MOVEMENTS = ["borrow", "consume"];
const SEVERITIES = ["blocker", "check", "info"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function readCleanTable(dir: string, file: string): Row[] {
  const full = path.join(dir, file);
  if (!existsSync(full)) throw new Error(`${full} not found -- run scripts/clean-data/build.ts first`);
  const [header, ...rows] = parseCsv(readFileSync(full, "utf-8"));
  return rows
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells) => Object.fromEntries(header.map((name, i) => [name, (cells[i] ?? "").trim()])));
}

/** A SQL string literal, or `null` for an empty cell. */
export function sqlText(value: string | null | undefined, cast = ""): string {
  if (value === null || value === undefined || value === "") return `null${cast}`;
  return `'${value.replace(/'/g, "''")}'${cast}`;
}

const HOLDER = {
  store: "(select id from holders where kind = 'store' and active)",
  adjustment: "(select id from holders where kind = 'adjustment' and active)",
  consumed: "(select id from holders where kind = 'consumed' and active)",
  robot: (name: string) => `(select id from holders where kind = 'robot' and name = ${sqlText(name)} and active)`,
  member: (email: string) =>
    `(select h.id from holders h join members m on m.id = h.member_id where h.kind = 'member' and lower(m.nus_email) = ${sqlText(email.toLowerCase())})`,
};
const memberId = (email: string) => `(select id from members where lower(nus_email) = ${sqlText(email.toLowerCase())})`;
const locationId = (name: string) =>
  name ? `(select id from locations where name = ${sqlText(name)} order by created_at limit 1)` : "null";

export interface ImportPlan {
  sql: string;
  errors: string[];
  warnings: string[];
  counts: Record<string, number>;
}

export function buildImport(
  dir: string,
  options: { rehearse: boolean; migrationSqls: string[]; schema?: "public" | "test" },
): ImportPlan {
  const schema = options.schema ?? "public";
  const errors: string[] = [];
  const warnings: string[] = [];

  const products = readCleanTable(dir, "products.csv");
  const units = readCleanTable(dir, "asset_units.csv");
  const balances = readCleanTable(dir, "opening_balances.csv");
  const loans = readCleanTable(dir, "open_loans.csv");
  const holders = readCleanTable(dir, "holders.csv");
  const locations = readCleanTable(dir, "locations.csv");
  const members = readCleanTable(dir, "members.csv");
  const flags = readCleanTable(dir, "review_flags.csv");

  // --- products ------------------------------------------------------------
  /** Everything that will exist in the database (import + hold). */
  const loaded = new Map<string, Row>();
  /** The subset that is live: only these may carry stock, units or loans. */
  const active = new Set<string>();
  const seenKeys = new Set<string>();
  for (const p of products) {
    const where = `products.csv ${p.key || "(no key)"}`;
    if (!p.key) {
      errors.push(`${where}: key is empty`);
      continue;
    }
    if (seenKeys.has(p.key)) errors.push(`${where}: duplicate key`);
    seenKeys.add(p.key);
    if (!["import", "hold", "drop"].includes(p.action)) {
      errors.push(`${where}: action must be import, hold or drop`);
      continue;
    }
    if (p.action === "drop") continue;

    if (!p.name) errors.push(`${where}: name is empty`);
    if (!TIERS.includes(p.tier)) errors.push(`${where}: tier "${p.tier}" is not one of ${TIERS.join("/")}`);
    if (!CRITICALITIES.includes(p.criticality)) errors.push(`${where}: criticality "${p.criticality}" is not one of ${CRITICALITIES.join("/")}`);
    if (!PRODUCT_OWNERSHIP.includes(p.ownership)) errors.push(`${where}: ownership "${p.ownership}" is not one of ${PRODUCT_OWNERSHIP.join("/")}`);
    if (p.ownership === "owned" && p.loaned_from) errors.push(`${where}: an owned product cannot have loaned_from`);
    if (!["true", "false"].includes(p.returnable)) errors.push(`${where}: returnable must be true or false`);
    if (!p.unit) errors.push(`${where}: unit is empty`);
    if (p.spec_json) {
      try {
        JSON.parse(p.spec_json);
      } catch {
        errors.push(`${where}: spec_json is not valid JSON`);
      }
    }
    loaded.set(p.key, p);
    if (p.action === "import") active.add(p.key);
  }

  const notActive = (where: string, key: string, what: string) => {
    if (loaded.has(key)) warnings.push(`${where}: product ${key} is held (inactive); ${what} skipped`);
    else if (seenKeys.has(key)) warnings.push(`${where}: product ${key} is dropped; ${what} skipped`);
    else errors.push(`${where}: unknown product ${key}`);
  };

  const locationNames = new Set(locations.map((l) => l.name).filter(Boolean));
  for (const p of loaded.values()) {
    if (p.location && !locationNames.has(p.location)) {
      locationNames.add(p.location);
      warnings.push(`products.csv ${p.key}: location "${p.location}" is not in locations.csv; it will be created`);
    }
  }

  // --- holders and members -------------------------------------------------
  const robotNames = new Set<string>();
  for (const h of holders) {
    if (h.kind !== "robot") errors.push(`holders.csv ${h.name}: only robot holders are imported (got kind "${h.kind}")`);
    else if (h.name) robotNames.add(h.name);
  }

  const memberEmails = new Set<string>();
  const memberRows: Row[] = [];
  for (const m of members) {
    const email = m.nus_email.toLowerCase();
    const where = `members.csv ${email || m.full_name || "(blank)"}`;
    if (!m.full_name) errors.push(`${where}: full_name is empty`);
    if (!email) {
      errors.push(`${where}: nus_email is required (it is how loans find their member)`);
      continue;
    }
    if (memberEmails.has(email)) errors.push(`${where}: duplicate email`);
    if (!ROLES.includes(m.role)) errors.push(`${where}: role "${m.role}" is not one of ${ROLES.join("/")}`);
    memberEmails.add(email);
    memberRows.push(m);
  }

  // --- units ---------------------------------------------------------------
  const unitCodes = new Set<string>();
  const unitRows: Row[] = [];
  for (const u of units) {
    const where = `asset_units.csv ${u.unit_code || "(no code)"}`;
    if (!active.has(u.product_key)) {
      notActive(where, u.product_key, "unit");
      continue;
    }
    if (!u.unit_code) errors.push(`${where}: unit_code is empty`);
    if (unitCodes.has(u.unit_code)) errors.push(`${where}: duplicate unit_code`);
    if (!CONDITIONS.includes(u.condition)) errors.push(`${where}: condition "${u.condition}" is not one of ${CONDITIONS.join("/")}`);
    if (!UNIT_OWNERSHIP.includes(u.ownership)) errors.push(`${where}: ownership "${u.ownership}" is not one of ${UNIT_OWNERSHIP.join("/")}`);
    if (u.ownership === "owned" && u.loaned_from) errors.push(`${where}: an owned unit cannot have loaned_from`);
    if (!["", "true", "false"].includes(u.labelled)) errors.push(`${where}: labelled must be true, false or empty`);
    if (u.last_checked_on && !ISO_DATE.test(u.last_checked_on)) errors.push(`${where}: last_checked_on must be YYYY-MM-DD`);
    unitCodes.add(u.unit_code);
    unitRows.push(u);
  }

  // --- opening balances ----------------------------------------------------
  const storeSeed = new Map<string, number>();
  const ledgerTotal = new Map<string, number>();
  const balanceRows: Row[] = [];
  for (const b of balances) {
    const where = `opening_balances.csv ${b.product_key} @ ${b.holder_name}`;
    if (!active.has(b.product_key)) {
      notActive(where, b.product_key, "balance");
      continue;
    }
    const qty = Number(b.qty);
    if (!Number.isInteger(qty) || qty <= 0) {
      errors.push(`${where}: qty must be a positive integer`);
      continue;
    }
    if (b.holder_kind === "store") {
      storeSeed.set(b.product_key, (storeSeed.get(b.product_key) ?? 0) + qty);
    } else if (b.holder_kind === "robot") {
      if (!robotNames.has(b.holder_name)) {
        errors.push(`${where}: robot "${b.holder_name}" is not in holders.csv`);
        continue;
      }
    } else {
      errors.push(`${where}: holder_kind must be store or robot`);
      continue;
    }
    ledgerTotal.set(b.product_key, (ledgerTotal.get(b.product_key) ?? 0) + qty);
    balanceRows.push(b);
  }

  // --- open loans ----------------------------------------------------------
  const loanedOut = new Map<string, number>();
  const loanRows: Row[] = [];
  const heldLoans: Row[] = [];
  for (const l of loans) {
    const where = `open_loans.csv ${l.legacy_borrow_id.slice(0, 8)}`;
    if (l.action !== "import") {
      heldLoans.push(l);
      continue;
    }
    if (!active.has(l.product_key)) {
      notActive(where, l.product_key, "loan");
      continue;
    }
    if (!memberEmails.has(l.member_email.toLowerCase())) {
      errors.push(`${where}: member ${l.member_email} is not in members.csv`);
      continue;
    }
    if (!MOVEMENTS.includes(l.movement)) errors.push(`${where}: movement must be borrow or consume`);
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty <= 0) errors.push(`${where}: qty must be a positive integer`);
    if (Number.isNaN(Date.parse(l.borrowed_at))) errors.push(`${where}: borrowed_at is not a timestamp`);
    loanedOut.set(l.product_key, (loanedOut.get(l.product_key) ?? 0) + qty);
    loanRows.push(l);
  }

  // --- cross-file consistency ----------------------------------------------
  for (const key of active) {
    const p = loaded.get(key)!;
    const out = loanedOut.get(key) ?? 0;
    const store = storeSeed.get(key) ?? 0;
    if (out > store) {
      errors.push(`${key}: ${out} going out on loans but only ${store} seeded in the store; holdings would go negative`);
    }
    const ledger = ledgerTotal.get(key) ?? 0;
    if (p.qty_total !== "" && ledger !== Number(p.qty_total)) {
      warnings.push(`${key}: opening balances add up to ${ledger}, qty_total says ${p.qty_total}`);
    }
  }

  // --- review queue --------------------------------------------------------
  const productKeyByName = new Map([...loaded.values()].map((p) => [p.name, p.key]));
  const productKeyByUnit = new Map(units.map((u) => [u.unit_code, u.product_key]));
  const reviewKey = (entity: string, key: string, name: string): string | null => {
    if (entity === "product" && loaded.has(key)) return key;
    if (entity === "unit") {
      const viaUnit = productKeyByUnit.get(key.split(",")[0].trim());
      if (viaUnit && loaded.has(viaUnit)) return viaUnit;
    }
    return productKeyByName.get(name) ?? null;
  };

  const reviewRows: { severity: string; entity: string; subject: string; productKey: string | null; issue: string }[] = [];
  for (const f of flags) {
    if (!SEVERITIES.includes(f.severity)) {
      errors.push(`review_flags.csv "${f.issue.slice(0, 40)}": severity "${f.severity}" is not one of ${SEVERITIES.join("/")}`);
      continue;
    }
    if (!f.issue) continue;
    reviewRows.push({
      severity: f.severity,
      entity: f.entity || "other",
      subject: f.name || f.key || "(unnamed)",
      productKey: reviewKey(f.entity, f.key, f.name),
      issue: f.issue,
    });
  }
  for (const l of heldLoans) {
    reviewRows.push({
      severity: "check",
      entity: "loan",
      subject: l.product_name,
      productKey: loaded.has(l.product_key) ? l.product_key : null,
      issue:
        `Legacy app: ${l.member_legacy_name} has ${l.qty} out since ${l.borrowed_at.slice(0, 10)}. Not imported. ${l.notes} ` +
        "If it really is out, have them borrow it in the Mini App (or count it onto the robot in Stocktake); otherwise resolve this.",
    });
  }

  // --- SQL -----------------------------------------------------------------
  const sql: string[] = [
    `-- Generated by scripts/import-clean-data.ts from ${CLEAN_DIR}/ for the "${schema}" schema. Regenerate rather than edit.`,
    "-- One transaction: all of it lands, or none of it.",
    "begin;",
    // This schema and nothing else: an object missing from it is an error,
    // never a silent write into the other schema.
    `set local search_path = ${schema};`,
  ];
  for (const migration of options.migrationSqls) sql.push("", "-- Catalog migration (rehearsal only).", migration);

  sql.push(
    "",
    "do $$",
    "begin",
    "  if not exists (select 1 from information_schema.columns",
    `                  where table_schema = '${schema}' and table_name = 'products' and column_name = 'criticality') then`,
    `    raise exception 'migration 0024 is not applied to the ${schema} schema';`,
    "  end if;",
    `  if to_regclass('${schema}.review_items') is null then`,
    `    raise exception 'migration 0025 is not applied to the ${schema} schema';`,
    "  end if;",
    "  if exists (select 1 from products where legacy_ref like 'clean:%') then",
    "    raise exception 'data/clean has already been imported into this database';",
    "  end if;",
    "end $$;",
  );

  const values = (rows: string[]) => rows.map((r) => `  (${r})`).join(",\n");

  sql.push(
    "",
    "-- Locations",
    "insert into locations (name)",
    "select v.name from (values",
    values([...locationNames].map((name) => sqlText(name))),
    ") as v(name)",
    "where not exists (select 1 from locations l where lower(l.name) = lower(v.name));",
  );

  sql.push(
    "",
    "-- Robot holders",
    "insert into holders (kind, name)",
    "select 'robot', v.name from (values",
    values([...robotNames].map((name) => sqlText(name))),
    ") as v(name)",
    "where not exists (select 1 from holders h where h.kind = 'robot' and h.name = v.name and h.active);",
  );

  if (memberRows.length) {
    sql.push(
      "",
      "-- Members. The create_member_holder trigger adds each one's personal holder.",
      "insert into members (full_name, display_name, nus_email, telegram_username, role)",
      "select v.full_name, v.display_name, v.nus_email, v.telegram_username, v.role from (values",
      values(
        memberRows.map((m) =>
          [
            sqlText(m.full_name, "::text"),
            sqlText(m.display_name, "::text"),
            sqlText(m.nus_email.toLowerCase(), "::text"),
            sqlText(normalizeTelegramHandle(m.telegram_username) || "", "::text"),
            sqlText(m.role, "::text"),
          ].join(", "),
        ),
      ),
      ") as v(full_name, display_name, nus_email, telegram_username, role)",
      "where not exists (select 1 from members m where lower(m.nus_email) = lower(v.nus_email));",
    );
  }

  sql.push("", "-- Products (held ones inactive, for a reviewer to switch on)");
  const productIds = new Map<string, string>();
  for (const p of loaded.values()) {
    const id = randomUUID();
    productIds.set(p.key, id);
    const held = !active.has(p.key);
    const notes = held ? `Held during the catalog clean-up: see the review queue. ${p.notes}`.trim() : p.notes;
    sql.push(
      "insert into products (id, name, tier, category, location_id, returnable, unit, part_number, spec, notes, criticality, ownership, loaned_from, active, legacy_ref) values (" +
        [
          sqlText(id),
          sqlText(p.name),
          sqlText(p.tier),
          sqlText(p.category),
          locationId(p.location),
          p.returnable,
          sqlText(p.unit),
          sqlText(p.part_number),
          p.spec_json ? sqlText(p.spec_json, "::jsonb") : "null",
          sqlText(notes),
          sqlText(p.criticality),
          sqlText(p.ownership),
          sqlText(p.loaned_from),
          held ? "false" : "true",
          sqlText(`clean:${p.key}; ${p.sources}`),
        ].join(", ") +
        ");",
    );
  }

  sql.push("", "-- Per-unit register");
  for (const u of unitRows) {
    sql.push(
      "insert into asset_units (product_id, unit_code, serial_number, condition, ownership, loaned_from, labelled, last_seen_location, last_checked_on, notes, legacy_ref) values (" +
        [
          sqlText(productIds.get(u.product_key)),
          sqlText(u.unit_code),
          sqlText(u.serial_number),
          sqlText(u.condition),
          sqlText(u.ownership),
          sqlText(u.loaned_from),
          u.labelled || "null",
          sqlText(u.last_seen_location),
          sqlText(u.last_checked_on, "::date"),
          sqlText(u.notes),
          sqlText(u.source),
        ].join(", ") +
        ");",
    );
  }

  sql.push("", `-- Opening balances: adjustment -> store / robot, as of ${OPENING_BALANCE_AT}`);
  for (const b of balanceRows) {
    const to = b.holder_kind === "store" ? HOLDER.store : HOLDER.robot(b.holder_name);
    sql.push(
      "insert into stock_movements (product_id, from_holder_id, to_holder_id, qty, reason, entry_method, created_at) values (" +
        [sqlText(productIds.get(b.product_key)), HOLDER.adjustment, to, b.qty, "'seed'", "'admin'", sqlText(OPENING_BALANCE_AT)].join(", ") +
        ");",
    );
  }

  sql.push("", "-- Open loans from the legacy app, with their original timestamps so overdue tracking is right");
  for (const l of loanRows) {
    const sessionId = randomUUID();
    const email = l.member_email.toLowerCase();
    const at = sqlText(l.borrowed_at, "::timestamptz");
    sql.push(
      "insert into sessions (id, member_id, mode, dest_holder_id, source, started_at, committed_at, note) values (" +
        [
          sqlText(sessionId),
          memberId(email),
          "'borrow'",
          HOLDER.member(email),
          "'admin'",
          at,
          at,
          sqlText(`${LEGACY_SESSION_NOTE} (borrow ${l.legacy_borrow_id.slice(0, 8)})`),
        ].join(", ") +
        ");",
      "insert into stock_movements (product_id, from_holder_id, to_holder_id, qty, session_id, actor_member_id, reason, entry_method, created_at) values (" +
        [
          sqlText(productIds.get(l.product_key)),
          HOLDER.store,
          l.movement === "consume" ? HOLDER.consumed : HOLDER.member(email),
          l.qty,
          sqlText(sessionId),
          memberId(email),
          sqlText(l.movement),
          "'admin'",
          at,
        ].join(", ") +
        ");",
    );
  }

  if (reviewRows.length) {
    sql.push(
      "",
      "-- Review queue",
      "insert into review_items (severity, entity, subject, product_id, issue, source) values",
      values(
        reviewRows.map((r) =>
          [
            sqlText(r.severity),
            sqlText(r.entity),
            sqlText(r.subject),
            r.productKey ? sqlText(productIds.get(r.productKey), "::uuid") : "null::uuid",
            sqlText(r.issue),
            sqlText(REVIEW_SOURCE),
          ].join(", "),
        ),
      ) + ";",
    );
  }

  if (options.rehearse) {
    sql.push(
      "",
      "-- Rehearsal: report, then abort so the whole transaction rolls back.",
      "do $$",
      "declare v_report text;",
      "begin",
      "  select format('products=%s (inactive %s) asset_units=%s robot_holders=%s members=%s seed_movements=%s loan_sessions=%s review_items=%s (linked to a product %s) negative_holdings=%s qty_in_store=%s qty_out=%s',",
      "    (select count(*) from products where legacy_ref like 'clean:%'),",
      "    (select count(*) from products where legacy_ref like 'clean:%' and not active),",
      "    (select count(*) from asset_units),",
      "    (select count(*) from holders where kind = 'robot' and active),",
      "    (select count(*) from members),",
      `    (select count(*) from stock_movements where reason = 'seed' and created_at = ${sqlText(OPENING_BALANCE_AT)}::timestamptz),`,
      `    (select count(*) from sessions where note like ${sqlText(`${LEGACY_SESSION_NOTE}%`)}),`,
      `    (select count(*) from review_items where source = ${sqlText(REVIEW_SOURCE)}),`,
      `    (select count(*) from review_items where source = ${sqlText(REVIEW_SOURCE)} and product_id is not null),`,
      "    (select count(*) from holdings h join holders hd on hd.id = h.holder_id where hd.kind in ('store', 'robot', 'member') and h.qty < 0),",
      "    (select coalesce(sum(qty_in_store), 0) from stock_summary),",
      "    (select coalesce(sum(qty_out), 0) from stock_summary)",
      "  ) into v_report;",
      "  raise exception 'IMPORT REHEARSAL OK, rolled back: %', v_report;",
      "end $$;",
    );
  } else {
    sql.push("", "commit;");
  }

  return {
    sql: sql.join("\n") + "\n",
    errors,
    warnings,
    counts: {
      locations: locationNames.size,
      robotHolders: robotNames.size,
      members: memberRows.length,
      products: loaded.size,
      heldProducts: loaded.size - active.size,
      assetUnits: unitRows.length,
      openingBalances: balanceRows.length,
      loans: loanRows.length,
      reviewItems: reviewRows.length,
    },
  };
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  const args = new Set(process.argv.slice(2));
  const rehearse = args.has("--rehearse");
  const withMigration = args.has("--with-migration");
  const schemaArg = process.argv[process.argv.indexOf("--schema") + 1];
  const schema = process.argv.includes("--schema") ? schemaArg : "public";
  if (schema !== "public" && schema !== "test") {
    console.error('--schema must be "public" or "test".');
    process.exit(1);
  }
  if (withMigration && (!rehearse || schema !== "public")) {
    console.error("--with-migration is only for --rehearse against public. Use scripts/migrate.ts for real migrations.");
    process.exit(1);
  }

  const plan = buildImport(CLEAN_DIR, {
    rehearse,
    schema,
    migrationSqls: withMigration ? CATALOG_MIGRATIONS.map((file) => readFileSync(file, "utf-8")) : [],
  });
  for (const warning of plan.warnings) console.warn(`warning: ${warning}`);
  if (plan.errors.length) {
    for (const error of plan.errors) console.error(`error: ${error}`);
    console.error(`\n${plan.errors.length} error(s); no SQL written.`);
    process.exit(1);
  }

  // The schema is in the file name: import.sql is always the one for public.
  const out = path.join(CLEAN_DIR, `import${schema === "test" ? ".test" : ""}${rehearse ? ".rehearse" : ""}.sql`);
  writeFileSync(out, plan.sql, "utf-8");
  console.log(JSON.stringify(plan.counts, null, 2));
  console.log(`\nWrote ${out} (${plan.warnings.length} warning(s)).`);
  console.log(
    rehearse
      ? `Rehearse (always rolls back): supabase db query --linked -f ${out}`
      : `Apply: supabase db query --linked -f ${out}`,
  );
}
