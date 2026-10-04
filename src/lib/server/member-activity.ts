import type { SupabaseClient } from "@supabase/supabase-js";

import { getReturnSourceHolders } from "@/lib/server/holdings-sources";
import type { Database } from "@/lib/types/database";

export interface MemberHoldingItem {
  productId: string;
  name: string;
  tier: string;
  unit: string;
  qty: number;
  /** products.expensive (0028). */
  expensive: boolean;
}

export interface MemberHolderHoldings {
  holderId: string;
  holderName: string;
  holderKind: string;
  items: MemberHoldingItem[];
}

export interface MemberHistoryEvent {
  id: number;
  at: string;
  reason: string | null;
  qty: number;
  productName: string;
  unit: string;
  fromHolderName: string;
  toHolderName: string;
}

/**
 * Everything a member is currently holding, across *every* holder they hold
 * from, grouped by holder.
 *
 * The holder set is `getReturnSourceHolders` -- the robots this member has
 * borrowed to plus their own personal holder -- which is already the
 * definition of "holders this member is answerable for" used by
 * /api/store/holdings as its allow-list. Unlike that route, nothing here is
 * caller-supplied: the member id comes from `requireMember`, so there is no
 * holder id to defend against.
 *
 * Holders with nothing in them are dropped: "my items" is a list of items,
 * and an empty robot card is noise on a phone screen.
 */
export async function getMemberHoldings(
  supabase: SupabaseClient<Database>,
  memberId: string,
): Promise<MemberHolderHoldings[]> {
  const holders = await getReturnSourceHolders(supabase, memberId);
  if (holders.length === 0) return [];

  const holderIds = holders.map((holder) => holder.id);

  const { data: holdingsRows, error: holdingsError } = await supabase
    .from("holdings")
    .select("product_id, holder_id, qty")
    .in("holder_id", holderIds)
    .gt("qty", 0);
  if (holdingsError) throw holdingsError;

  const productIds = [
    ...new Set(
      (holdingsRows ?? [])
        .map((row) => row.product_id)
        .filter((id): id is string => id !== null),
    ),
  ];
  if (productIds.length === 0) return [];

  // Two-step rather than a PostgREST embed: `holdings` is a plain view with
  // no declared FK to `products`, so there's no relationship to embed
  // through (same reason /api/store/holdings does it this way).
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, name, tier, unit, expensive")
    .in("id", productIds)
    .eq("active", true);
  if (productsError) throw productsError;

  const productById = new Map((products ?? []).map((product) => [product.id, product]));

  const byHolder = new Map<string, MemberHolderHoldings>();
  for (const holder of holders) {
    byHolder.set(holder.id, {
      holderId: holder.id,
      holderName: holder.name,
      holderKind: holder.kind,
      items: [],
    });
  }

  for (const row of holdingsRows ?? []) {
    if (!row.product_id || !row.holder_id) continue;
    const product = productById.get(row.product_id);
    const group = byHolder.get(row.holder_id);
    if (!product || !group) continue; // inactive product, or a holder outside the set
    group.items.push({
      productId: product.id,
      name: product.name,
      tier: product.tier,
      unit: product.unit,
      qty: row.qty ?? 0,
      expensive: product.expensive === true,
    });
  }

  return [...byHolder.values()]
    .filter((group) => group.items.length > 0)
    .map((group) => ({
      ...group,
      items: [...group.items].sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.holderName.localeCompare(b.holderName));
}

/**
 * This member's recent ledger activity -- the "see their own history in the
 * Mini App" half of docs/tele-qr/pdpa.md's access-and-correction obligation.
 *
 * Scoped by `actor_member_id`, i.e. movements this member caused, which is
 * the record that is *about them*. Deliberately not "movements touching a
 * holder they hold from": an admin stocktake correcting a robot's shelf is
 * the club's record, not this member's activity, and surfacing it here would
 * read as an accusation (flows.md §6: "variance is a diagnostic, not an
 * accusation").
 */
export async function getMemberHistory(
  supabase: SupabaseClient<Database>,
  memberId: string,
  limit = 20,
): Promise<MemberHistoryEvent[]> {
  const { data: movements, error: movementsError } = await supabase
    .from("stock_movements")
    .select("id, created_at, qty, reason, product_id, from_holder_id, to_holder_id")
    .eq("actor_member_id", memberId)
    .order("id", { ascending: false })
    .limit(limit);
  if (movementsError) throw movementsError;
  if (!movements || movements.length === 0) return [];

  const productIds = [...new Set(movements.map((row) => row.product_id))];
  const holderIds = [
    ...new Set(movements.flatMap((row) => [row.from_holder_id, row.to_holder_id])),
  ];

  const [{ data: products, error: productsError }, { data: holders, error: holdersError }] =
    await Promise.all([
      supabase.from("products").select("id, name, unit").in("id", productIds),
      supabase.from("holders").select("id, name").in("id", holderIds),
    ]);
  if (productsError) throw productsError;
  if (holdersError) throw holdersError;

  const productById = new Map((products ?? []).map((product) => [product.id, product]));
  const holderNameById = new Map((holders ?? []).map((holder) => [holder.id, holder.name]));

  return movements.map((row) => {
    const product = productById.get(row.product_id);
    return {
      id: row.id,
      at: row.created_at,
      reason: row.reason,
      qty: row.qty,
      // A deactivated product keeps its movements; the name is still the
      // useful thing to show, so fall back rather than dropping the row.
      productName: product?.name ?? "Unknown item",
      unit: product?.unit ?? "",
      fromHolderName: holderNameById.get(row.from_holder_id) ?? "—",
      toHolderName: holderNameById.get(row.to_holder_id) ?? "—",
    };
  });
}
