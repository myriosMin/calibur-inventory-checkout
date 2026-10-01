import type { ReactNode } from "react";

import InfoTip from "./InfoTip";

export interface PageHeaderProps {
  title: ReactNode;
  /** One short line under the title. The why goes in `info`. */
  description?: ReactNode;
  /** The longer explanation, behind an (i) next to the title. */
  info?: ReactNode;
  /**
   * Right-aligned controls. At most ONE primary button here; everything
   * else is secondary/ghost or lives in an ActionMenu. Wraps below the
   * title at phone width rather than squeezing the heading.
   */
  actions?: ReactNode;
  className?: string;
}

/** The title block every /admin page opens with. */
export default function PageHeader({
  title,
  description,
  info,
  actions,
  className = "",
}: PageHeaderProps) {
  return (
    <div className={`flex flex-wrap items-end justify-between gap-3 ${className}`}>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <h1 className="text-2xl font-semibold tracking-tight text-neutral-100">{title}</h1>
          {info ? <InfoTip>{info}</InfoTip> : null}
        </div>
        {description ? <p className="mt-0.5 text-sm text-neutral-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
