import type { ReactNode } from "react";

import InfoTip from "./InfoTip";

export interface CardProps {
  /** Renders a header bar above the body. Omit for a plain panel. */
  title?: ReactNode;
  /** A short muted line under the title. */
  subtitle?: ReactNode;
  /** The why, behind an (i) next to the title. Ignored without `title`. */
  info?: ReactNode;
  /** Right-aligned controls in the header bar. Ignored without `title`. */
  actions?: ReactNode;
  /**
   * Wraps the body in padding. Turn it OFF when the body is a DataTable or
   * anything else that should sit flush against the card's border -- a
   * table needs its own cell padding, not the card's.
   */
  padded?: boolean;
  children: ReactNode;
  className?: string;
}

/** The admin surface panel. */
export default function Card({
  title,
  subtitle,
  info,
  actions,
  padded = true,
  children,
  className = "",
}: CardProps) {
  return (
    <section className={`min-w-0 rounded-xl border border-neutral-800 bg-neutral-900/60 ${className}`}>
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-1 pt-3.5">
          <div className="min-w-0">
            <div className="flex items-center gap-1">
              <h2 className="text-base font-semibold text-neutral-100">{title}</h2>
              {info ? <InfoTip>{info}</InfoTip> : null}
            </div>
            {subtitle ? <p className="text-xs text-neutral-500">{subtitle}</p> : null}
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : null}
      <div className={padded ? "p-4" : title ? "pt-2" : ""}>{children}</div>
    </section>
  );
}
