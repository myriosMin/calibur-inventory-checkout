/**
 * Shared field styling for /admin forms and filter bars, so every input,
 * select and caption looks the same without a wrapper component per
 * element.
 */

/** Text inputs and selects in a form (inside a Drawer or a Card). */
export const FIELD = "min-h-10 w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 text-sm text-neutral-100 placeholder:text-neutral-600 transition-colors hover:border-neutral-700";

/** Textareas: same look, natural height. */
export const FIELD_AREA = "w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm text-neutral-100 placeholder:text-neutral-600";

/** A <label> wrapping caption + control. */
export const LABEL = "flex flex-col gap-1.5 text-sm";

/** The caption text inside a LABEL. */
export const CAPTION = "font-medium text-neutral-300";

/** Muted helper line under a field. */
export const HELP = "text-xs text-neutral-500";

/** Compact controls in a page's filter row. */
export const FILTER = "min-h-9 rounded-lg border border-neutral-800 bg-neutral-900/60 px-3 text-sm text-neutral-100 placeholder:text-neutral-600";
