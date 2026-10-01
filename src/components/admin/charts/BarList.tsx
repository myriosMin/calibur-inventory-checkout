"use client";

import Link from "next/link";
import type { ReactNode } from "react";

export interface BarListItem {
  key: string;
  label: ReactNode;
  value: number;
  /** Text at the end of the row; defaults to the value. */
  display?: ReactNode;
  href?: string;
  /**
   * Draws the bar as a meter against this target (qty vs min_stock) instead
   * of against the longest bar, with a tick where the target sits.
   */
  target?: number;
}

/**
 * A ranked list with an inline bar per row. For "which ones" questions
 * (top holders, what is low, where counts drift), a sorted list beats a
 * chart with axes: the labels stay readable at any length, and each row can
 * be a link or a filter.
 */
export default function BarList({
  items,
  barClass = "bg-chart-1",
  selected,
  onSelect,
  ariaLabel,
}: {
  items: BarListItem[];
  barClass?: string;
  /** Highlights one row when the list doubles as a filter. */
  selected?: string | null;
  onSelect?: (key: string) => void;
  ariaLabel?: string;
}) {
  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <ul aria-label={ariaLabel} className="flex flex-col gap-1">
      {items.map((item) => {
        const fraction = item.target
          ? Math.max(0, Math.min(1, item.value / item.target))
          : Math.max(0, item.value / max);
        const isSelected = selected === item.key;
        const body = (
          <>
            <div className="relative h-7 min-w-0 flex-1">
              {item.target ? (
                <span aria-hidden className="absolute inset-y-0 left-0 right-0 rounded-md bg-neutral-800/50" />
              ) : null}
              <span
                aria-hidden
                className={`absolute inset-y-0 left-0 rounded-md opacity-30 transition-[width] duration-300 ${barClass}`}
                style={{ width: `${Math.max(fraction * 100, item.value > 0 ? 1.5 : 0)}%` }}
              />
              <span className="relative flex h-full items-center truncate px-2 text-sm text-neutral-200">{item.label}</span>
            </div>
            <span className="min-w-12 shrink-0 text-right text-sm tabular-nums text-neutral-300">
              {item.display ?? item.value}
            </span>
          </>
        );
        const rowClass = `flex items-center gap-3 rounded-md ${isSelected ? "ring-1 ring-neutral-500" : ""}`;
        return (
          <li key={item.key}>
            {item.href ? (
              <Link href={item.href} className={`${rowClass} transition-colors hover:bg-neutral-800/40`}>
                {body}
              </Link>
            ) : onSelect ? (
              <button
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelect(item.key)}
                className={`${rowClass} w-full cursor-pointer text-left transition-colors hover:bg-neutral-800/40`}
              >
                {body}
              </button>
            ) : (
              <div className={rowClass}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
