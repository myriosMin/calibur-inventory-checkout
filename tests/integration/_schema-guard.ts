// Imported by every integration test, straight after scripts/_env. Refuses
// to run a single test unless the service-role client -- the one the route
// handlers under test use -- really targets the `test` schema.
//
// Checking the client rather than the env var is the point: the env var was
// once set correctly while the client ignored it, and a seed script wrote a
// test member into the real inventory. src/lib/supabase/schema.ts.
import { getServiceRoleClient } from "@/lib/supabase/server";

const target = (getServiceRoleClient() as unknown as { rest: { schemaName?: string } }).rest.schemaName;
if (target !== "test") {
  throw new Error(
    `Integration tests must run against the "test" schema, but the service-role client targets "${target ?? "public"}". Refusing to touch real data.`,
  );
}
