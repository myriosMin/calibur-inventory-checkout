"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import { useRouter } from "next/navigation";

import Toast from "@/components/ui/Toast";
import SearchSheet, { type SearchProduct } from "@/app/store/components/SearchSheet";
import Cart from "@/app/store/components/Cart";
import DestinationPicker, { type DestinationOption } from "@/app/store/components/DestinationPicker";
import QuantityPrompt from "@/app/store/components/QuantityPrompt";
import GroupPicker, { type GroupPickerProduct } from "@/app/store/components/GroupPicker";
import {
  cartReducer,
  initialCartState,
  type CartProduct,
  type EntryMethod,
} from "@/app/store/components/cartReducer";
import { getWebApp, parseStartAppCode } from "@/lib/telegram/webapp-client";

/** sessionStorage handoff key written by the /store entry page (WP15) when a
 * scanned code resolves to a product (or a group-pick selection) before
 * navigating here -- see the WP15/WP16 cross-WP contract. */
const PENDING_SCAN_KEY = "tele-qr:pending-scan";

/**
 * Matches WP15's actual `PendingScanPayload` (src/app/store/page.tsx):
 * `code` is `null` whenever the item was reached via search or the
 * group-pick sheet on the entry page rather than a direct product scan --
 * that payload shape doesn't carry an explicit entryMethod, so it's
 * inferred here from whether `code` is present (see beginIntake call
 * below; documented as a known cross-WP gap in the WP16 report).
 */
interface PendingScanPayload {
  code: string | null;
  product: CartProduct;
}

interface PendingIntake {
  product: CartProduct;
  entryMethod: EntryMethod;
  scanCode?: string;
}

interface ToastState {
  variant: "success" | "error" | "info";
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}

type ResolveResponse =
  | { kind: "product"; product: CartProduct }
  | { kind: "group"; location: { id: string; name: string }; products: GroupPickerProduct[] };

export default function BorrowPage() {
  const router = useRouter();
  const [state, dispatch] = useReducer(cartReducer, undefined, initialCartState);

  const [pendingIntake, setPendingIntake] = useState<PendingIntake | null>(null);
  const [destPickerOpen, setDestPickerOpen] = useState(false);
  const [destOptions, setDestOptions] = useState<DestinationOption[]>([]);
  const [destLoading, setDestLoading] = useState(false);
  const [destError, setDestError] = useState<string | null>(null);

  const [groupPicker, setGroupPicker] = useState<{
    open: boolean;
    locationName?: string;
    products: GroupPickerProduct[];
    scanCode?: string;
  }>({ open: false, products: [] });

  const [searchOpen, setSearchOpen] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // getWebApp() throws when window.Telegram.WebApp is absent and dev mocks
  // are disabled -- it must never run during SSR (client components still
  // render once on the server for the initial HTML), so it's read lazily
  // here rather than at the top of the render body.
  const [initData, setInitData] = useState("");

  // Proceed a pending intake to the quantity step (or straight to ADD_ITEM
  // for assets, which never get a prompt).
  const proceedToQuantity = useCallback((pending: PendingIntake) => {
    if (pending.product.tier === "asset") {
      dispatch({
        type: "ADD_ITEM",
        product: pending.product,
        qty: 1,
        scanCode: pending.scanCode,
        entryMethod: pending.entryMethod,
      });
      setPendingIntake(null);
    } else {
      setPendingIntake(pending);
    }
  }, []);

  const loadDestinationOptions = useCallback(async () => {
    setDestLoading(true);
    setDestError(null);
    try {
      const res = await fetch("/api/store/destinations", {
        headers: { "X-Telegram-Init-Data": initData },
      });
      if (!res.ok) throw new Error(`destinations failed (${res.status})`);
      const data = (await res.json()) as { holders: DestinationOption[] };
      setDestOptions(data.holders);
    } catch {
      setDestError("Couldn't load destinations — you can still pick Personal / bench.");
      setDestOptions([]);
    } finally {
      setDestLoading(false);
    }
  }, [initData]);

  // Kick off an item add: first item of the session triggers the
  // destination picker (asked once, then fixed); every later item skips
  // straight to the quantity step.
  const beginIntake = useCallback(
    (product: CartProduct, entryMethod: EntryMethod, scanCode?: string) => {
      const pending: PendingIntake = { product, entryMethod, scanCode };
      if (state.destHolderId === null) {
        setPendingIntake(pending);
        setDestPickerOpen(true);
        void loadDestinationOptions();
      } else {
        proceedToQuantity(pending);
      }
    },
    [state.destHolderId, loadDestinationOptions, proceedToQuantity],
  );

  // Read the Telegram WebApp client on mount only -- client-side, after
  // hydration, never during SSR (getWebApp() throws when `window` is
  // absent). This synchronizes React state with an external browser
  // global that simply isn't there yet during the initial render, which is
  // exactly what an effect is for; the "no setState in effect" lint rule
  // is aimed at derived-state anti-patterns, not this (same rationale WP15
  // uses for the identical pattern in src/app/store/page.tsx).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setInitData(getWebApp().initData);
  }, []);

  // On mount: consume the /store entry page's sessionStorage handoff, if
  // any -- another external-system read (browser sessionStorage) that must
  // happen post-mount.
  useEffect(() => {
    const raw = sessionStorage.getItem(PENDING_SCAN_KEY);
    if (!raw) return;
    sessionStorage.removeItem(PENDING_SCAN_KEY);
    try {
      const payload = JSON.parse(raw) as PendingScanPayload;
      if (payload?.product?.id) {
        // WP15's payload has no entryMethod field, so it's inferred here:
        // a non-null `code` means the entry page resolved a direct product
        // scan; `null` covers both "picked from the group sheet" and
        // "picked via top-level search" (WP15's payload doesn't
        // distinguish the two), so it's treated as 'search'.
        const entryMethod: EntryMethod = payload.code ? "scan" : "search";
        // eslint-disable-next-line react-hooks/set-state-in-effect
        beginIntake(payload.product, entryMethod, payload.code ?? undefined);
      }
    } catch {
      // Malformed handoff payload -- ignore, member just sees an empty cart.
    }
    // Intentionally run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDestinationSelect = (option: DestinationOption) => {
    dispatch({ type: "SET_DEST", destHolderId: option.id, destHolderName: option.name });
    setDestPickerOpen(false);
    if (pendingIntake) proceedToQuantity(pendingIntake);
  };

  const handleDestinationClose = () => {
    setDestPickerOpen(false);
    setPendingIntake(null); // abort the item that triggered the picker
  };

  const handleQuantityConfirm = (qty: number) => {
    if (!pendingIntake) return;
    dispatch({
      type: "ADD_ITEM",
      product: pendingIntake.product,
      qty,
      scanCode: pendingIntake.scanCode,
      entryMethod: pendingIntake.entryMethod,
    });
    setPendingIntake(null);
  };

  const handleQuantityClose = () => {
    setPendingIntake(null); // abort without adding
  };

  const resolveAndAdd = useCallback(
    async (code: string) => {
      try {
        const res = await fetch("/api/store/resolve", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData },
          body: JSON.stringify({ code }),
        });
        if (res.status === 404) {
          setToast({ variant: "error", message: "This label is retired or unrecognised — try search." });
          return;
        }
        if (!res.ok) {
          setToast({ variant: "error", message: "Couldn't look up that code — try again." });
          return;
        }
        const data = (await res.json()) as ResolveResponse;
        if (data.kind === "product") {
          beginIntake(data.product, "scan", code);
        } else {
          setGroupPicker({
            open: true,
            locationName: data.location.name,
            products: data.products,
            scanCode: code,
          });
        }
      } catch {
        setToast({ variant: "error", message: "Network error — try again." });
      }
    },
    [initData, beginIntake],
  );

  const handleScanMore = () => {
    getWebApp().showScanQrPopup({ text: "Scan the next item" }, (raw: string) => {
      const code = parseStartAppCode(raw);
      if (code) void resolveAndAdd(code);
      return false; // keep the scanner open -- see docs/tele-qr/flows.md §2
    });
  };

  const handleGroupSelect = (product: GroupPickerProduct) => {
    setGroupPicker({ open: false, products: [] });
    beginIntake(product, "group_pick", groupPicker.scanCode);
  };

  const handleSearchSelect = (product: SearchProduct) => {
    setSearchOpen(false);
    beginIntake(product, "search");
  };

  const submitCart = useCallback(async () => {
    if (state.lines.size === 0 || state.destHolderId === null) return;
    setSubmitting(true);
    setToast(null);
    const lines = [...state.lines.values()].map((line) => ({
      productId: line.product.id,
      qty: line.qty,
      scanCode: line.scanCode,
      entryMethod: line.entryMethod,
    }));
    try {
      const res = await fetch("/api/store/cart/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Telegram-Init-Data": initData },
        body: JSON.stringify({ mode: "borrow", destHolderId: state.destHolderId, lines }),
      });
      if (res.ok) {
        dispatch({ type: "CLEAR" });
        setToast({ variant: "success", message: "Submitted." });
        router.push("/store");
      } else {
        // Never clear the cart on a non-200 response (docs/tele-qr/flows.md
        // "Supabase unreachable at submit" -- cart is client state, retry
        // without losing it).
        setToast({
          variant: "error",
          message: `Couldn't submit (${res.status}) — nothing was lost.`,
          actionLabel: "Retry",
          onAction: () => void submitCart(),
        });
      }
    } catch {
      setToast({
        variant: "error",
        message: "Network error — nothing was lost.",
        actionLabel: "Retry",
        onAction: () => void submitCart(),
      });
    } finally {
      setSubmitting(false);
    }
  }, [state.lines, state.destHolderId, initData, router]);

  const handleCancel = () => {
    dispatch({ type: "CLEAR" });
    router.push("/store");
  };

  const cartLines = [...state.lines.values()].map((line) => ({
    productId: line.product.id,
    name: line.product.name,
    unit: line.product.unit,
    qty: line.qty,
  }));

  // Gated on `!destPickerOpen`: for the very first item of the session,
  // `pendingIntake` is set the moment the destination picker opens (so it's
  // available once a destination is chosen), but the quantity step must
  // wait until *after* that picker closes -- otherwise both sheets would be
  // open at once.
  const quantityPromptProduct =
    !destPickerOpen &&
    pendingIntake &&
    (pendingIntake.product.tier === "bulk" || pendingIntake.product.tier === "loose")
      ? { name: pendingIntake.product.name, tier: pendingIntake.product.tier, unit: pendingIntake.product.unit }
      : null;

  return (
    <>
      <Cart
        destHolderName={state.destHolderName}
        lines={cartLines}
        onQtyChange={(productId, qty) => dispatch({ type: "SET_LINE_QTY", productId, qty })}
        onScanMore={handleScanMore}
        onSearch={() => setSearchOpen(true)}
        onDone={() => void submitCart()}
        onCancel={handleCancel}
        submitting={submitting}
      />

      <DestinationPicker
        open={destPickerOpen}
        options={destOptions}
        loading={destLoading}
        error={destError}
        onSelect={handleDestinationSelect}
        onClose={handleDestinationClose}
      />

      <QuantityPrompt
        open={quantityPromptProduct !== null}
        product={quantityPromptProduct}
        onConfirm={handleQuantityConfirm}
        onClose={handleQuantityClose}
      />

      <GroupPicker
        open={groupPicker.open}
        locationName={groupPicker.locationName}
        products={groupPicker.products}
        onSelect={handleGroupSelect}
        onClose={() => setGroupPicker({ open: false, products: [] })}
      />

      <SearchSheet
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        initData={initData}
        onSelect={handleSearchSelect}
      />

      {toast ? (
        <div className="fixed inset-x-0 bottom-0 z-50 p-4">
          <Toast
            variant={toast.variant}
            message={toast.message}
            actionLabel={toast.actionLabel}
            onAction={toast.onAction}
            onDismiss={() => setToast(null)}
          />
        </div>
      ) : null}
    </>
  );
}
