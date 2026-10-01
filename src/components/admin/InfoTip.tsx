"use client";

import type { ReactNode } from "react";

import { IconInfo } from "@/components/ui/icons";

import { useAnchoredPopover } from "./useAnchoredPopover";

/**
 * The explanation behind a page or a number, one click away instead of a
 * paragraph in everyone's way. The reasoning these pages used to print in
 * full (why a negative balance isn't a shortage, why admin entries are
 * excluded from the scan ratio) is still here, just not shouting.
 */
export default function InfoTip({
  children,
  label = "More about this",
  width = 320,
}: {
  children: ReactNode;
  label?: string;
  width?: number;
}) {
  const { open, toggle, triggerRef, panelRef, style } = useAnchoredPopover({ width, align: "start" });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          toggle();
        }}
        aria-expanded={open}
        aria-label={label}
        className="inline-flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full align-middle text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-200"
      >
        <IconInfo size={15} />
      </button>
      {open ? (
        <div
          ref={panelRef}
          role="note"
          style={style}
          className="animate-fade-in rounded-xl border border-neutral-800 bg-neutral-900 p-3 text-sm leading-relaxed font-normal normal-case tracking-normal text-neutral-300 shadow-2xl shadow-black/60 [&_p+p]:mt-2"
        >
          {children}
        </div>
      ) : null}
    </>
  );
}
