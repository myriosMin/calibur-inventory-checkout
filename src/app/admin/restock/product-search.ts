/**
 * Building the PostgREST `.or()` filter for the restock product picker.
 *
 * Two separate escaping passes are needed and it is easy to remember only
 * one, so this lives in its own tested module:
 *
 *  1. `%`, `_` and `\` are LIKE wildcards. Unescaped, a search for "100%"
 *     matches everything.
 *  2. `.or()` takes a *raw PostgREST filter string* in which commas and
 *     parentheses are syntax. A value containing either must be double-quoted,
 *     with `"` and `\` backslash-escaped inside the quotes -- otherwise a
 *     product name with a comma in it turns one filter into two malformed ones.
 *
 * `/api/store/search` sidesteps this by issuing one `.ilike()` per column and
 * merging in application code, which is the safest option when the column
 * list is long. Here it is three text columns on one small table and a
 * round-trip per keystroke matters, so the filter is built explicitly instead
 * -- verified against the live project with commas, parentheses, quotes,
 * backslashes and bare wildcards, none of which produce an error.
 */

/** Columns the picker searches, in the order a match is most likely. */
export const PRODUCT_SEARCH_COLUMNS = ["name", "part_number", "category"] as const;

export function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** Wraps a filter value so commas, parens and spaces are data, not syntax. */
export function quoteOrFilterValue(value: string): string {
  return `"${value.replace(/["\\]/g, (char) => `\\${char}`)}"`;
}

/**
 * "GM60" -> `name.ilike."%GM60%",part_number.ilike."%GM60%",category.ilike."%GM60%"`
 */
export function buildProductSearchFilter(rawQuery: string): string {
  const pattern = quoteOrFilterValue(`%${escapeLikePattern(rawQuery.trim())}%`);
  return PRODUCT_SEARCH_COLUMNS.map((column) => `${column}.ilike.${pattern}`).join(
    ",",
  );
}
