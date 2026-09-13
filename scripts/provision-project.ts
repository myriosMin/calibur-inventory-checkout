/**
 * Loads the schema -- every migration, in order -- into a NEW, empty
 * Supabase project, and optionally runs one more SQL file against it,
 * without touching this checkout's link to the dev project.
 *
 *   npx tsx scripts/provision-project.ts --project-ref <ref> [--dry-run] [--run <file.sql>]
 *
 * - Needs `supabase login` (it goes through the Management API, like every
 *   other `db query --linked` in this repo). No database password, no port 5432.
 * - The link lives in a scratch --workdir, so supabase/.temp here keeps
 *   pointing at dev.
 * - Each migration runs in its own transaction together with its
 *   supabase_migrations.schema_migrations row, under the repo's file prefix
 *   ("0024"), so `supabase migration list` against the new project agrees
 *   with the repo. A re-run skips what is already recorded.
 * - --run executes a file after the migrations, e.g. the output of
 *   `scripts/import-clean-data.ts` (import.rehearse.sql first, then import.sql).
 * - Deliberately does NOT seed dev fixtures.
 */

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const MIGRATIONS_DIR = "supabase/migrations";

function fail(message: string): never {
  console.error(`provision-project: ${message}`);
  process.exit(1);
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const projectRef = arg("--project-ref");
const runFile = arg("--run");
const dryRun = process.argv.includes("--dry-run");
if (!projectRef || !/^[a-z]{20}$/.test(projectRef)) {
  fail("Usage: npx tsx scripts/provision-project.ts --project-ref <20-letter ref> [--dry-run] [--run <file.sql>]");
}
if (existsSync("supabase/.temp/project-ref") && projectRef === readFileSync("supabase/.temp/project-ref", "utf-8").trim()) {
  fail(`${projectRef} is the dev project this checkout is linked to. Provision a NEW project.`);
}
if (runFile && !existsSync(runFile)) fail(`--run file ${runFile} not found`);

const workdir = mkdtempSync(path.join(tmpdir(), `calibur-provision-${projectRef}-`));
mkdirSync(path.join(workdir, "supabase", ".temp"), { recursive: true });
writeFileSync(path.join(workdir, "supabase", ".temp", "project-ref"), projectRef);
if (existsSync("supabase/config.toml")) copyFileSync("supabase/config.toml", path.join(workdir, "supabase", "config.toml"));

function query(sqlFile: string): { ok: boolean; output: string } {
  const result = spawnSync("supabase", ["--workdir", workdir, "db", "query", "--linked", "-f", sqlFile], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return { ok: result.status === 0, output: `${result.stdout ?? ""}${result.stderr ?? ""}` };
}

function querySql(sql: string): { ok: boolean; output: string } {
  const file = path.join(workdir, `q-${Date.now()}-${Math.random().toString(36).slice(2)}.sql`);
  writeFileSync(file, sql);
  return query(file);
}

const migrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d{4}_.+\.sql$/.test(f))
  .sort();

const setup = querySql(`
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (
  version text primary key, statements text[], name text
);
select coalesce(string_agg(version, ',' order by version), '') as applied
  from supabase_migrations.schema_migrations;
`);
if (!setup.ok) fail(`could not reach project ${projectRef} (did you run \`supabase login\`?)\n${setup.output}`);
const applied = new Set((/"applied":\s*"([^"]*)"/.exec(setup.output)?.[1] ?? "").split(",").filter(Boolean));

const pending = migrations.filter((f) => !applied.has(f.slice(0, 4)));
console.log(`${migrations.length} migrations in the repo, ${applied.size} recorded on ${projectRef}, ${pending.length} to apply.`);
if (dryRun) {
  for (const f of pending) console.log(`  would apply ${f}`);
  if (runFile) console.log(`  would then run ${runFile}`);
  process.exit(0);
}

if (applied.size === 0) {
  const probe = querySql("select to_regclass('public.products') is not null as has_products;");
  if (/"has_products":\s*true/.test(probe.output)) {
    fail("this project already has a products table but no recorded migrations. Refusing to guess.");
  }
}

for (const file of pending) {
  const version = file.slice(0, 4);
  const name = file.slice(5, -4);
  const body = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
  const wrapped = `begin;\n${body}\ninsert into supabase_migrations.schema_migrations (version, name) values ('${version}', '${name.replace(/'/g, "''")}');\ncommit;\n`;
  const result = querySql(wrapped);
  if (!result.ok) fail(`${file} failed and was rolled back; nothing after it was applied.\n${result.output}`);
  console.log(`  applied ${file}`);
}

const check = querySql("select count(*) as pseudo_holders from holders where kind in ('store','consumed','adjustment') and active;");
if (!/"pseudo_holders":\s*3/.test(check.output)) fail(`unexpected schema state:\n${check.output}`);
console.log("Schema ready: store/consumed/adjustment holders exist.");

if (runFile) {
  const result = query(path.resolve(runFile));
  // A rehearsal ends by raising an exception on purpose; that is its success.
  const rehearsal = /REHEARSAL OK/.exec(result.output);
  if (rehearsal) {
    console.log(result.output.match(/IMPORT REHEARSAL OK[^\\"]*/)?.[0] ?? "Rehearsal OK (rolled back).");
  } else if (!result.ok) {
    fail(`${runFile} failed and was rolled back.\n${result.output}`);
  } else {
    console.log(`Ran ${runFile}.`);
  }
}
