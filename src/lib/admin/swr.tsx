"use client";

import type { ReactNode } from "react";
import { SWRConfig } from "swr";

/**
 * The one SWR cache for /admin, mounted by the admin layout. The layout
 * persists across client navigation, so this cache does too. See
 * ./queries.ts for the keys and why they exist.
 *
 * - 30s dedupe: two components asking for products on one screen, or a
 *   quick back-and-forth between pages, cost one request.
 * - Revalidate on focus: coming back to the tab after a borrow at the
 *   store shows the new balance without a manual reload.
 * - Two retries, not SWR's default of endless backoff: an RLS refusal is
 *   not going to start succeeding, and the page should say so.
 */
export default function AdminSWRProvider({ children }: { children: ReactNode }) {
  return (
    <SWRConfig
      value={{
        dedupingInterval: 30_000,
        revalidateOnFocus: true,
        keepPreviousData: true,
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  );
}
