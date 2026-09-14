import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { dbSchema } from "@/lib/supabase/schema";

import { isApplied, sqlForSchema, wrapMigration } from "../../scripts/lib/schema-migrations";

/**
 * The public/test schema split: which schema the app talks to, and how the
 * migrations written for `public` are replayed into `test` without anything
 * in `test` still pointing at the real data.
 */

describe("dbSchema", () => {
  const original = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
  afterEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_SCHEMA = original;
  });

  it("is `test` under vitest, so no test can reach the real inventory", () => {
    expect(dbSchema()).toBe("test");
  });

  it("defaults to public and refuses anything unknown", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_SCHEMA;
    expect(dbSchema()).toBe("public");
    process.env.NEXT_PUBLIC_SUPABASE_SCHEMA = "tset";
    expect(() => dbSchema()).toThrow(/must be "public" or "test"/);
  });
});

describe("sqlForSchema", () => {
  it("leaves public migrations untouched", () => {
    const sql = "create function f() returns int language sql set search_path = public as $$ select 1 $$;";
    expect(sqlForSchema(sql, "public")).toBe(sql);
  });

  it("repins functions and qualifiers to test, but not the PUBLIC role or prose", () => {
    const sql = [
      "create or replace function is_staff() returns boolean language sql stable security definer set search_path = public as $$ select true $$;",
      "alter function set_updated_at() set search_path = public;",
      "select * from public.products;",
      "revoke execute on function is_staff() from public, anon;",
      "-- anyone holding the public anon key",
    ].join("\n");
    const out = sqlForSchema(sql, "test");
    expect(out).toContain("set search_path = test as $$");
    expect(out).toContain("alter function set_updated_at() set search_path = test;");
    expect(out).toContain("from test.products");
    expect(out).toContain("from public, anon;");
    expect(out).toContain("the public anon key");
  });

  it("leaves no function in any real migration pinned to public", () => {
    const dir = path.resolve(process.cwd(), "supabase/migrations");
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".sql"))) {
      const out = sqlForSchema(readFileSync(path.join(dir, file), "utf-8"), "test");
      expect(out, file).not.toMatch(/search_path\s*(=|to)\s*public\b/i);
      expect(out, file).not.toMatch(/\bpublic\.[a-z_]/i);
    }
  });
});

describe("migration bookkeeping", () => {
  it("recognises both naming styles already in public's history", () => {
    const recorded = new Set(["0015_stock_summary_fix", "function_search_path"]);
    expect(isApplied("0015_stock_summary_fix.sql", recorded)).toBe(true);
    expect(isApplied("0011_function_search_path.sql", recorded)).toBe(true);
    expect(isApplied("0024_catalog_import_ownership_criticality_roles.sql", recorded)).toBe(false);
  });

  it("runs a test migration with test as the only search_path, atomically", () => {
    const sql = wrapMigration("test", "0024_x.sql", "create table t (id int);", "20260914000000");
    expect(sql.startsWith("begin;\nset local search_path = test;")).toBe(true);
    expect(sql).toContain("insert into supabase_migrations.test_schema_migrations (version, name) values ('0024', '0024_x');");
    expect(sql.trim().endsWith("commit;")).toBe(true);
  });

  it("records public migrations with a timestamp version", () => {
    const sql = wrapMigration("public", "0025_y.sql", "select 1;", "20260914000001");
    expect(sql).not.toContain("search_path = test");
    expect(sql).toContain("supabase_migrations.schema_migrations (version, name) values ('20260914000001', '0025_y');");
  });
});
