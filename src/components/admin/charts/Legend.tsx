import type { SeriesDef } from "@/lib/reports/chart-data";

import { slotBg } from "./theme";

/** Swatch + label per series. Identity is never colour alone. */
export default function Legend({ series }: { series: readonly SeriesDef[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-400">
      {series.map((def) => (
        <li key={def.key} className="flex items-center gap-1.5">
          <span aria-hidden className={`size-2.5 rounded-sm ${slotBg(def.slot)}`} />
          {def.label}
        </li>
      ))}
    </ul>
  );
}
