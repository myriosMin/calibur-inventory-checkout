import type { ReactNode } from "react";

export interface CardProps {
  /** Renders a bordered header bar above the body. Omit for a plain panel. */
  title?: ReactNode;
  /** Right-aligned controls inside the header bar. Ignored without `title`. */
  actions?: ReactNode;
  /**
   * Wraps the body in `p-4`. Turn it OFF when the body is a DataTable or
   * anything else that should sit flush against the card's border --
   * a table needs its own cell padding, not the card's.
   */
  padded?: boolean;
  children: ReactNode;
  className?: string;
}

/**
 * The admin surface panel: `rounded-xl border border-neutral-800
 * bg-neutral-900`, repeated by hand on every existing admin page.
 */
export default function Card({
  title,
  actions,
  padded = true,
  children,
  className = "",
}: CardProps) {
  return (
    <section
      className={`rounded-xl border border-neutral-800 bg-neutral-900 ${className}`}
    >
      {title ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold text-neutral-100">{title}</h2>
          {actions ? (
            <div className="flex shrink-0 items-center gap-2">{actions}</div>
          ) : null}
        </div>
      ) : null}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}
