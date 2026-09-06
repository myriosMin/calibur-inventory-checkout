import "../../scripts/_env";

import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GET } from "@/app/api/store/search/route";
import { getServiceRoleClient } from "@/lib/supabase/server";
import type { TablesInsert } from "@/lib/types/database";

// -----------------------------------------------------------------------
// tests/integration/search.test.ts (WP12)
//
// Exercises GET /api/store/search directly against the REAL, remote
// calibur-inventory Supabase project -- no mocking of the Supabase client
// or of member-auth. Auth is a genuine, validly-signed initData string for
// the pre-bound fixture test member (telegram_user_id 900000000001, see
// scripts/seed-fixtures.ts), produced by actually running
// scripts/dev-mock-init-data.ts rather than re-implementing its signing
// logic here.
//
// The route handler is invoked in-process (`GET(request)`) rather than
// over HTTP against a running `next dev` server -- it's a plain function
// from `Request` to `Response`, so this still exercises the real route
// code and makes real network calls to the real Supabase project; it just
// skips spinning up a server for a network hop that adds nothing here.
// -----------------------------------------------------------------------

const TEST_TELEGRAM_USER_ID = "900000000001";

const db = getServiceRoleClient();

let initData: string;

// Throwaway inactive product created fresh for this suite (rather than
// mutating a real seeded fixture's `active` flag) so the DB is left
// exactly as it was found once the suite finishes.
const THROWAWAY_PRODUCT_NAME = "WP12 Throwaway Inactive Fixture ZZQX";
let throwawayProductId: string | null = null;

function searchRequest(q?: string): Request {
  const url = new URL("http://localhost/api/store/search");
  if (q !== undefined) url.searchParams.set("q", q);
  return new Request(url, {
    headers: { "X-Telegram-Init-Data": initData },
  });
}

beforeAll(async () => {
  // Generate a genuinely-signed initData string via the actual dev script,
  // exactly as a developer would per the script's own usage instructions.
  initData = execFileSync(
    "npx",
    ["tsx", "scripts/dev-mock-init-data.ts", TEST_TELEGRAM_USER_ID],
    { cwd: process.cwd(), encoding: "utf-8" },
  )
    .toString()
    .trim();
  expect(initData.length).toBeGreaterThan(0);

  // Throwaway inactive product, cleaned up in afterAll.
  const insert: TablesInsert<"products"> = {
    name: THROWAWAY_PRODUCT_NAME,
    tier: "loose",
    unit: "pcs",
    active: false,
  };
  const { data, error } = await db
    .from("products")
    .insert(insert)
    .select("id")
    .single();
  if (error) throw error;
  throwawayProductId = data.id;
});

afterAll(async () => {
  if (throwawayProductId) {
    const { error } = await db.from("products").delete().eq("id", throwawayProductId);
    if (error) {
      // Surface loudly -- a leftover throwaway row in the live DB is exactly
      // what this cleanup exists to prevent.
      console.error("WP12 search.test.ts cleanup failed:", error);
      throw error;
    }
  }
});

describe("GET /api/store/search", () => {
  it("returns 200 { items: [] } when q is omitted", async () => {
    const res = await GET(searchRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ items: [] });
  });

  it("returns 200 { items: [] } when q is empty or whitespace-only", async () => {
    for (const q of ["", "   ", "\t"]) {
      const res = await GET(searchRequest(q));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ items: [] });
    }
  });

  it("rejects requests with no auth header", async () => {
    const url = new URL("http://localhost/api/store/search");
    url.searchParams.set("q", "resistor");
    const res = await GET(new Request(url));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("missing_init_data");
  });

  it("finds a real seeded product by a substring of its name", async () => {
    // Look up an actual seeded product rather than hardcoding one, so this
    // test doesn't silently rot if the fixture catalog changes shape.
    const { data: seeded, error } = await db
      .from("products")
      .select("id, name")
      .eq("active", true)
      .eq("name", "GM6020")
      .single();
    if (error) throw error;

    const substring = seeded.name.slice(0, 4); // "GM60"
    const res = await GET(searchRequest(substring));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(seeded.id);
  });

  it('finds the spec-only "10k" resistor via its jsonb spec, not its name', async () => {
    // scripts/seed-fixtures.ts seeds "Resistor 0402" with
    // spec = { value: "10k", package: "0402", ... } and deliberately no
    // "10k" substring in the name -- confirm that precondition, then prove
    // the search route's jsonb-side match is what surfaces it.
    const { data: specProduct, error } = await db
      .from("products")
      .select("id, name, spec")
      .eq("active", true)
      .eq("name", "Resistor 0402")
      .single();
    if (error) throw error;

    expect(specProduct.name.toLowerCase()).not.toContain("10k");
    expect((specProduct.spec as { value?: string } | null)?.value).toBe("10k");

    const res = await GET(searchRequest("10k"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((item: { id: string }) => item.id);
    expect(ids).toContain(specProduct.id);

    // The response should carry the row's own spec, unmangled.
    const returned = body.items.find(
      (item: { id: string }) => item.id === specProduct.id,
    );
    expect(returned.spec).toEqual(specProduct.spec);
  });

  it("never returns an inactive product", async () => {
    // The throwaway product created in beforeAll is inactive; searching for
    // its distinctive name must not surface it.
    const res = await GET(searchRequest("WP12 Throwaway"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.items.map((item: { id: string }) => item.id);
    expect(ids).not.toContain(throwawayProductId);
    expect(body.items).toEqual([]);
  });

  it("caps results at 20 rows (limit clause present in the query)", async () => {
    // The live fixture catalog has well under 20 products, so a truncation
    // can't be observed empirically here without seeding 20+ throwaway
    // rows. This is a code-review-level regression guard instead: confirm
    // the route source still contains the `.limit(RESULT_LIMIT)` calls that
    // bound both the SQL-side name query and the final merged result set.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/api/store/search/route.ts"),
      "utf-8",
    );
    expect(source).toMatch(/RESULT_LIMIT\s*=\s*20/);
    expect(source).toMatch(/\.limit\(RESULT_LIMIT\)/);
    expect(source).toMatch(/\.slice\(0,\s*RESULT_LIMIT\)/);
  });
});
