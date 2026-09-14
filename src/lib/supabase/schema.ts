/**
 * Which Postgres schema the app reads and writes.
 *
 * One Supabase project, two schemas:
 *   public -- the real inventory. What the deployed app uses.
 *   test   -- an identical copy (same migrations, a snapshot of the real
 *             catalog, plus test-only accounts) that the integration tests
 *             mutate freely. See docs/tele-qr/architecture.md, "Test schema".
 *
 * Unset means `public`, the right answer for the deployed app. Tests opt in
 * to `test` in vitest.config.ts. Anything else throws: a typo must not send
 * a test suite to the real ledger.
 *
 * Read as the literal `process.env.NEXT_PUBLIC_SUPABASE_SCHEMA` so Next.js
 * inlines it into the browser bundle.
 */
export const DB_SCHEMAS = ["public", "test"] as const;
export type DbSchema = (typeof DB_SCHEMAS)[number];

export function dbSchema(): DbSchema {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_SCHEMA?.trim();
  if (!raw) return "public";
  if (raw === "public" || raw === "test") return raw;
  throw new Error(`NEXT_PUBLIC_SUPABASE_SCHEMA must be "public" or "test", got "${raw}".`);
}

/**
 * The `db.schema` client option. `test` is built from the same migrations as
 * `public`, so the generated `public` types describe it exactly; the cast only
 * keeps supabase-js's schema-generic types pointed at the one set of types
 * this repo generates.
 */
export function dbSchemaOption(): { schema: "public" } {
  return { schema: dbSchema() as "public" };
}
