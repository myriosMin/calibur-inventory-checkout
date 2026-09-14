/**
 * Applying the repo's migrations to either schema of the one Supabase project
 * (see src/lib/supabase/schema.ts). Pure string building, so it is tested.
 *
 * Every migration is written against `public`. For `test` the rewrite is
 * deliberately tiny:
 *   - functions pinned with `search_path = public` are pinned to `test`
 *   - explicit `public.` qualifiers become `test.`
 *   - the migration runs with `search_path = test` and NOTHING else, so an
 *     object missing from `test` is an error instead of a silent read of the
 *     real data in `public`
 * Views, policies and triggers bind to objects when they are created, so
 * they come out pointing at `test` for free. verifyTestIsolationSql() checks
 * all of that after the fact rather than trusting it.
 */

export type MigrationSchema = "public" | "test";

export function sqlForSchema(sql: string, schema: MigrationSchema): string {
  if (schema === "public") return sql;
  return sql
    .replace(/search_path\s*(=|to)\s*public\b/gi, `search_path = ${schema}`)
    .replace(/\bpublic\.(?=[a-z_"])/gi, `${schema}.`);
}

/** Bookkeeping row for one migration file (e.g. "0024_catalog_import_...sql"). */
export function bookkeepingSql(schema: MigrationSchema, file: string, timestampVersion: string): string {
  const base = file.replace(/\.sql$/, "");
  const name = base.replace(/'/g, "''");
  return schema === "public"
    ? `insert into supabase_migrations.schema_migrations (version, name) values ('${timestampVersion}', '${name}');`
    : `insert into supabase_migrations.test_schema_migrations (version, name) values ('${base.slice(0, 4)}', '${name}');`;
}

/** One migration, atomically, with its bookkeeping row. */
export function wrapMigration(schema: MigrationSchema, file: string, body: string, timestampVersion: string): string {
  return [
    "begin;",
    schema === "test" ? "set local search_path = test;" : "",
    sqlForSchema(body, schema),
    `set local search_path = public;`,
    bookkeepingSql(schema, file, timestampVersion),
    "commit;",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Was this file already applied? `public`'s history mixes names recorded by
 * different tools: "0015_stock_summary_fix" and, for 0011-0014, the bare
 * "function_search_path".
 */
export function isApplied(file: string, recordedNames: Set<string>): boolean {
  const base = file.replace(/\.sql$/, "");
  return recordedNames.has(base) || recordedNames.has(base.replace(/^\d{4}_/, ""));
}

/**
 * The test schema's container. Default privileges mirror what `public` has
 * on this project (pg_default_acl for role postgres): API roles get table,
 * sequence and function rights on creation, and each migration's own
 * REVOKEs then narrow them exactly as they did in `public`.
 */
export const BOOTSTRAP_TEST_SCHEMA_SQL = `
create schema if not exists test;
grant usage on schema test to anon, authenticated, service_role;
alter default privileges for role postgres in schema test grant all on tables to anon, authenticated, service_role;
alter default privileges for role postgres in schema test grant all on sequences to anon, authenticated, service_role;
alter default privileges for role postgres in schema test grant all on functions to anon, authenticated, service_role;
create table if not exists supabase_migrations.test_schema_migrations (
  version text primary key,
  name text not null,
  applied_at timestamptz not null default now()
);
`;

export const RESET_TEST_SCHEMA_SQL = `
drop schema if exists test cascade;
delete from supabase_migrations.test_schema_migrations;
`;

/**
 * Anything in `test` that still reaches into `public`. Must return no rows.
 * Checks functions pinned elsewhere (or not pinned at all), views, policies,
 * triggers and foreign keys.
 */
export const VERIFY_TEST_ISOLATION_SQL = `
select 'function search_path' as kind, p.proname as object, coalesce(array_to_string(p.proconfig, ','), 'unpinned') as detail
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'test'
   and not coalesce('search_path=test' = any(p.proconfig), false)
union all
select 'view -> public', v.relname, t.relname
  from pg_rewrite r
  join pg_class v on v.oid = r.ev_class
  join pg_namespace vn on vn.oid = v.relnamespace and vn.nspname = 'test'
  join pg_depend d on d.classid = 'pg_rewrite'::regclass and d.objid = r.oid and d.refclassid = 'pg_class'::regclass
  join pg_class t on t.oid = d.refobjid
  join pg_namespace tn on tn.oid = t.relnamespace and tn.nspname = 'public'
union all
select 'policy -> public function', c.relname || '.' || pol.polname, p.proname
  from pg_policy pol
  join pg_class c on c.oid = pol.polrelid
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'test'
  join pg_depend d on d.classid = 'pg_policy'::regclass and d.objid = pol.oid and d.refclassid = 'pg_proc'::regclass
  join pg_proc p on p.oid = d.refobjid
  join pg_namespace pn on pn.oid = p.pronamespace and pn.nspname = 'public'
union all
select 'trigger -> public function', c.relname || '.' || tg.tgname, p.proname
  from pg_trigger tg
  join pg_class c on c.oid = tg.tgrelid
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'test'
  join pg_proc p on p.oid = tg.tgfoid
  join pg_namespace pn on pn.oid = p.pronamespace and pn.nspname = 'public'
 -- Internal triggers are Postgres's own foreign-key enforcement (pg_catalog RI_FKey_*).
 where not tg.tgisinternal
union all
select 'foreign key -> public', c.relname || '.' || con.conname, t.relname
  from pg_constraint con
  join pg_class c on c.oid = con.conrelid
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'test'
  join pg_class t on t.oid = con.confrelid
  join pg_namespace tn on tn.oid = t.relnamespace and tn.nspname = 'public'
 where con.contype = 'f';
`;
