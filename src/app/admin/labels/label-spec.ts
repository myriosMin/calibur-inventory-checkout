import { buildLabelUrl } from "@/lib/codes/label-url";
import type { Tables } from "@/lib/types/database";

export type ScanCode = Tables<"scan_codes">;
export type LabelProduct = Pick<
  Tables<"products">,
  "id" | "name" | "location_id" | "tier" | "active" | "part_number"
>;
export type LabelLocation = Pick<Tables<"locations">, "id" | "name" | "parent_id">;

/**
 * Everything one printed sticker needs. Deliberately flat strings: the
 * renderer should not be resolving foreign keys while laying out 500 cells,
 * and this shape is what makes the label content unit-testable without a
 * DOM or a database.
 */
export interface LabelSpec {
  code: string;
  kind: "product" | "group";
  /** Product name, or the location name for a group label. */
  title: string;
  /** The `location · CODE` line. Never clipped -- see qr-labels.md. */
  meta: string;
  /** Extra line for group labels; null for product labels. */
  hint: string | null;
  url: string;
  /** Location this label belongs to, for filtering and print ordering. */
  locationId: string | null;
}

export const GROUP_LABEL_HINT = "Scan, then pick the value";

/**
 * "Small box / SMD" -- the full ancestry, for pickers and grouping where
 * there is room for it. Label cells use the leaf name only.
 */
export function locationPath(
  locationId: string | null | undefined,
  byId: Map<string, LabelLocation>,
): string {
  if (!locationId) return "";
  const parts: string[] = [];
  const seen = new Set<string>();
  let current = byId.get(locationId);
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parent_id ? byId.get(current.parent_id) : undefined;
  }
  return parts.join(" / ");
}

export interface LabelSpecContext {
  productsById: Map<string, LabelProduct>;
  locationsById: Map<string, LabelLocation>;
  botUsername: string;
  appName: string;
}

/**
 * Turns one `scan_codes` row into a printable label.
 *
 * The human-readable half is not optional and not conditional: when the
 * target row is missing (a product deleted out from under a live code, say)
 * the label still prints with a legible placeholder and the code, because a
 * sticker that says "Unknown product · A3F9K2" is recoverable from the
 * admin dashboard and a bare QR on a scuffed bin is not.
 */
export function buildLabelSpec(
  row: ScanCode,
  ctx: LabelSpecContext,
): LabelSpec {
  const url = buildLabelUrl({
    botUsername: ctx.botUsername,
    appName: ctx.appName,
    code: row.code,
  });

  if (row.kind === "group") {
    const location = row.location_id
      ? ctx.locationsById.get(row.location_id)
      : undefined;
    const title = row.label?.trim() || location?.name || "Unknown location";
    return {
      code: row.code,
      kind: "group",
      title,
      meta: location ? `${location.name} · ${row.code}` : row.code,
      hint: GROUP_LABEL_HINT,
      url,
      locationId: row.location_id ?? null,
    };
  }

  const product = row.product_id ? ctx.productsById.get(row.product_id) : undefined;
  const location = product?.location_id
    ? ctx.locationsById.get(product.location_id)
    : undefined;
  const title = product?.name ?? "Unknown product";
  const meta = location ? `${location.name} · ${row.code}` : row.code;

  return {
    code: row.code,
    kind: "product",
    title: row.label?.trim() ? `${title} (${row.label.trim()})` : title,
    meta,
    hint: null,
    url,
    locationId: product?.location_id ?? null,
  };
}

/** Sentinel for the "products with no location set" filter option. */
export const NO_LOCATION = "__none__";
/** Sentinel for "don't filter by location". */
export const ALL_LOCATIONS = "__all__";

export function matchesLocation(
  labelLocationId: string | null,
  filter: string,
): boolean {
  if (filter === ALL_LOCATIONS) return true;
  if (filter === NO_LOCATION) return labelLocationId === null;
  return labelLocationId === filter;
}

/**
 * Print order. docs/tele-qr/qr-labels.md: stick the labels in location
 * order so the batch matches the shelf you are standing in front of --
 * which means the *sheet* has to come off the printer in that order,
 * because nobody is going to re-sort 500 stickers by hand.
 */
export function sortForPrinting(
  specs: LabelSpec[],
  locationsById: Map<string, LabelLocation>,
): LabelSpec[] {
  return [...specs].sort((a, b) => {
    const pathA = locationPath(a.locationId, locationsById);
    const pathB = locationPath(b.locationId, locationsById);
    if (pathA !== pathB) return pathA.localeCompare(pathB);
    if (a.title !== b.title) return a.title.localeCompare(b.title);
    return a.code.localeCompare(b.code);
  });
}
