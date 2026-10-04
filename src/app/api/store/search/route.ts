import { requireMember } from "@/lib/server/member-auth";
import { getServiceRoleClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/types/database";

export const runtime = "nodejs";

type ProductRow = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  "id" | "name" | "tier" | "unit" | "category" | "spec" | "expensive"
>;

const RESULT_LIMIT = 20;
// `expensive` (0028) so the cart can tell the member the part is tracked.
const SELECT_COLUMNS = "id, name, tier, unit, category, spec, expensive";

/**
 * Escapes the SQL LIKE/ILIKE special characters (`%`, `_`, and the escape
 * character `\` itself) in user-supplied search text before it gets wrapped
 * in wildcards, so a literal `%` or `_` typed by the member behaves as a
 * literal character rather than a wildcard.
 */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/**
 * GET /api/store/search?q=<string>
 *
 * Searches active products by name substring or by a match anywhere inside
 * the product's `spec` jsonb values, so e.g. a search for "10k" finds a
 * resistor whose `spec.value` is "10k" even when "10k" never appears in the
 * product's `name`. Empty/whitespace `q` returns an empty result set rather
 * than an error -- that's the UI's default state before the member has
 * typed anything.
 */
export async function GET(request: Request) {
  const auth = await requireMember(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const rawQuery = url.searchParams.get("q") ?? "";
  const q = rawQuery.trim();

  if (!q) {
    return Response.json({ items: [] });
  }

  const supabase = getServiceRoleClient();
  const pattern = `%${escapeLikePattern(q)}%`;

  // Two separate queries, unioned and deduped in application code, rather
  // than a single `.or()` call -- `.or()` takes a raw PostgREST filter
  // string where commas/parens are syntactically meaningful, so building it
  // out of arbitrary user input would need a second, different escaping
  // pass. `.ilike()` on the `name` column keeps every user-supplied
  // character confined to a single, safely-escaped LIKE pattern value.
  //
  // The `spec` jsonb side can't be pushed down the same way: PostgREST only
  // applies a `column::type` cast inside `select`, not inside a filter (a
  // live check against this project confirms `?spec::text=ilike.*x*`
  // fails with `42883: operator does not exist: jsonb ~~* unknown` --
  // the ilike operator gets resolved against the column's underlying jsonb
  // type before any cast is applied). So the spec side is matched in
  // application code instead: fetch active products that have a spec at
  // all, then test whether `q` appears anywhere in its stringified values.
  // This still goes through the query builder end-to-end -- no raw SQL,
  // and no user input is ever interpolated into a query string.
  const [nameResult, specCandidatesResult] = await Promise.all([
    supabase
      .from("products")
      .select(SELECT_COLUMNS)
      .eq("active", true)
      .ilike("name", pattern)
      .limit(RESULT_LIMIT),
    supabase
      .from("products")
      .select(SELECT_COLUMNS)
      .eq("active", true)
      .not("spec", "is", null),
  ]);

  if (nameResult.error) throw nameResult.error;
  if (specCandidatesResult.error) throw specCandidatesResult.error;

  const qLower = q.toLowerCase();
  const specMatches = specCandidatesResult.data.filter((row) =>
    JSON.stringify(row.spec).toLowerCase().includes(qLower),
  );

  const byId = new Map<string, ProductRow>();
  for (const row of [...nameResult.data, ...specMatches]) {
    byId.set(row.id, row);
  }

  const items = Array.from(byId.values())
    .sort((a, b) => {
      // Simple relevance proxy: exact prefix match on `name` first, then
      // everything else (substring-only, or spec-only matches).
      const aPrefix = a.name.toLowerCase().startsWith(qLower) ? 0 : 1;
      const bPrefix = b.name.toLowerCase().startsWith(qLower) ? 0 : 1;
      if (aPrefix !== bPrefix) return aPrefix - bPrefix;
      return a.name.localeCompare(b.name);
    })
    .slice(0, RESULT_LIMIT);

  return Response.json({ items });
}
