import { Suspense } from "react";

import LabelsClient from "./LabelsClient";

/**
 * Server shell only. The page itself is a client component because it reads
 * `?code=` with `useSearchParams` (the single-label reprint hand-off from
 * /admin/scan-codes), which bails the tree out of prerendering up to the
 * nearest Suspense boundary -- so the boundary is here, explicitly, rather
 * than swallowing the whole admin layout.
 */
export default function AdminLabelsPage() {
  return (
    <Suspense fallback={<p className="p-4 text-sm text-neutral-400">Loading…</p>}>
      <LabelsClient />
    </Suspense>
  );
}
