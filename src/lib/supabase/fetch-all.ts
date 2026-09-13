/**
 * PostgREST caps every response at the project's max-rows (1000 on hosted
 * Supabase) and returns the truncated list WITHOUT an error -- the silent
 * truncation checkpoint.md already recorded twice for admin reads. This pages
 * until a short page comes back.
 *
 * The query must have a stable `.order()` (ideally ending on a unique
 * column), or rows can shift between pages and be skipped or repeated.
 *
 *   const rows = await fetchAllRows((from, to) =>
 *     supabase.from("products").select("*").order("name").order("id").range(from, to));
 */
export async function fetchAllRows<T>(
  fetchPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await fetchPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
