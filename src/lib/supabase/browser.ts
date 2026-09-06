import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/lib/types/database";

// Anon-key client for /admin client components. Relies on Supabase Auth +
// RLS (see supabase/migrations/0009_rls_policies.sql) for access control --
// this client has no elevated privileges of its own.
export function getBrowserClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Check .env.local.",
    );
  }

  return createBrowserClient<Database>(url, anonKey);
}
