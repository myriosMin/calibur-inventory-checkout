"use client";

import type { ReactNode } from "react";
import { useEffect } from "react";

import { IconX } from "./icons";

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
}

/**
 * Bottom-sheet primitive for pickers/search on a phone-width screen.
 * Slides up from the bottom, covers part of the viewport, dismissible via
 * the backdrop, the close button, or Escape. Pads for the device's bottom
 * safe-area (Telegram chrome / home indicator) with a sensible fallback.
 */
export default function Sheet({
  open,
  onClose,
  title,
  children,
  className = "",
}: SheetProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center">
      <button
        type="button"
        aria-label="Close sheet"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-sheet-up relative z-10 w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl bg-white shadow-xl ${className}`}
        style={{
          paddingBottom: "max(env(safe-area-inset-bottom, 0px), 16px)",
        }}
      >
        <div className="sticky top-0 flex items-center justify-between rounded-t-2xl bg-white px-4 pb-2 pt-3">
          <span className="mx-auto block h-1.5 w-10 rounded-full bg-slate-300" />
        </div>
        <div className="px-4 pb-2">
          {title ? (
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-slate-500 hover:bg-slate-100"
              >
                <IconX size={18} />
              </button>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </div>
  );
}
