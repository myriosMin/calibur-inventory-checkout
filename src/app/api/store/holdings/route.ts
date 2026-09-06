import { NextResponse } from "next/server";

import { getReturnSourceHolders } from "@/lib/server/holdings-sources";
import { requireMember } from "@/lib/server/member-auth";
import { getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

/**
 * GET /api/store/holdings?holderId=<uuid>
 *
 * RETURN_LIST checklist (docs/tele-qr/flows.md §3): everything currently held
 * at `holderId`, sourced from the `holdings` view (already netted-out) joined
 * to `products`, active products only.
 *
 * Security: `holderId` must be one of the holders this member is allowed to
 * return from -- the same set `/holdings/sources` returns -- otherwise a
 * member could pass an arbitrary holder id and read someone else's holdings.
 */
export async function GET(request: Request) {
  const auth = await requireMember(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const holderId = url.searchParams.get("holderId");
  if (!holderId) {
    return NextResponse.json({ error: "missing_holder_id" }, { status: 400 });
  }

  const supabase = getServiceRoleClient();

  const allowedHolders = await getReturnSourceHolders(supabase, auth.member.id);
  if (!allowedHolders.some((holder) => holder.id === holderId)) {
    return NextResponse.json({ error: "forbidden_holder" }, { status: 403 });
  }

  const { data: holdingsRows, error: holdingsError } = await supabase
    .from("holdings")
    .select("product_id, qty")
    .eq("holder_id", holderId)
    .gt("qty", 0);
  if (holdingsError) throw holdingsError;

  const productIds = (holdingsRows ?? [])
    .map((row) => row.product_id)
    .filter((id): id is string => id !== null);

  if (productIds.length === 0) {
    return NextResponse.json({ items: [] });
  }

  // Two-step query rather than a PostgREST embed: `holdings` is a plain view
  // with no declared FK to `products`, so there's no relationship for
  // PostgREST to embed through.
  const { data: products, error: productsError } = await supabase
    .from("products")
    .select("id, name, tier, unit, active")
    .in("id", productIds)
    .eq("active", true);
  if (productsError) throw productsError;

  const qtyByProductId = new Map(
    (holdingsRows ?? []).map((row) => [row.product_id, row.qty ?? 0]),
  );

  const items = (products ?? []).map((product) => ({
    productId: product.id,
    name: product.name,
    tier: product.tier,
    unit: product.unit,
    qty: qtyByProductId.get(product.id) ?? 0,
  }));

  return NextResponse.json({ items });
}
