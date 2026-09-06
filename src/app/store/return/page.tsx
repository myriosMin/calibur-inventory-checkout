"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import Toast from "@/components/ui/Toast";
import { getWebApp } from "@/lib/telegram/webapp-client";
import type { SearchProduct } from "@/app/store/components/SearchSheet";
import ReturnChecklist, {
  type ExtraLine,
  type HoldingItem,
} from "@/app/store/components/ReturnChecklist";

interface SourceHolder {
  id: string;
  name: string;
  kind: string;
}

type Stage =
  | { name: "loading-sources" }
  | { name: "sources-error"; message: string }
  | { name: "picking-source"; sources: SourceHolder[] }
  | { name: "loading-holdings"; sources: SourceHolder[]; source: SourceHolder }
  | { name: "holdings-error"; sources: SourceHolder[]; source: SourceHolder; message: string }
  | { name: "checklist"; sources: SourceHolder[]; source: SourceHolder };

/**
 * RETURN_SOURCE -> RETURN_LIST flow (docs/tele-qr/flows.md §3). Returns never
 * scan: the app already knows what's held once the member identifies a
 * source, so this page is a two-step picker-then-checklist rather than a
 * scanner screen.
 */
export default function ReturnPage() {
  const router = useRouter();
  const [stage, setStage] = useState<Stage>({ name: "loading-sources" });

  const [items, setItems] = useState<HoldingItem[]>([]);
  const [extraLines, setExtraLines] = useState<ExtraLine[]>([]);
  // Returning-qty per productId. Plain object (not a Map) keyed by
  // productId: it covers both `items` rows (initialized to 0, capped at the
  // held qty) and `extraLines` rows added via the search fallback
  // (initialized to 1, since a zero-qty "extra" line is meaningless -- it
  // has no held qty to fall back to, so there's nothing for a 0 to mean).
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState<
    { variant: "success" | "error"; message: string } | null
  >(null);

  // `getWebApp()` touches `window` and throws when it's genuinely absent, so
  // it must never run during Next's build-time prerender of this client
  // component -- it's called lazily inside this effect (client-only, after
  // mount), never at module/render top-level. `initData` is mirrored into
  // state so the rest of the component (fetch calls, ReturnChecklist's
  // `initData` prop) has something to read.
  const [initData, setInitData] = useState("");

  useEffect(() => {
    let cancelled = false;

    // Deferred to a microtask so the initial `getWebApp()` read (and its
    // possible throw when opened outside Telegram) resolves state via a
    // callback rather than synchronously in the effect body -- same shape
    // as the fetch .then/.catch below.
    Promise.resolve().then(() => {
      if (cancelled) return;

      let webApp;
      try {
        webApp = getWebApp();
      } catch (err) {
        setStage({
          name: "sources-error",
          message:
            err instanceof Error ? err.message : "This page must be opened inside Telegram.",
        });
        return;
      }
      setInitData(webApp.initData);

      fetch("/api/store/holdings/sources", {
        headers: { "X-Telegram-Init-Data": webApp.initData },
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`Failed to load sources (${res.status})`);
          return res.json() as Promise<{ holders: SourceHolder[] }>;
        })
        .then((data) => {
          if (cancelled) return;
          setStage({ name: "picking-source", sources: data.holders });
        })
        .catch((err) => {
          if (cancelled) return;
          setStage({
            name: "sources-error",
            message: err instanceof Error ? err.message : "Failed to load sources",
          });
        });
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const pickSource = (source: SourceHolder, sources: SourceHolder[]) => {
    setStage({ name: "loading-holdings", sources, source });
    setItems([]);
    setExtraLines([]);
    setQuantities({});

    fetch(`/api/store/holdings?holderId=${encodeURIComponent(source.id)}`, {
      headers: { "X-Telegram-Init-Data": initData },
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load holdings (${res.status})`);
        return res.json() as Promise<{ items: HoldingItem[] }>;
      })
      .then((data) => {
        setItems(data.items);
        setStage({ name: "checklist", sources, source });
      })
      .catch((err) => {
        setStage({
          name: "holdings-error",
          sources,
          source,
          message: err instanceof Error ? err.message : "Failed to load holdings",
        });
      });
  };

  const handleQtyChange = (productId: string, qty: number) => {
    setQuantities((prev) => ({ ...prev, [productId]: qty }));
  };

  const handleReturnAll = () => {
    setQuantities((prev) => {
      const next = { ...prev };
      for (const item of items) next[item.productId] = item.qty;
      return next;
    });
  };

  const handleAddExtra = (product: SearchProduct) => {
    // Already a held line, or already added as an extra -- nothing to do,
    // the existing row's stepper handles it.
    if (items.some((item) => item.productId === product.id)) return;
    if (extraLines.some((line) => line.productId === product.id)) return;

    setExtraLines((prev) => [
      ...prev,
      { productId: product.id, name: product.name, tier: product.tier, unit: product.unit },
    ]);
    setQuantities((prev) => ({ ...prev, [product.id]: 1 }));
  };

  const buildLines = () =>
    Object.entries(quantities)
      .filter(([, qty]) => qty > 0)
      .map(([productId, qty]) => ({
        productId,
        qty,
        // WP14's `entryMethod` enum ('scan' | 'group_pick' | 'search') has no
        // dedicated value for "tapped a stepper on the return checklist" --
        // it isn't scan-sourced at all. 'search' is the closest fit: like a
        // search-added line, a checklist line is a member-initiated pick
        // from a browsable list rather than a code resolution. This applies
        // uniformly to both held-item rows and search-fallback extra rows.
        entryMethod: "search" as const,
      }));

  const isSubmittable = stage.name === "checklist" && buildLines().length > 0;

  const submit = () => {
    if (stage.name !== "checklist") return;
    const lines = buildLines();
    if (lines.length === 0) return;

    setSubmitting(true);
    setToast(null);

    fetch("/api/store/cart/submit", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Telegram-Init-Data": initData,
      },
      body: JSON.stringify({
        mode: "return",
        sourceHolderId: stage.source.id,
        lines,
      }),
    })
      .then((res) => {
        if (!res.ok) throw new Error(`submit_failed_${res.status}`);
        setToast({ variant: "success", message: "Returned. Thanks!" });
        // Brief delay so the success toast is actually visible before the
        // navigation away from this page unmounts it.
        setTimeout(() => router.push("/store"), 600);
      })
      .catch(() => {
        // Never clear checklist state on failure -- the member should be
        // able to just hit Retry without re-entering anything.
        setToast({
          variant: "error",
          message: "Couldn't submit the return. Nothing was lost -- try again.",
        });
      })
      .finally(() => {
        setSubmitting(false);
      });
  };

  return (
    <div className="mx-auto max-w-md p-4 pb-24">
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Return</h1>

      {stage.name === "loading-sources" ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : null}

      {stage.name === "sources-error" ? (
        <Toast variant="error" message={stage.message} />
      ) : null}

      {stage.name === "picking-source" ? (
        <div>
          <p className="mb-2 text-sm text-gray-600">Returning from where?</p>
          <ul className="divide-y divide-gray-100">
            {stage.sources.map((source) => (
              <li key={source.id}>
                <button
                  type="button"
                  onClick={() => pickSource(source, stage.sources)}
                  className="flex min-h-11 w-full items-center justify-between py-3 text-left"
                >
                  <span className="font-medium text-gray-900">{source.name}</span>
                  <span className="text-xs uppercase text-gray-400">{source.kind}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {stage.name === "loading-holdings" ? (
        <p className="text-sm text-gray-500">Loading {stage.source.name}&rsquo;s holdings…</p>
      ) : null}

      {stage.name === "holdings-error" ? (
        <div>
          <Toast
            variant="error"
            message={stage.message}
            actionLabel="Back"
            onAction={() => setStage({ name: "picking-source", sources: stage.sources })}
          />
        </div>
      ) : null}

      {stage.name === "checklist" ? (
        <div>
          <p className="mb-2 text-sm text-gray-600">Returning from {stage.source.name}</p>
          <ReturnChecklist
            items={items}
            extraLines={extraLines}
            quantities={quantities}
            onQtyChange={handleQtyChange}
            onReturnAll={handleReturnAll}
            onAddExtra={handleAddExtra}
            initData={initData}
          />

          <div className="mt-6 flex justify-end">
            <Button onClick={submit} disabled={!isSubmittable || submitting}>
              {submitting ? "Submitting…" : "Done"}
            </Button>
          </div>
        </div>
      ) : null}

      {toast ? (
        <div className="fixed inset-x-4 bottom-4 z-40">
          <Toast
            variant={toast.variant}
            message={toast.message}
            onDismiss={() => setToast(null)}
            actionLabel={toast.variant === "error" ? "Retry" : undefined}
            onAction={toast.variant === "error" ? submit : undefined}
          />
        </div>
      ) : null}
    </div>
  );
}
