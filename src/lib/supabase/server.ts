import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { dbSchemaOption } from "@/lib/supabase/schema";
import type { Database } from "@/lib/types/database";

// Service-role client. NEVER import this from anything that can end up in a
// client bundle (a 'use client' component, or a file under src/app/store/**
// that renders in the browser). This file is also imported directly by
// scripts/*.ts via `npx tsx` (outside the Next.js bundler), so the guard
// below is a plain `typeof window` check rather than the `server-only`
// package -- that package throws unconditionally under plain Node/tsx
// execution (its trick only works inside webpack/Turbopack's server/client
// module graph split), which would break every standalone script.

let client: SupabaseClient<Database> | undefined;

export function getServiceRoleClient(): SupabaseClient<Database> {
  if (typeof window !== "undefined") {
    throw new Error(
      "getServiceRoleClient() must never be called from browser-executed code.",
    );
  }
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Check .env.local.",
    );
  }

  client = createClient<Database>(url, serviceRoleKey, {
    auth: { persistSession: false },
    db: dbSchemaOption(),
  });
  return client;
}
