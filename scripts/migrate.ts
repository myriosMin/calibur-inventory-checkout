/**
 * Applies supabase/migrations/*.sql to one schema of the linked project.
 *
 *   npx tsx scripts/migrate.ts --schema public [--dry-run]
 *   npx tsx scripts/migrate.ts --schema test [--reset] [--dry-run]
 *
 * One Supabase project, two schemas (src/lib/supabase/schema.ts):
 *   public -- the real inventory; what the deployed app reads
 *   test   -- an identical copy the integration tests mutate
 * Every new migration goes to BOTH: run this twice.
 *
 * Goes through `supabase db query --linked` (Management API) because
 * `supabase db push` does not work from this machine (checkpoint.md). Each
 * migration runs in one transaction with its bookkeeping row:
 *   public -> supabase_migrations.schema_migrations (as 0015-0023 were)
 *   test   -> supabase_migrations.test_schema_migrations
 * For `test` it then verifies nothing in the schema reaches into `public`.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  BOOTSTRAP_TEST_SCHEMA_SQL,
  RESET_TEST_SCHEMA_SQL,
  VERIFY_TEST_ISOLATION_SQL,
  isApplied,
  wrapMigration,
  type MigrationSchema,
} from "./lib/schema-migrations";

const MIGRATIONS_DIR = "supabase/migrations";
const scratch = mkdtempSync(path.join(tmpdir(), "calibur-migrate-"));

function fail(message: string): never {
  console.error(`migrate: ${message}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Runs SQL through the CLI. Returns parsed result rows (possibly empty). */
function run(sql: string): Record<string, unknown>[] {
  const file = path.join(scratch, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, sql);
  const result = spawnSync("supabase", ["db", "query", "--linked", "-f", file], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`${result.stdout ?? ""}${result.stderr ?? ""}`.trim());
  try {
    const parsed: unknown = JSON.parse(result.stdout);
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    if (parsed && typeof parsed === "object" && Array.isArray((parsed as { rows?: unknown }).rows)) {
      return (parsed as { rows: Record<string, unknown>[] }).rows;
    }
  } catch {
    /* statements with no result set print nothing parseable */
  }
  return [];
}

function timestampVersion(offsetSeconds: number): string {
  const d = new Date(Date.now() + offsetSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`;
}

const schema = arg("--schema") as MigrationSchema | undefined;
const dryRun = process.argv.includes("--dry-run");
const reset = process.argv.includes("--reset");
if (schema !== "public" && schema !== "test") fail("Usage: npx tsx scripts/migrate.ts --schema public|test [--reset] [--dry-run]");
if (reset && schema !== "test") fail("--reset only exists for the test schema.");

const files = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();

try {
  if (schema === "test") {
    if (reset && !dryRun) {
      run(RESET_TEST_SCHEMA_SQL);
      console.log("Dropped the test schema.");
    }
    if (!dryRun) run(BOOTSTRAP_TEST_SCHEMA_SQL);
  }

  const table = schema === "public" ? "schema_migrations" : "test_schema_migrations";
  const exists = run(`select to_regclass('supabase_migrations.${table}') is not null as present;`)[0]?.present === true;
  const recorded = exists
    ? new Set(run(`select name from supabase_migrations.${table};`).map((r) => String(r.name)))
    : new Set<string>();

  const pending = files.filter((f) => !isApplied(f, recorded));
  console.log(`${schema}: ${files.length} migrations in the repo, ${files.length - pending.length} applied, ${pending.length} pending.`);
  if (dryRun) {
    for (const f of pending) console.log(`  would apply ${f}`);
    process.exit(0);
  }

  pending.forEach((file, i) => {
    const body = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    try {
      run(wrapMigration(schema, file, body, timestampVersion(i)));
    } catch (error) {
      fail(`${file} failed and was rolled back; nothing after it was applied.\n${(error as Error).message}`);
    }
    console.log(`  applied ${file}`);
  });

  run("notify pgrst, 'reload schema';");

  if (schema === "test") {
    const problems = run(VERIFY_TEST_ISOLATION_SQL);
    if (problems.length) {
      for (const p of problems) console.error(`  ${p.kind}: ${p.object} (${p.detail})`);
      fail(`${problems.length} object(s) in the test schema still reach outside it. Do not run tests against it.`);
    }
    console.log("Isolation verified: nothing in test reaches into public.");
  }
} catch (error) {
  fail((error as Error).message);
}
