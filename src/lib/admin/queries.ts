"use client";

import useSWR, { mutate as globalMutate, type SWRConfiguration } from "swr";

import type { StockCountRow } from "@/app/admin/stocktake/variance";
import {
  fetchBindQueueDepth,
  fetchStockLevels,
  type ProductRef as ReportProductRef,
  type ScanCodeRef,
} from "@/lib/reports/queries";
import { fetchAllRows } from "@/lib/supabase/fetch-all";
import { getBrowserClient } from "@/lib/supabase/browser";
import type { Database } from "@/lib/types/database";

/**
 * The shared /admin reads, cached by SWR.
 *
 * Before this, every admin page loaded its own copy of products, locations,
 * holders and members on mount, and loaded all of them again after every
 * save. The admin layout stays mounted across client navigation, so one
 * cache under it (see ./swr.tsx) lets Products -> Holdings -> Products reuse
 * what was already fetched, and revalidate it quietly in the background.
 *
 * Every list goes through fetchAllRows with an order ending on a unique
 * column: PostgREST stops at 1000 rows without saying so, and a stock page
 * that is silently short is worse than a slow one.
 *
 * After a write, revalidate the one key it touched (`revalidate(KEYS.x)`), or
 * write the returned row straight into the cache with `mutate`. Never reload
 * every list.
 */

type Tables = Database["public"]["Tables"];
type Views = Database["public"]["Views"];

export type ProductRow = Tables["products"]["Row"];
export type LocationRow = Tables["locations"]["Row"];
export type HolderRow = Tables["holders"]["Row"];
export type MemberRow = Tables["members"]["Row"];
export type ScanCodeRow = Tables["scan_codes"]["Row"];
export type ReviewItemRow = Tables["review_items"]["Row"];
export type HoldingViewRow = Views["holdings"]["Row"];
export type StockCountDbRow = Tables["stock_counts"]["Row"];
export type BuildListRow = Tables["build_lists"]["Row"];
export type BuildListLineRow = Tables["build_list_lines"]["Row"];

export const KEYS = {
  isAdmin: "admin/is-admin",
  badges: "admin/badges",
  products: "admin/products",
  locations: "admin/locations",
  holders: "admin/holders",
  members: "admin/members",
  scanCodes: "admin/scan-codes",
  reviewItems: "admin/review-items",
  holdings: "admin/holdings",
  stockLevels: "admin/stock-levels",
  stockCounts: "admin/stock-counts",
  buildLists: "admin/build-lists",
  buildListLines: "admin/build-list-lines",
} as const;

export type AdminKey = (typeof KEYS)[keyof typeof KEYS];

/** Re-fetch one cached list after a write that changed it. */
export function revalidate(key: AdminKey): Promise<unknown> {
  return globalMutate(key);
}

/**
 * Put a row a write just returned straight into a cached list (insert or
 * replace by id), then revalidate in the background. The UI shows the
 * change at once, with no full reload and no flash of the old list.
 */
export function upsertCached<T extends { id: string | number }>(key: AdminKey, row: T): Promise<unknown> {
  return globalMutate<T[]>(
    key,
    (current) => {
      const list = current ?? [];
      const at = list.findIndex((item) => item.id === row.id);
      if (at === -1) return [...list, row];
      const next = list.slice();
      next[at] = { ...next[at], ...row };
      return next;
    },
    { revalidate: true },
  );
}

/** Drop every cached read -- on sign-out, so the next account starts clean. */
export function clearAdminCache(): Promise<unknown> {
  return globalMutate(() => true, undefined, { revalidate: false });
}

function db() {
  return getBrowserClient();
}

// Reference lists change rarely and are read by most pages: hold them a
// little longer before a background revalidate.
const REFERENCE: SWRConfiguration = { dedupingInterval: 60_000 };

export function useIsAdmin() {
  return useSWR(
    KEYS.isAdmin,
    async () => {
      const { data, error } = await db().rpc("is_admin");
      if (error) throw new Error(error.message);
      return data === true;
    },
    { dedupingInterval: 5 * 60_000, revalidateOnFocus: false },
  );
}

export interface NavBadges {
  openReview: number;
  bindQueue: number;
}

/** Count-only reads (no rows transferred) for the sidebar badges. */
export function useNavBadges() {
  return useSWR<NavBadges>(KEYS.badges, async () => {
    const [review, bindQueue] = await Promise.all([
      db().from("review_items").select("*", { count: "exact", head: true }).eq("status", "open"),
      fetchBindQueueDepth(db()),
    ]);
    if (review.error) throw new Error(review.error.message);
    return { openReview: review.count ?? 0, bindQueue };
  });
}

export function useProducts() {
  return useSWR<ProductRow[]>(
    KEYS.products,
    () =>
      fetchAllRows<ProductRow>((from, to) =>
        db().from("products").select("*").order("name").order("id").range(from, to),
      ),
    REFERENCE,
  );
}

export function useLocations() {
  return useSWR<LocationRow[]>(
    KEYS.locations,
    () =>
      fetchAllRows<LocationRow>((from, to) =>
        db().from("locations").select("*").order("name").order("id").range(from, to),
      ),
    REFERENCE,
  );
}

export function useHolders() {
  return useSWR<HolderRow[]>(
    KEYS.holders,
    () =>
      fetchAllRows<HolderRow>((from, to) =>
        db().from("holders").select("*").order("name").order("id").range(from, to),
      ),
    REFERENCE,
  );
}

export function useMembers() {
  return useSWR<MemberRow[]>(
    KEYS.members,
    () =>
      fetchAllRows<MemberRow>((from, to) =>
        db().from("members").select("*").order("full_name").order("id").range(from, to),
      ),
    REFERENCE,
  );
}

export function useScanCodes() {
  return useSWR<ScanCodeRow[]>(KEYS.scanCodes, () =>
    fetchAllRows<ScanCodeRow>((from, to) =>
      db().from("scan_codes").select("*").order("created_at", { ascending: false }).order("code").range(from, to),
    ),
  );
}

export function useReviewItems() {
  return useSWR<ReviewItemRow[]>(KEYS.reviewItems, () =>
    fetchAllRows<ReviewItemRow>((from, to) =>
      db().from("review_items").select("*").order("id").range(from, to),
    ),
  );
}

/** One row per (product, holder) with a non-zero balance -- the ledger summed. */
export function useHoldings() {
  return useSWR<HoldingViewRow[]>(KEYS.holdings, () =>
    fetchAllRows<HoldingViewRow>((from, to) =>
      db()
        .from("holdings")
        .select("product_id, holder_id, qty")
        .order("product_id")
        .order("holder_id")
        .range(from, to),
    ),
  );
}

export function useStockLevels() {
  return useSWR(KEYS.stockLevels, () => fetchStockLevels(db()));
}

/** Every stocktake count line, newest first: the variance report's input. */
export function useStockCounts() {
  return useSWR<StockCountDbRow[]>(KEYS.stockCounts, () =>
    fetchAllRows<StockCountDbRow>((from, to) =>
      db().from("stock_counts").select("*").order("created_at", { ascending: false }).order("id").range(from, to),
    ),
  );
}

export function useBuildLists() {
  return useSWR<BuildListRow[]>(KEYS.buildLists, () =>
    fetchAllRows<BuildListRow>((from, to) =>
      db().from("build_lists").select("*").order("season", { ascending: false }).order("name").order("id").range(from, to),
    ),
  );
}

/** Every line of every build list, in sheet order (migration 0027). */
export function useBuildListLines() {
  return useSWR<BuildListLineRow[]>(KEYS.buildListLines, () =>
    fetchAllRows<BuildListLineRow>((from, to) =>
      db().from("build_list_lines").select("*").order("build_list_id").order("position").range(from, to),
    ),
  );
}

/**
 * Every write to stock (restock, stocktake, reverse, a cart) moves these
 * together, so they are revalidated together.
 */
export function revalidateStock(): Promise<unknown> {
  return Promise.all([
    revalidate(KEYS.holdings),
    revalidate(KEYS.stockLevels),
    revalidate(KEYS.stockCounts),
    revalidate(KEYS.badges),
  ]);
}

// ---------------------------------------------------------------------------
// Adapters: cached DB rows -> the camelCase shapes src/lib/reports/* takes.
// One cached `products` list feeds every page, instead of each report
// fetching its own narrower copy.
// ---------------------------------------------------------------------------

export function toReportProducts(rows: readonly ProductRow[]): ReportProductRef[] {
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    tier: row.tier,
    unit: row.unit,
    returnable: row.returnable,
    minStock: row.min_stock,
    locationId: row.location_id,
    category: row.category,
    partNumber: row.part_number,
    active: row.active,
  }));
}

export function toScanCodeRefs(rows: readonly ScanCodeRow[]): ScanCodeRef[] {
  return rows.map((row) => ({
    code: row.code,
    kind: row.kind,
    productId: row.product_id,
    locationId: row.location_id,
    active: row.active,
  }));
}

export function toStockCountRows(rows: readonly StockCountDbRow[]): StockCountRow[] {
  return rows.map((row) => ({
    id: row.id,
    productId: row.product_id,
    countedQty: row.counted_qty,
    expectedQty: row.expected_qty,
    createdAt: row.created_at,
    movementId: row.movement_id,
    sessionId: row.session_id,
  }));
}
