/**
 * The one place a report question is turned into a query.
 *
 * Both the nightly cron (`/api/cron/daily`, service-role client) and the
 * admin dashboard (`/admin`, anon client + RLS) ask the same questions —
 * what is low, what is out, what is failing to scan. If each built its own
 * query they would drift, and the first symptom would be the dashboard and
 * the bot disagreeing about whether the club is short of XT30s, which is
 * exactly the kind of disagreement that makes people stop trusting both.
 *
 * So: every helper here takes a `SupabaseClient<Database>` and returns typed
 * rows. It never creates a client, never reads `process.env`, and never
 * imports anything server-only — `@/lib/supabase/server` in particular —
 * because these modules are imported by a `"use client"` dashboard as well
 * as by a route handler.
 *
 * The selection *logic* lives in the sibling pure modules (`./overdue`,
 * `./stock`, `./label-health`, `./activity`); this file only fetches.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/lib/types/database";

import type { LedgerRow } from "./overdue";
import type { StockLevelRow } from "./stock";

export type ReportClient = SupabaseClient<Database>;

/**
 * Generous for a club of ~120 members: the whole ledger is in the low
 * thousands of rows after a season. Explicit rather than implicit because
 * PostgREST's own default (1000) would silently truncate a report and give
 * a wrong answer that looks like a right one.
 */
export const REPORT_ROW_LIMIT = 20000;

/**
 * "Did this query come back truncated?", as a sentence an admin can act on.
 *
 * PostgREST caps an unbounded select at 1000 rows and says nothing about it,
 * which on a stock page is worse than a slow page: the numbers are simply
 * wrong and look right. Every read that can grow with the catalog therefore
 * asks for an explicit `REPORT_ROW_LIMIT`, and a result that comes back AT
 * the limit is assumed to have more behind it — one wasted sentence when the
 * count lands exactly on the limit, versus silently hiding stock otherwise.
 *
 * Returns null when there is nothing to say, so a caller can render it
 * conditionally without a second predicate.
 */
export function truncationNotice(
  what: string,
  rowCount: number,
  limit: number = REPORT_ROW_LIMIT,
): string | null {
  if (rowCount < limit) return null;
  return `Showing the first ${limit} ${what}. There are more, and they are not on this page — narrow the filters or export the full data instead.`;
}

function unwrap<T>(result: { data: T[] | null; error: { message: string } | null }, what: string): T[] {
  if (result.error) throw new Error(`${what}: ${result.error.message}`);
  return result.data ?? [];
}

// ---------------------------------------------------------------------------
// Stock levels
// ---------------------------------------------------------------------------

/** Every active product's store/outside balance, from the corrected `stock_summary` view. */
export async function fetchStockLevels(client: ReportClient): Promise<StockLevelRow[]> {
  const rows = unwrap(
    await client
      .from("stock_summary")
      .select("product_id, name, tier, unit, min_stock, qty_in_store, qty_out")
      .limit(REPORT_ROW_LIMIT),
    "stock_summary",
  );

  return rows
    .filter((row): row is typeof row & { product_id: string } => row.product_id !== null)
    .map((row) => ({
      productId: row.product_id,
      name: row.name ?? "Unnamed product",
      tier: row.tier ?? "bulk",
      unit: row.unit ?? "pcs",
      minStock: row.min_stock,
      qtyInStore: Number(row.qty_in_store ?? 0),
      qtyOut: Number(row.qty_out ?? 0),
    }));
}

// ---------------------------------------------------------------------------
// Holders and the ledger
// ---------------------------------------------------------------------------

export interface BorrowerHolder {
  holderId: string;
  holderName: string;
  memberId: string;
  memberName: string;
  /** null when the member has never bound Telegram — nudges cannot reach them. */
  telegramUserId: number | null;
}

/**
 * Member holders and the person behind each, for the overdue nudge.
 *
 * Inactive members are excluded: `pdpa.md` clears the Telegram binding when
 * someone leaves, and messaging an ex-member about a part is both useless
 * and slightly rude. Their holdings still show on the dashboard — the club
 * record survives the person's account, which is the point of keeping it.
 *
 * Two flat reads rather than a PostgREST embed: `holders.member_id` is a
 * plain FK and the embed shape (`members` nested, possibly null) is harder
 * to narrow in TypeScript than a lookup over a handful of rows.
 */
export async function fetchBorrowerHolders(client: ReportClient): Promise<BorrowerHolder[]> {
  const holders = unwrap(
    await client
      .from("holders")
      .select("id, name, member_id")
      .eq("kind", "member")
      .eq("active", true)
      .limit(REPORT_ROW_LIMIT),
    "holders",
  );

  const members = unwrap(
    await client
      .from("members")
      .select("id, full_name, display_name, telegram_user_id, active")
      .eq("active", true)
      .limit(REPORT_ROW_LIMIT),
    "members",
  );

  const byId = new Map(members.map((member) => [member.id, member]));

  const out: BorrowerHolder[] = [];
  for (const holder of holders) {
    if (!holder.member_id) continue;
    const member = byId.get(holder.member_id);
    if (!member) continue;
    out.push({
      holderId: holder.id,
      holderName: holder.name,
      memberId: member.id,
      memberName: member.display_name ?? member.full_name,
      telegramUserId: member.telegram_user_id,
    });
  }
  return out;
}

/** Store-kind holder ids. Normally one ("Store"), but the schema allows more. */
export async function fetchStoreHolderIds(client: ReportClient): Promise<string[]> {
  const rows = unwrap(
    await client.from("holders").select("id").eq("kind", "store").limit(REPORT_ROW_LIMIT),
    "holders (store)",
  );
  return rows.map((row) => row.id);
}

/** Every movement touching one of `holderIds`, in the shape `outstandingLots` wants. */
export async function fetchHolderLedger(
  client: ReportClient,
  holderIds: readonly string[],
): Promise<LedgerRow[]> {
  if (holderIds.length === 0) return [];
  const list = holderIds.join(",");

  const rows = unwrap(
    await client
      .from("stock_movements")
      .select("product_id, from_holder_id, to_holder_id, qty, created_at")
      .or(`from_holder_id.in.(${list}),to_holder_id.in.(${list})`)
      .order("created_at", { ascending: true })
      .limit(REPORT_ROW_LIMIT),
    "stock_movements (holder ledger)",
  );

  return rows.map((row) => ({
    productId: row.product_id,
    fromHolderId: row.from_holder_id,
    toHolderId: row.to_holder_id,
    qty: row.qty,
    createdAt: row.created_at,
  }));
}

/**
 * Net change in the store's holding per product since `sinceIso`.
 *
 * Feeds the newly-low / newly-negative transition check in `./stock`, which
 * is what keeps the low-stock alert from firing every single morning until
 * someone goes shopping.
 */
export async function fetchStoreDeltaSince(
  client: ReportClient,
  sinceIso: string,
): Promise<Map<string, number>> {
  const storeIds = await fetchStoreHolderIds(client);
  if (storeIds.length === 0) return new Map();
  const list = storeIds.join(",");

  const rows = unwrap(
    await client
      .from("stock_movements")
      .select("product_id, from_holder_id, to_holder_id, qty")
      .gte("created_at", sinceIso)
      .or(`from_holder_id.in.(${list}),to_holder_id.in.(${list})`)
      .limit(REPORT_ROW_LIMIT),
    "stock_movements (store delta)",
  );

  const store = new Set(storeIds);
  const deltas = new Map<string, number>();
  for (const row of rows) {
    let delta = 0;
    if (store.has(row.to_holder_id)) delta += row.qty;
    if (store.has(row.from_holder_id)) delta -= row.qty;
    if (delta === 0) continue;
    deltas.set(row.product_id, (deltas.get(row.product_id) ?? 0) + delta);
  }
  return deltas;
}

// ---------------------------------------------------------------------------
// Catalog references
// ---------------------------------------------------------------------------

export interface ProductRef {
  id: string;
  name: string;
  tier: string;
  unit: string;
  returnable: boolean;
  minStock: number | null;
  locationId: string | null;
  category: string | null;
  partNumber: string | null;
  active: boolean;
}

export async function fetchProducts(client: ReportClient): Promise<ProductRef[]> {
  const rows = unwrap(
    await client
      .from("products")
      .select("id, name, tier, unit, returnable, min_stock, location_id, category, part_number, active")
      .order("name")
      .limit(REPORT_ROW_LIMIT),
    "products",
  );

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

// ---------------------------------------------------------------------------
// Dashboard-only reads
// ---------------------------------------------------------------------------

export interface SessionRow {
  id: string;
  mode: string;
  source: string;
  startedAt: string;
  committedAt: string | null;
}

export async function fetchSessionsSince(
  client: ReportClient,
  sinceIso: string,
): Promise<SessionRow[]> {
  const rows = unwrap(
    await client
      .from("sessions")
      .select("id, mode, source, started_at, committed_at")
      .gte("started_at", sinceIso)
      .order("started_at", { ascending: true })
      .limit(REPORT_ROW_LIMIT),
    "sessions",
  );

  return rows.map((row) => ({
    id: row.id,
    mode: row.mode,
    source: row.source,
    startedAt: row.started_at,
    committedAt: row.committed_at,
  }));
}

export interface EntryRow {
  productId: string;
  entryMethod: string | null;
  scanCode: string | null;
  createdAt: string;
}

/** Movements since `sinceIso`, for the scan-vs-search ratio and label health. */
export async function fetchEntriesSince(
  client: ReportClient,
  sinceIso: string,
): Promise<EntryRow[]> {
  const rows = unwrap(
    await client
      .from("stock_movements")
      .select("product_id, entry_method, scan_code, created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: true })
      .limit(REPORT_ROW_LIMIT),
    "stock_movements (entries)",
  );

  return rows.map((row) => ({
    productId: row.product_id,
    entryMethod: row.entry_method,
    scanCode: row.scan_code,
    createdAt: row.created_at,
  }));
}

export interface ScanMissRow {
  id: number;
  code: string;
  outcome: string;
  createdAt: string;
}

export async function fetchScanMissesSince(
  client: ReportClient,
  sinceIso: string,
): Promise<ScanMissRow[]> {
  const rows = unwrap(
    await client
      .from("scan_misses")
      .select("id, code, outcome, created_at")
      .gte("created_at", sinceIso)
      .order("created_at", { ascending: false })
      .limit(REPORT_ROW_LIMIT),
    "scan_misses",
  );

  return rows.map((row) => ({
    id: row.id,
    code: row.code,
    outcome: row.outcome,
    createdAt: row.created_at,
  }));
}

/** How many unrecognised Telegram users are waiting for an admin to resolve them. */
export async function fetchBindQueueDepth(client: ReportClient): Promise<number> {
  const { count, error } = await client
    .from("telegram_bind_attempts")
    .select("*", { count: "exact", head: true })
    .is("resolved_member", null);
  if (error) throw new Error(`telegram_bind_attempts: ${error.message}`);
  return count ?? 0;
}

export interface ScanCodeRef {
  code: string;
  kind: string;
  productId: string | null;
  locationId: string | null;
  active: boolean;
}

export async function fetchScanCodes(client: ReportClient): Promise<ScanCodeRef[]> {
  const rows = unwrap(
    await client
      .from("scan_codes")
      .select("code, kind, product_id, location_id, active")
      .limit(REPORT_ROW_LIMIT),
    "scan_codes",
  );

  return rows.map((row) => ({
    code: row.code,
    kind: row.kind,
    productId: row.product_id,
    locationId: row.location_id,
    active: row.active,
  }));
}
