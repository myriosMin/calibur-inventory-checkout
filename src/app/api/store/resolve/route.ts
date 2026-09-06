import { NextResponse } from "next/server";
import { z } from "zod";

import { requireMember } from "@/lib/server/member-auth";
import { getServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const bodySchema = z.object({ code: z.string().min(1) });

/**
 * A code with no `value` (or a non-string one) sorts after every code that
 * has one, per WP11's "ordered by spec->>'value' if present else name".
 */
function specValue(spec: unknown): string | null {
  if (spec && typeof spec === "object" && !Array.isArray(spec)) {
    const value = (spec as Record<string, unknown>).value;
    if (typeof value === "string") return value;
  }
  return null;
}

// A fresh Response per call -- a `NextResponse` body is backed by a
// single-use stream, so a module-level singleton would serve an empty body
// on every call after the first (the underlying stream gets locked/consumed
// on the first response it's actually sent on).
function retired() {
  return NextResponse.json({ error: "retired" }, { status: 404 });
}

export async function POST(request: Request) {
  const auth = await requireMember(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "malformed_body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ error: "malformed_body" }, { status: 400 });
  }
  const { code } = parsed.data;

  const supabase = getServiceRoleClient();

  const { data: scanCode, error: scanCodeError } = await supabase
    .from("scan_codes")
    .select("*")
    .eq("code", code)
    .maybeSingle();
  if (scanCodeError) throw scanCodeError;

  // Unknown code, or a retired label: both return the same 404 shape so the
  // UI cannot distinguish "never existed" from "retired" (docs/tele-qr/flows.md).
  if (!scanCode || !scanCode.active) {
    return retired();
  }

  if (scanCode.kind === "product") {
    if (!scanCode.product_id) return retired();

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, name, tier, unit, category, spec, returnable, active")
      .eq("id", scanCode.product_id)
      .maybeSingle();
    if (productError) throw productError;

    // A product deactivated after its code was printed is indistinguishable
    // from a retired/unknown code.
    if (!product || !product.active) return retired();

    return NextResponse.json({
      kind: "product",
      product: {
        id: product.id,
        name: product.name,
        tier: product.tier,
        unit: product.unit,
        category: product.category,
        spec: product.spec,
        returnable: product.returnable,
      },
    });
  }

  if (scanCode.kind === "group") {
    if (!scanCode.location_id) return retired();

    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("id, name")
      .eq("id", scanCode.location_id)
      .maybeSingle();
    if (locationError) throw locationError;
    if (!location) return retired();

    const { data: products, error: productsError } = await supabase
      .from("products")
      .select("id, name, tier, unit, spec")
      .eq("location_id", location.id)
      .eq("active", true);
    if (productsError) throw productsError;

    const sorted = [...(products ?? [])].sort((a, b) => {
      const aValue = specValue(a.spec);
      const bValue = specValue(b.spec);
      if (aValue !== null && bValue !== null) return aValue.localeCompare(bValue);
      if (aValue !== null) return -1;
      if (bValue !== null) return 1;
      return a.name.localeCompare(b.name);
    });

    return NextResponse.json({
      kind: "group",
      location: { id: location.id, name: location.name },
      products: sorted.map((p) => ({
        id: p.id,
        name: p.name,
        tier: p.tier,
        unit: p.unit,
        spec: p.spec,
      })),
    });
  }

  // scan_codes.kind is constrained to 'product' | 'group' at the DB level;
  // anything else here means corrupt data, so treat it the same as retired.
  return retired();
}
