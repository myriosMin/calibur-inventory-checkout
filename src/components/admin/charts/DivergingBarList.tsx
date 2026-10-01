import type { ReactNode } from "react";

import { DIVERGING } from "./theme";

export interface DivergingItem {
  key: string;
  label: ReactNode;
  value: number;
  display?: ReactNode;
}

/**
 * Signed values around a zero line: more than expected to the right (blue),
 * less to the left (red), nothing at the centre. For stocktake variance,
 * where the sign is the whole story.
 */
export default function DivergingBarList({ items }: { items: DivergingItem[] }) {
  const max = Math.max(1, ...items.map((item) => Math.abs(item.value)));
  return (
    <ul className="flex flex-col gap-1.5">
      {items.map((item) => {
        const width = `${(Math.abs(item.value) / max) * 50}%`;
        return (
          <li key={item.key} className="grid grid-cols-[minmax(0,9rem)_1fr_3.5rem] items-center gap-3 text-sm">
            <span className="truncate text-neutral-300">{item.label}</span>
            <span className="relative h-5">
              <span aria-hidden className="absolute inset-y-0 left-1/2 w-px bg-neutral-700" />
              {item.value !== 0 ? (
                <span
                  aria-hidden
                  className={`absolute inset-y-0.5 ${item.value > 0 ? "left-1/2 rounded-r" : "right-1/2 rounded-l"}`}
                  style={{ width, background: item.value > 0 ? DIVERGING.positive : DIVERGING.negative }}
                />
              ) : null}
            </span>
            <span className="text-right tabular-nums text-neutral-300">{item.display ?? item.value}</span>
          </li>
        );
      })}
    </ul>
  );
}
