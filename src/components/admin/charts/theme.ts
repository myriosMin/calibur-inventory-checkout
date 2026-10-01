/**
 * Chart colours for code that can't read CSS variables (Recharts sets SVG
 * attributes). Mirrors the --color-chart-* tokens in src/app/globals.css --
 * see the note there on how they were validated. Keep the two in step.
 */
export const SERIES_COLORS = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"] as const;

export function slotColor(slot: number): string {
  return SERIES_COLORS[(slot - 1) % SERIES_COLORS.length];
}

/** Tailwind background classes for the same slots, for HTML marks. */
export const SLOT_BG = ["bg-chart-1", "bg-chart-2", "bg-chart-3", "bg-chart-4", "bg-chart-5"] as const;

export function slotBg(slot: number): string {
  return SLOT_BG[(slot - 1) % SLOT_BG.length];
}

/** Diverging pair: blue <-> red with a neutral midpoint (dataviz reference, dark steps). */
export const DIVERGING = { positive: "#3987e5", negative: "#e66767" } as const;

export const CHROME = {
  /** Card surface: the 2px gap between stacked segments is drawn in this. */
  surface: "#171717",
  grid: "#262626",
  axis: "#737373",
  ink: "#e5e5e5",
} as const;
