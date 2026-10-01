import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { dbSchemaOption } from "@/lib/supabase/schema";
import type { Database } from "@/lib/types/database";

let client: SupabaseClient<Database> | undefined;

// Anon-key client for /admin client components. Relies on Supabase Auth +
// RLS (see supabase/migrations/0009_rls_policies.sql) for access control --
// this client has no elevated privileges of its own.
//
// One per page load: every admin page and the SWR hooks in
// src/lib/admin/queries.ts share it, so they share one auth session too.
export function getBrowserClient(): SupabaseClient<Database> {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Check .env.local.",
    );
  }

  client = createBrowserClient<Database>(url, anonKey, { db: dbSchemaOption() });
  return client;
}
