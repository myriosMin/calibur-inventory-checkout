import type { ReactNode } from "react";

export interface PageHeaderProps {
  title: ReactNode;
  /** One or two sentences under the title. Optional. */
  description?: ReactNode;
  /** Right-aligned controls (buttons, links). Wraps below the title on
   *  phone width rather than squeezing the heading. */
  actions?: ReactNode;
  className?: string;
}

/**
 * The title block every /admin page opens with. Extracted because the five
 * existing pages each hand-rolled it with drifting type scales (`text-lg`
 * vs `text-xl`) and drifting description colors (`text-neutral-300` vs
 * `text-neutral-400`). This standardises on the larger heading and the
 * muted description.
 */
export default function PageHeader({
  title,
  description,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 ${className}`}
    >
      <div className="min-w-0">
        <h1 className="text-xl font-semibold text-neutral-100">{title}</h1>
        {description ? (
          <p className="mt-1 text-sm text-neutral-400">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}
