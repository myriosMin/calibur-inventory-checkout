"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
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
 * localStorage key remembering the member's last-used borrow destination on
 * this device. Resolves flows.md's open question ("should the destination
 * prompt remember the member's last choice as a default? Likely yes") --
 * most people work on one robot for weeks at a stretch, so re-asking every
 * session was pure tap overhead. Still fully overridable via Cart's "Change"
 * link, since a stale/retired holder must never dead-end a borrow.
 */
const LAST_DEST_KEY = "tele-qr:last-dest";

function readLastDestination(): DestinationOption | null {
  try {
    const raw = window.localStorage.getItem(LAST_DEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<DestinationOption>;
    if (typeof parsed.id === "string" && typeof parsed.name === "string") {
      return { id: parsed.id, name: parsed.name };
    }
  } catch {
    // Corrupt or inaccessible storage -- fall back to asking, same as a
    // first-ever visit.
  }
  return null;
}

function writeLastDestination(option: DestinationOption) {
  try {
    window.localStorage.setItem(LAST_DEST_KEY, JSON.stringify(option));
  } catch {
    // Storage disabled/full -- non-fatal, the member just gets re-asked next time.
  }
}

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

  // Continuous-scan handoff (see handleScanMore below): the native camera
  // popup is closed the instant a code is scanned so the follow-up sheets
  // (destination / quantity / group-pick) render on top of it instead of
  // hiding behind it. `resumeScanRef` remembers that the popup was closed
  // "for" the scan currently being processed; every point where that chain
  // can end -- successfully added to cart, aborted, or resolve failed --
  // bumps `scanResumeTick`, and the effect below reopens the camera iff the
  // ref is still armed. A ref (not state) so it can be read/cleared inside
  // the showScanQrPopup callback without a stale closure.
  const resumeScanRef = useRef(false);
  const [scanResumeTick, setScanResumeTick] = useState(0);
  const requestScanResume = useCallback(() => setScanResumeTick((tick) => tick + 1), []);

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
      requestScanResume();
    } else {
      setPendingIntake(pending);
    }
  }, [requestScanResume]);

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

  // Kick off an item add: first item of the session either auto-fills the
  // remembered last destination (0 taps) or triggers the destination picker
  // when there isn't one yet; every later item skips straight to the
  // quantity step.
  const beginIntake = useCallback(
    (product: CartProduct, entryMethod: EntryMethod, scanCode?: string) => {
      const pending: PendingIntake = { product, entryMethod, scanCode };
      if (state.destHolderId === null) {
        const remembered = readLastDestination();
        if (remembered) {
          dispatch({
            type: "SET_DEST",
            destHolderId: remembered.id,
            destHolderName: remembered.name,
          });
          // Prefetch in the background so tapping "Change" in Cart opens
          // instantly instead of showing a loading state.
          void loadDestinationOptions();
          // The auto-fill is silent and sticks across every future cart on
          // this device (readLastDestination persists to localStorage
          // indefinitely) -- without this, it's easy to keep assuming a
          // destination from days ago and never notice. Surface it once, up
          // front, with an immediate way to correct it.
          setToast({
            variant: "info",
            message: `Assuming ${remembered.name} as destination.`,
            actionLabel: "Change",
            onAction: () => {
              setToast(null);
              // Abort whatever quantity question this item may have queued
              // up (mirrors handleQuantityClose) -- reopening the
              // destination picker while both sheets are stacked would
              // otherwise render on top of each other.
              setPendingIntake(null);
              setDestPickerOpen(true);
              void loadDestinationOptions();
            },
          });
          proceedToQuantity(pending);
          return;
        }
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
    writeLastDestination(option);
    // SET_DEST is a one-shot guard (never re-fires once destHolderId is
    // set) -- reopening the picker via Cart's "Change" link needs
    // CHANGE_DEST instead, which always applies.
    dispatch(
      state.destHolderId === null
        ? { type: "SET_DEST", destHolderId: option.id, destHolderName: option.name }
        : { type: "CHANGE_DEST", destHolderId: option.id, destHolderName: option.name },
    );
    setDestPickerOpen(false);
    if (pendingIntake) {
      proceedToQuantity(pendingIntake);
    } else {
      // No item attached to this pick -- either the plain Cart "Change"
      // link, or the auto-fill toast's "Change" (which drops the item that
      // was mid-question so the two sheets never stack; see beginIntake).
      // proceedToQuantity would otherwise be the one to resume the camera,
      // so it has to happen here instead.
      requestScanResume();
    }
  };

  const handleDestinationClose = () => {
    setDestPickerOpen(false);
    setPendingIntake(null); // abort the item that triggered the picker
    requestScanResume();
  };

  // "Change" link in Cart -- only ever shown once a destination exists, so
  // there's no pendingIntake to worry about aborting.
  const handleChangeDestination = () => {
    setDestPickerOpen(true);
    void loadDestinationOptions();
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
    requestScanResume();
  };

  const handleQuantityClose = () => {
    setPendingIntake(null); // abort without adding
    requestScanResume();
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
          requestScanResume();
          return;
        }
        if (!res.ok) {
          setToast({ variant: "error", message: "Couldn't look up that code — try again." });
          requestScanResume();
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
        requestScanResume();
      }
    },
    [initData, beginIntake, requestScanResume],
  );

  // Continuous scan, made seamless: the native camera popup is closed the
  // moment a code comes back (`return true`) instead of being kept open
  // underneath whatever follow-up sheet the scan triggers (destination /
  // quantity / group-pick), which previously forced the member to back out
  // of the camera to reach questions rendered behind it. `resumeScanRef` is
  // armed here and consumed by the effect below once that chain ends, which
  // reopens the popup automatically -- so scanning feels continuous even
  // though the camera technically closes for each item.
  const handleScanMore = useCallback(() => {
    getWebApp().showScanQrPopup({ text: "Scan the next item" }, (raw: string) => {
      const code = parseStartAppCode(raw);
      if (!code) return false; // garbage/empty scan -- keep the popup open
      resumeScanRef.current = true;
      void resolveAndAdd(code);
      return true; // close now -- follow-up questions take over, camera reopens after
    });
  }, [resolveAndAdd]);

  // Fires whenever a scan-triggered intake chain ends (item added, aborted,
  // or resolve failed) via requestScanResume(); reopens the camera only if
  // that chain was actually started from the scanner (resumeScanRef), never
  // for items added via search/group-pick alone.
  useEffect(() => {
    if (scanResumeTick === 0) return; // skip the initial mount
    if (!resumeScanRef.current) return;
    resumeScanRef.current = false;
    handleScanMore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scanResumeTick]);

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
        onChangeDestination={state.destHolderId !== null ? handleChangeDestination : undefined}
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
        onClose={() => {
          setGroupPicker({ open: false, products: [] });
          requestScanResume();
        }}
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
