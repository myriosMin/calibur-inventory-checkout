"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";

/**
 * Open/close state plus viewport-fixed placement for a small popover (a menu
 * or an info tip) anchored under a trigger.
 *
 * `position: fixed` rather than absolute: these sit inside DataTable's
 * `overflow-x-auto` wrapper, which would clip an absolutely positioned
 * menu on the last rows. It closes on Escape, an outside click, scroll and
 * resize, since a fixed panel would otherwise drift away from its trigger.
 */
export function useAnchoredPopover<T extends HTMLElement = HTMLButtonElement>({
  width = 224,
  align = "end",
}: { width?: number; align?: "start" | "end" } = {}) {
  const triggerRef = useRef<T>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [style, setStyle] = useState<CSSProperties>({});

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => setOpen((value) => !value), []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    const maxWidth = Math.min(width, window.innerWidth - margin * 2);
    let left = align === "end" ? rect.right - maxWidth : rect.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - maxWidth - margin));
    const below = rect.bottom + 6;
    // Flip above the trigger when there's no room below (bottom rows of a table).
    const panelHeight = panelRef.current?.offsetHeight ?? 0;
    const top = below + panelHeight > window.innerHeight - margin && rect.top > panelHeight + margin
      ? rect.top - panelHeight - 6
      : below;
    setStyle({ position: "fixed", top, left, width: maxWidth, zIndex: 60 });
  }, [open, width, align]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || triggerRef.current?.contains(target)) return;
      setOpen(false);
    };
    const onMove = () => setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    window.addEventListener("resize", onMove);
    window.addEventListener("scroll", onMove, true);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("resize", onMove);
      window.removeEventListener("scroll", onMove, true);
    };
  }, [open]);

  return { open, setOpen, toggle, close, triggerRef, panelRef, style };
}
