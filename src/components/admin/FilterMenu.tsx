"use client";

import type { ReactNode } from "react";

import { IconFilter } from "@/components/ui/icons";

import { useAnchoredPopover } from "./useAnchoredPopover";

/**
 * The rarely-changed filters (category, criticality, status...) behind one
 * "Filters" button, so the filter row shows only search and the one filter
 * people actually reach for. The count says how many are set.
 */
export default function FilterMenu({
  activeCount,
  onReset,
  children,
}: {
  activeCount: number;
  onReset?: () => void;
  children: ReactNode;
}) {
  const { open, toggle, triggerRef, panelRef, style } = useAnchoredPopover({ width: 288 });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm transition-colors ${
          activeCount > 0
            ? "border-neutral-600 bg-neutral-800 text-neutral-100"
            : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
        }`}
      >
        <IconFilter size={15} />
        Filters
        {activeCount > 0 ? <span className="tabular-nums text-xs text-neutral-300">{activeCount}</span> : null}
      </button>
      {open ? (
        <div
          ref={panelRef}
          style={style}
          className="animate-fade-in flex flex-col gap-3 rounded-xl border border-neutral-800 bg-neutral-900 p-4 shadow-2xl shadow-black/60"
        >
          {children}
          {onReset && activeCount > 0 ? (
            <button
              type="button"
              onClick={onReset}
              className="self-start text-sm text-neutral-400 underline-offset-4 hover:text-neutral-100 hover:underline"
            >
              Reset filters
            </button>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
