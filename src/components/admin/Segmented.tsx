"use client";

export interface SegmentOption<V extends string> {
  value: V;
  label: string;
  /** Shown after the label; a filter with its count saves a click to find out. */
  count?: number;
  /** Colours the count only when it's non-zero. */
  tone?: "warning" | "danger";
}

/**
 * A row of filter chips, one selected. Used where a page's main filter has a
 * handful of values (holder kind, severity, member status). Showing the
 * counts inline turns the filter into a summary of the data at the same time.
 */
export default function Segmented<V extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
}: {
  options: SegmentOption<V>[];
  value: V;
  onChange: (value: V) => void;
  ariaLabel: string;
  className?: string;
}) {
  return (
    <div role="group" aria-label={ariaLabel} className={`flex flex-wrap gap-1.5 ${className}`}>
      {options.map((option) => {
        const selected = option.value === value;
        const toneClass =
          option.count && option.tone === "danger"
            ? "text-red-400"
            : option.count && option.tone === "warning"
              ? "text-amber-400"
              : selected
                ? "text-neutral-300"
                : "text-neutral-500";
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(option.value)}
            className={`inline-flex min-h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-sm transition-colors ${
              selected
                ? "border-neutral-600 bg-neutral-800 text-neutral-100"
                : "border-neutral-800 text-neutral-400 hover:border-neutral-700 hover:text-neutral-200"
            }`}
          >
            {option.label}
            {option.count !== undefined ? (
              <span className={`tabular-nums text-xs ${toneClass}`}>{option.count}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
