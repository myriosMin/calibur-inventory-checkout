"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { IconX } from "@/components/ui/icons";

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Sticky action row at the bottom: the submit button, then Cancel. */
  footer?: ReactNode;
  /** Wider for forms with two-column fields. */
  size?: "md" | "lg";
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Right-hand panel for create and edit forms -- the admin counterpart of the
 * Mini App's bottom Sheet. Forms used to sit open on every page; behind a
 * drawer they cost one click when wanted and nothing when not, and the list
 * behind stays visible for context.
 *
 * Modal: Escape and the backdrop close it, Tab is kept inside it, focus
 * moves in on open and back to whatever opened it on close, and the page
 * behind doesn't scroll.
 */
export default function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    // First field, not the close button: the drawer exists to be typed into.
    const first =
      panel?.querySelector<HTMLElement>("input:not([disabled]), select:not([disabled]), textarea:not([disabled])") ??
      panel?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const firstEl = focusable[0];
      const lastEl = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      opener?.focus?.();
    };
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label="Close panel"
        tabIndex={-1}
        onClick={onClose}
        className="animate-fade-in absolute inset-0 cursor-default bg-black/60 backdrop-blur-[1px]"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`animate-drawer-in relative flex h-full w-full flex-col border-l border-neutral-800 bg-neutral-950 shadow-2xl ${
          size === "lg" ? "sm:max-w-2xl" : "sm:max-w-md"
        }`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-neutral-800 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-neutral-100">{title}</h2>
            {description ? <p className="mt-0.5 text-sm text-neutral-400">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100"
          >
            <IconX size={18} />
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer className="flex flex-wrap items-center gap-2 border-t border-neutral-800 px-5 py-3">{footer}</footer>
        ) : null}
      </div>
    </div>
  );
}
