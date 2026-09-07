"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import Button from "@/components/ui/Button";
import Sheet from "@/components/ui/Sheet";
import { IconCamera } from "@/components/ui/icons";
import { getWebApp, parseStartAppCode } from "@/lib/telegram/webapp-client";

import SearchSheet, { type SearchProduct } from "./components/SearchSheet";

/**
 * Cross-WP handoff contract (documented here for WP16, the borrow flow UI):
 *
 * When this page resolves a scanned or searched-for product, it writes the
 * chosen product to `sessionStorage` under this key, JSON-stringified as a
 * `PendingScanPayload`, then navigates to `/store/borrow`. There is no
 * shared cart state/context yet (WP16 owns that), so this is the agreed
 * hand-off surface: WP16's borrow page should, on mount, read this key,
 * `JSON.parse` it, add `payload.product` as the first cart line (this is
 * also where the "scanning the same productId again increments qty" rule
 * from flows.md would first come into play), and then
 * `sessionStorage.removeItem(PENDING_SCAN_STORAGE_KEY)` so a later
 * back-navigation to /store/borrow doesn't silently re-add it.
 *
 * The top-level chooser's "Borrow" button always opens the scanner first
 * (see handleBorrow below) and only navigates here once a product resolves,
 * so this key is normally always present on arrival -- but the borrow page
 * still treats an absent/unparseable key as "start with an empty cart," not
 * an error, since /store/borrow is a real route reachable directly (a
 * bookmark, browser back/forward) without going through this handoff at all.
 */
export const PENDING_SCAN_STORAGE_KEY = "tele-qr:pending-scan";

export interface PendingScanProduct {
  id: string;
  name: string;
  tier: "asset" | "bulk" | "loose";
  unit: string;
  category?: string | null;
  spec?: Record<string, unknown> | null;
  returnable?: boolean;
}

export interface PendingScanPayload {
  /** The scan code that resolved to this product, or `null` when the
   * product was reached via search (retired-code fallback, the group-pick
   * sheet, or the top-level manual search) rather than a direct code match. */
  code: string | null;
  product: PendingScanProduct;
}

interface ResolveLocationPayload {
  id: string;
  name: string;
}

type ResolveSuccess =
  | { kind: "product"; product: PendingScanProduct }
  | { kind: "group"; location: ResolveLocationPayload; products: PendingScanProduct[] };

type ViewState =
  | { name: "loading" }
  | { name: "top-level" }
  | { name: "group-pick"; location: ResolveLocationPayload; products: PendingScanProduct[] }
  | { name: "retired" }
  | { name: "error"; message: string };

export default function StorePage() {
  const router = useRouter();
  const [view, setView] = useState<ViewState>({ name: "loading" });
  const [searchOpen, setSearchOpen] = useState(false);
  const [initData, setInitData] = useState("");

  const goToBorrow = useCallback(
    (code: string | null, product: PendingScanProduct) => {
      const payload: PendingScanPayload = { code, product };
      try {
        window.sessionStorage.setItem(PENDING_SCAN_STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // sessionStorage can throw in locked-down WebViews (private mode,
        // storage disabled). Proceed anyway -- the borrow page just starts
        // with an empty cart instead of the pre-added item.
      }
      router.push("/store/borrow");
    },
    [router],
  );

  const resolveCode = useCallback(
    async (rawInitData: string, code: string) => {
      setView({ name: "loading" });
      try {
        const res = await fetch("/api/store/resolve", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Telegram-Init-Data": rawInitData,
          },
          body: JSON.stringify({ code }),
        });

        if (res.status === 404) {
          setView({ name: "retired" });
          return;
        }
        if (!res.ok) {
          setView({ name: "error", message: `Couldn't resolve that code (${res.status}).` });
          return;
        }

        const data = (await res.json()) as ResolveSuccess;
        if (data.kind === "product") {
          goToBorrow(code, data.product);
        } else {
          setView({ name: "group-pick", location: data.location, products: data.products });
        }
      } catch (err) {
        setView({
          name: "error",
          message: err instanceof Error ? err.message : "Couldn't resolve that code.",
        });
      }
    },
    [goToBorrow],
  );

  // Reads the Telegram launch context and either kicks off a resolve
  // (scanned/deep-linked in) or shows the top-level chooser (opened from the
  // bot's menu button). Wrapped in useCallback and invoked from the effect
  // below rather than inlined directly in the effect body, so it runs once
  // on mount.
  const initFromLaunchContext = useCallback(() => {
    let webApp;
    try {
      webApp = getWebApp();
    } catch (err) {
      setView({
        name: "error",
        message:
          err instanceof Error ? err.message : "This page must be opened inside Telegram.",
      });
      return;
    }

    setInitData(webApp.initData);

    const startParam = webApp.startParam;
    if (!startParam) {
      setView({ name: "top-level" });
      return;
    }

    const code = parseStartAppCode(startParam);
    if (!code) {
      setView({ name: "retired" });
      return;
    }

    void resolveCode(webApp.initData, code);
  }, [resolveCode]);

  useEffect(() => {
    // This mount effect exists specifically to synchronize view state with
    // an external system (window.Telegram.WebApp / a resolve fetch that
    // depends on it), which is unavailable during SSR -- there is no
    // derive-during-render alternative here, and no ongoing subscription to
    // move the setState calls into (the resolve is a one-shot request, not a
    // stream of events). Per the plan's WP15 contract this must run exactly
    // once per mount to route based on Telegram's launch startParam.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    initFromLaunchContext();
  }, [initFromLaunchContext]);

  // "Borrow" and the old standalone "Scan" button led to the exact same
  // place -- a borrow cart -- with Scan just skipping straight to the
  // camera. Since they were functionally identical, Borrow now *is* that
  // fast path: tapping it opens the scanner immediately rather than
  // dropping the member into an empty cart they'd have to tap "Scan more"
  // from. (Return is deliberately camera-free -- see its own handler.)
  const handleBorrow = useCallback(() => {
    let webApp;
    try {
      webApp = getWebApp();
    } catch (err) {
      setView({
        name: "error",
        message: err instanceof Error ? err.message : "Scanning is unavailable.",
      });
      return;
    }

    webApp.showScanQrPopup({ text: "Scan a part or bin label" }, (raw) => {
      const code = parseStartAppCode(raw);
      if (!code) return false; // garbage/empty scan -- keep the popup open
      void resolveCode(webApp.initData, code);
      return true; // we're handling it -- close the popup
    });
  }, [resolveCode]);

  const handleSearchSelect = useCallback(
    (product: SearchProduct) => {
      setSearchOpen(false);
      goToBorrow(null, product);
    },
    [goToBorrow],
  );

  if (view.name === "loading") {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <p className="text-sm text-neutral-400">Loading…</p>
      </main>
    );
  }

  if (view.name === "error") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
        <p className="text-sm text-red-400">{view.message}</p>
      </main>
    );
  }

  if (view.name === "retired") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
        <p className="text-base text-neutral-100">This label is retired or unrecognised.</p>
        <Button onClick={() => setSearchOpen(true)}>Search instead</Button>
        <SearchSheet
          open={searchOpen}
          onClose={() => setSearchOpen(false)}
          initData={initData}
          onSelect={handleSearchSelect}
        />
      </main>
    );
  }

  if (view.name === "group-pick") {
    return (
      <Sheet open onClose={() => setView({ name: "top-level" })} title={view.location.name}>
        <ul className="divide-y divide-neutral-800">
          {view.products.map((product) => (
            <li key={product.id}>
              <button
                type="button"
                onClick={() => goToBorrow(null, product)}
                className="flex min-h-11 w-full items-center justify-between py-2 text-left"
              >
                <span className="font-medium text-neutral-100">{product.name}</span>
                <span className="text-xs uppercase text-neutral-600">{product.tier}</span>
              </button>
            </li>
          ))}
        </ul>
      </Sheet>
    );
  }

  // view.name === "top-level" (opened from the bot's menu button, no scan).
  // Two buttons, two unambiguous intentions: Borrow opens the camera
  // immediately (the old standalone "Scan" button was a redundant third
  // doorway to the same borrow cart); Return never scans by design
  // (flows.md -- a robot's installed parts have buried stickers), so it
  // just goes straight to the holdings checklist.
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6">
      <h1 className="text-lg font-semibold text-neutral-100">Parts Store</h1>
      <div className="flex w-full max-w-xs flex-col gap-3">
        <Button onClick={handleBorrow} className="gap-2">
          <IconCamera size={18} /> Borrow
        </Button>
        <Button variant="secondary" onClick={() => router.push("/store/return")}>
          Return
        </Button>
      </div>
      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        initData={initData}
        onSelect={handleSearchSelect}
      />
    </main>
  );
}
