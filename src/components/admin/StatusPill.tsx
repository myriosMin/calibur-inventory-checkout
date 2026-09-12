import type { ReactNode } from "react";

/**
 * `active`/`inactive` are the two that exist today (green / neutral),
 * repeated verbatim five times across the admin pages. `warning` and
 * `danger` are here for the stocktake-variance and low-stock surfaces --
 * amber for "look at this", red for "this is wrong". Deliberately a closed
 * set rather than a free `color` prop, so a sixth shade of green can't
 * appear by accident.
 */
export type StatusTone = "active" | "inactive" | "warning" | "danger";

export interface StatusPillProps {
  tone?: StatusTone;
  children: ReactNode;
  className?: string;
}

const TONE_CLASSES: Record<StatusTone, string> = {
  active: "bg-green-500/10 text-green-400",
  inactive: "bg-neutral-800 text-neutral-300",
  warning: "bg-amber-500/10 text-amber-400",
  danger: "bg-red-500/10 text-red-400",
};

export default function StatusPill({
  tone = "inactive",
  children,
  className = "",
}: StatusPillProps) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASSES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
