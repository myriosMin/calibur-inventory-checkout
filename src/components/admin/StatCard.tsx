import Link from "next/link";
import type { ReactNode } from "react";

import { IconChevronRight } from "@/components/ui/icons";

import Skeleton from "./Skeleton";

export interface StatCardProps {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  /**
   * Colours the value. Pass a tone only when the number means "look at
   * this" (non-zero low stock, say). A healthy zero stays neutral, so the
   * eye goes to the tiles that actually need attention.
   */
  tone?: "warning" | "danger" | "good";
  /** The whole tile links to where the number can be acted on. */
  href?: string;
  loading?: boolean;
  /** A sparkline or mini bar under the number. */
  children?: ReactNode;
}

const TONE: Record<NonNullable<StatCardProps["tone"]>, string> = {
  warning: "text-amber-400",
  danger: "text-red-400",
  good: "text-green-400",
};

export default function StatCard({ label, value, hint, tone, href, loading = false, children }: StatCardProps) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-neutral-400">{label}</p>
        {href ? (
          <IconChevronRight size={16} className="text-neutral-600 transition-colors group-hover:text-neutral-300" />
        ) : null}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-8 w-16" />
      ) : (
        <p className={`mt-1 font-display text-3xl font-semibold tabular-nums ${tone ? TONE[tone] : "text-neutral-100"}`}>
          {value}
        </p>
      )}
      {hint ? <p className="mt-0.5 text-xs text-neutral-500">{hint}</p> : null}
      {children ? <div className="mt-3">{children}</div> : null}
    </>
  );

  const shell = "group block rounded-xl border border-neutral-800 bg-neutral-900/60 p-4";
  return href ? (
    <Link href={href} className={`${shell} transition-colors hover:border-neutral-700 hover:bg-neutral-900`}>
      {body}
    </Link>
  ) : (
    <div className={shell}>{body}</div>
  );
}
