"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { IconChevronDown, IconMore } from "@/components/ui/icons";

import { useAnchoredPopover } from "./useAnchoredPopover";

export interface ActionMenuItem {
  label: string;
  /** One-line hint under the label. */
  hint?: string;
  icon?: ReactNode;
  onSelect?: () => void;
  /** Renders a link instead of a button. */
  href?: string;
  /** Amber, like Button's danger variant: retire, revoke, reverse. */
  tone?: "danger";
  disabled?: boolean;
}

export interface ActionMenuProps {
  items: ActionMenuItem[];
  /**
   * With a label: a quiet text button with a chevron ("Export ▾").
   * Without one: the "⋯" overflow trigger for a table row.
   */
  label?: string;
  icon?: ReactNode;
  /** Accessible name for the icon-only trigger. */
  ariaLabel?: string;
  align?: "start" | "end";
  className?: string;
}

/**
 * Where secondary actions go so they stop competing with the one primary
 * action on a page: the "⋯" on a table row, or a labelled menu in a page
 * header. A plain disclosure menu (button + list), keyboard-reachable,
 * Escape and outside-click to close.
 */
export default function ActionMenu({
  items,
  label,
  icon,
  ariaLabel = "More actions",
  align = "end",
  className = "",
}: ActionMenuProps) {
  const { open, toggle, close, triggerRef, panelRef, style } = useAnchoredPopover({ align });

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={(event) => {
          // Rows are clickable; opening a row's menu must not also open the row.
          event.stopPropagation();
          toggle();
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ? undefined : ariaLabel}
        className={
          label
            ? `inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-neutral-800 px-3 text-sm font-medium text-neutral-200 transition-colors hover:border-neutral-700 hover:bg-neutral-800/60 ${className}`
            : `inline-flex size-9 cursor-pointer items-center justify-center rounded-lg text-neutral-400 transition-colors hover:bg-neutral-800 hover:text-neutral-100 ${className}`
        }
      >
        {label ? (
          <>
            {icon}
            {label}
            <IconChevronDown size={14} className="text-neutral-500" />
          </>
        ) : (
          <IconMore size={18} />
        )}
      </button>

      {open ? (
        <div
          ref={panelRef}
          role="menu"
          style={style}
          onClick={(event) => event.stopPropagation()}
          className="animate-fade-in overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 p-1 shadow-2xl shadow-black/60"
        >
          {items.map((item) => {
            const body = (
              <span className="flex items-start gap-2.5">
                {item.icon ? <span className="mt-0.5 shrink-0 text-neutral-400">{item.icon}</span> : null}
                <span className="min-w-0">
                  <span className="block">{item.label}</span>
                  {item.hint ? <span className="block text-xs text-neutral-500">{item.hint}</span> : null}
                </span>
              </span>
            );
            const itemClass = `block w-full cursor-pointer rounded-lg px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              item.tone === "danger"
                ? "text-amber-400 hover:bg-amber-500/10"
                : "text-neutral-200 hover:bg-neutral-800"
            }`;
            return item.href ? (
              <Link key={item.label} href={item.href} role="menuitem" className={itemClass} onClick={close}>
                {body}
              </Link>
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={itemClass}
                onClick={() => {
                  close();
                  item.onSelect?.();
                }}
              >
                {body}
              </button>
            );
          })}
        </div>
      ) : null}
    </>
  );
}
