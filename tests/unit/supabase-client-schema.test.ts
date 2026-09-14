import { describe, expect, it } from "vitest";

/**
 * The service-role client must honour NEXT_PUBLIC_SUPABASE_SCHEMA. It once
 * didn't (the option was imported but never passed), and a seed script meant
 * for `test` wrote into the real inventory. Asserted on the client itself,
 * the same way tests/integration/_schema-guard.ts checks it before every run.
 */
describe("getServiceRoleClient schema", () => {
  it("targets the schema from NEXT_PUBLIC_SUPABASE_SCHEMA (test under vitest)", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY ??= "service-role-key-for-unit-test";
    const { getServiceRoleClient } = await import("@/lib/supabase/server");
    const client = getServiceRoleClient() as unknown as { rest: { schemaName?: string } };
    expect(client.rest.schemaName).toBe("test");
  });
});
