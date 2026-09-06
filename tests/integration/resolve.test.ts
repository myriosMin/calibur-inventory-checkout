import "../../scripts/_env";

import { execFileSync } from "node:child_process";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { getServiceRoleClient } from "@/lib/supabase/server";
import { POST } from "@/app/api/store/resolve/route";

// ---------------------------------------------------------------------------
// Integration test for WP11 (/api/store/resolve). Runs against the LIVE
// calibur-inventory Supabase project (no mocking) using real fixture rows
// seeded by scripts/seed-fixtures.ts, and hits the route handler directly by
// constructing `Request` objects -- no HTTP server needed since Next.js route
// handlers are plain (Request) => Response functions.
// ---------------------------------------------------------------------------

const TEST_TELEGRAM_USER_ID = 900000000001;
const RESOLVE_URL = "http://localhost/api/store/resolve";

function generateInitData(telegramUserId: number): string {
  const scriptPath = path.resolve(__dirname, "../../scripts/dev-mock-init-data.ts");
  const stdout = execFileSync("npx", ["tsx", scriptPath, String(telegramUserId)], {
    encoding: "utf-8",
  });
  return stdout.trim();
}

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(RESOLVE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

describe("POST /api/store/resolve (integration, live DB)", () => {
  let initDataHeader: string;
  let seededProductCode: string;
  let seededProductId: string;
  let seededProduct: {
    id: string;
    name: string;
    tier: string;
    unit: string;
    category: string | null;
    spec: unknown;
    returnable: boolean;
  };
  let groupCode: string;
  let groupLocationName: string;

  beforeAll(async () => {
    initDataHeader = generateInitData(TEST_TELEGRAM_USER_ID);

    const db = getServiceRoleClient();

    // Find a real seeded product scan_codes row (kind='product') rather than
    // hardcoding a guessed code.
    const { data: productCodeRow, error: productCodeErr } = await db
      .from("scan_codes")
      .select("code, product_id")
      .eq("kind", "product")
      .eq("active", true)
      .not("product_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (productCodeErr) throw productCodeErr;
    if (!productCodeRow || !productCodeRow.product_id) {
      throw new Error(
        "No active product scan_codes row found -- run `npx tsx scripts/seed-fixtures.ts` first.",
      );
    }
    seededProductCode = productCodeRow.code;
    seededProductId = productCodeRow.product_id;

    const { data: productRow, error: productErr } = await db
      .from("products")
      .select("id, name, tier, unit, category, spec, returnable, active")
      .eq("id", seededProductId)
      .single();
    if (productErr) throw productErr;
    if (!productRow.active) {
      throw new Error(
        `Seeded product scan_codes row ${seededProductCode} points at an inactive product; fixtures may have changed.`,
      );
    }
    seededProduct = productRow;

    // Find the real seeded group scan_codes row (fixtures point this at the
    // "Resistor book" location per scripts/seed-fixtures.ts).
    const { data: groupCodeRow, error: groupCodeErr } = await db
      .from("scan_codes")
      .select("code, location_id")
      .eq("kind", "group")
      .eq("active", true)
      .not("location_id", "is", null)
      .limit(1)
      .maybeSingle();
    if (groupCodeErr) throw groupCodeErr;
    if (!groupCodeRow || !groupCodeRow.location_id) {
      throw new Error(
        "No active group scan_codes row found -- run `npx tsx scripts/seed-fixtures.ts` first.",
      );
    }
    groupCode = groupCodeRow.code;

    const { data: locationRow, error: locationErr } = await db
      .from("locations")
      .select("id, name")
      .eq("id", groupCodeRow.location_id)
      .single();
    if (locationErr) throw locationErr;
    groupLocationName = locationRow.name;
  });

  it("resolves a real seeded product code to the matching product shape", async () => {
    const request = makeRequest(
      { code: seededProductCode },
      { "X-Telegram-Init-Data": initDataHeader },
    );

    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json).toEqual({
      kind: "product",
      product: {
        id: seededProduct.id,
        name: seededProduct.name,
        tier: seededProduct.tier,
        unit: seededProduct.unit,
        category: seededProduct.category,
        spec: seededProduct.spec,
        returnable: seededProduct.returnable,
      },
    });
  });

  it("resolves the real seeded group code (Resistor book) with >=2 products", async () => {
    const request = makeRequest({ code: groupCode }, { "X-Telegram-Init-Data": initDataHeader });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.kind).toBe("group");
    expect(json.location.name).toBe(groupLocationName);
    expect(Array.isArray(json.products)).toBe(true);
    expect(json.products.length).toBeGreaterThanOrEqual(2);
    for (const product of json.products) {
      expect(product).toHaveProperty("id");
      expect(product).toHaveProperty("name");
      expect(product).toHaveProperty("tier");
      expect(product).toHaveProperty("unit");
      expect(product).toHaveProperty("spec");
    }
  });

  it("returns 404 { error: 'retired' } for an unknown code", async () => {
    const request = makeRequest(
      { code: "DEFINITELY-NOT-A-REAL-CODE-ZZZ9999" },
      { "X-Telegram-Init-Data": initDataHeader },
    );

    const response = await POST(request);
    expect(response.status).toBe(404);
    const json = await response.json();
    expect(json).toEqual({ error: "retired" });
  });

  it("returns 401 when X-Telegram-Init-Data header is missing", async () => {
    const request = makeRequest({ code: seededProductCode });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 for a malformed body missing `code`", async () => {
    const request = makeRequest({ notCode: "foo" }, { "X-Telegram-Init-Data": initDataHeader });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });
});
