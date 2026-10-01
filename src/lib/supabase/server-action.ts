import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { dbSchemaOption } from "@/lib/supabase/schema";
import type { Database } from "@/lib/types/database";

/**
 * Anon-key client bound to the caller's cookies, for Server Actions that need
 * to know *who* is calling. The counterpart to getBrowserClient() (same
 * privileges, same RLS) and the opposite of getServiceRoleClient(), which has
 * no caller identity at all.
 *
 * `cookies()` is async in Next 16, and writes are permitted inside a Server
 * Action, so a token refresh mid-action can persist normally.
 */
export async function getServerActionClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. Check .env.local.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient<Database>(url, anonKey, {
    db: dbSchemaOption(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          cookieStore.set(name, value, options);
        }
      },
    },
  });
}
