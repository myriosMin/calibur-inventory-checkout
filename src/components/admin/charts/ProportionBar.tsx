import type { Segment } from "@/lib/reports/chart-data";

import { slotBg } from "./theme";

export interface ProportionSegment extends Segment {
  slot: number;
}

/**
 * Parts of a whole as one 100% bar with a labelled legend: what a pie would
 * show, minus the angle-judging. Shares are printed, so nothing relies on
 * colour.
 */
export default function ProportionBar({
  segments,
  emptyMessage = "No data yet.",
}: {
  segments: ProportionSegment[];
  emptyMessage?: string;
}) {
  if (segments.length === 0) {
    return <p className="text-sm text-neutral-500">{emptyMessage}</p>;
  }
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full" role="img" aria-label={segments.map((s) => `${s.label} ${Math.round(s.share * 100)}%`).join(", ")}>
        {segments.map((segment) => (
          <span
            key={segment.key}
            className={`h-full first:rounded-l-full last:rounded-r-full ${slotBg(segment.slot)}`}
            style={{ width: `${segment.share * 100}%` }}
          />
        ))}
      </div>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {segments.map((segment) => (
          <li key={segment.key} className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-neutral-400">
              <span aria-hidden className={`size-2.5 shrink-0 rounded-sm ${slotBg(segment.slot)}`} />
              <span className="truncate">{segment.label}</span>
            </span>
            <span className="tabular-nums text-neutral-200">
              {segment.value}
              <span className="ml-1 text-xs text-neutral-500">{Math.round(segment.share * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
