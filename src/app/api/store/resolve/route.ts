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

/**
 * Why a resolve missed. The API deliberately returns ONE indistinguishable
 * 404 for all four (the UI must not reveal "retired" vs "never existed");
 * `scan_misses.outcome` is the private version and does not leak.
 */
type ScanMissOutcome =
  | "unknown"
  | "retired"
  | "inactive_product"
  | "missing_target";

/**
 * Records a failed resolve for /admin's "unknown or retired codes scanned"
 * view (architecture.md's observability list).
 *
 * Two things here are load-bearing:
 *  - It has its OWN try/catch. A logging failure must never turn a 404 into
 *    a 500 -- the exact 404 body is part of this route's contract.
 *  - Callers must `await` it. A Vercel function can be frozen the instant
 *    the response is returned, so a floating insert is silently dropped.
 *
 * Writes through the service-role client, which bypasses RLS -- scan_misses
 * deliberately has no INSERT policy (0023_scan_misses.sql).
 */
async function logMiss(
  supabase: ReturnType<typeof getServiceRoleClient>,
  code: string,
  outcome: ScanMissOutcome,
  memberId: string,
): Promise<void> {
  try {
    await supabase
      .from("scan_misses")
      .insert({ code, outcome, member_id: memberId });
  } catch {
    // Swallowed on purpose: see above.
  }
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
    await logMiss(supabase, code, scanCode ? "retired" : "unknown", auth.member.id);
    return retired();
  }

  if (scanCode.kind === "product") {
    // Corrupt row: kind = 'product' with no product_id.
    if (!scanCode.product_id) {
      await logMiss(supabase, code, "missing_target", auth.member.id);
      return retired();
    }

    const { data: product, error: productError } = await supabase
      .from("products")
      .select("id, name, tier, unit, category, spec, returnable, active")
      .eq("id", scanCode.product_id)
      .maybeSingle();
    if (productError) throw productError;

    // A product deactivated after its code was printed is indistinguishable
    // from a retired/unknown code.
    if (!product || !product.active) {
      await logMiss(supabase, code, "inactive_product", auth.member.id);
      return retired();
    }

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
    // Corrupt row: kind = 'group' with no location_id.
    if (!scanCode.location_id) {
      await logMiss(supabase, code, "missing_target", auth.member.id);
      return retired();
    }

    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("id, name")
      .eq("id", scanCode.location_id)
      .maybeSingle();
    if (locationError) throw locationError;
    // location_id points at a row that no longer exists.
    if (!location) {
      await logMiss(supabase, code, "missing_target", auth.member.id);
      return retired();
    }

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
  await logMiss(supabase, code, "missing_target", auth.member.id);
  return retired();
}
