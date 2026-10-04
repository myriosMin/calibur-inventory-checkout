/**
 * The /admin sidebar, and which of it a procurement account sees.
 *
 * This is NOT a security boundary -- RLS is (migrations 0024/0025). Hiding
 * a link only spares a procurement reviewer pages that would come back empty
 * or refuse every write. Anyone can still type the URL; the database still
 * says no.
 *
 * Fourteen pages fit in ten entries: related pages share one entry and
 * appear as tabs above the page (AdminShell renders them from `tabs`), so
 * every URL still works and still deep-links.
 */

export type NavIcon =
  | "dashboard"
  | "review"
  | "products"
  | "stock"
  | "restock"
  | "stocktake"
  | "builds"
  | "people"
  | "labels"
  | "holders";

/** Which count from useNavBadges() an entry shows. */
export type NavBadge = "openReview" | "openReviewExpensive" | "bindQueue";

export interface NavTab {
  href: string;
  label: string;
}

export interface NavItem {
  /** Where the entry goes: its first tab, when it has tabs. */
  href: string;
  label: string;
  icon: NavIcon;
  /** Hidden from procurement: the page manages people, labels or holders. */
  adminOnly?: boolean;
  badge?: NavBadge;
  /** Sibling pages shown as tabs under this one entry. */
  tabs?: NavTab[];
}

export interface NavGroup {
  /** null for the unlabelled top group. */
  label: string | null;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: null,
    items: [
      { href: "/admin", label: "Dashboard", icon: "dashboard" },
      // Counts only the questions about expensive items: those are settled first.
      { href: "/admin/review", label: "Review", icon: "review", badge: "openReviewExpensive" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { href: "/admin/products", label: "Products", icon: "products" },
      {
        href: "/admin/holdings",
        label: "Stock",
        icon: "stock",
        tabs: [
          { href: "/admin/holdings", label: "Who holds what" },
          { href: "/admin/movements", label: "Movements" },
        ],
      },
      { href: "/admin/restock", label: "Restock", icon: "restock" },
      {
        href: "/admin/stocktake",
        label: "Stocktake",
        icon: "stocktake",
        tabs: [
          { href: "/admin/stocktake", label: "Count" },
          { href: "/admin/stocktake/variance", label: "Variance" },
        ],
      },
      { href: "/admin/builds", label: "Builds", icon: "builds" },
    ],
  },
  {
    label: "Admin",
    items: [
      {
        href: "/admin/members",
        label: "People",
        icon: "people",
        adminOnly: true,
        badge: "bindQueue",
        tabs: [
          { href: "/admin/members", label: "Members" },
          { href: "/admin/join-codes", label: "Join codes" },
          { href: "/admin/bind-queue", label: "Bind queue" },
        ],
      },
      {
        href: "/admin/labels",
        label: "Labels",
        icon: "labels",
        adminOnly: true,
        tabs: [
          { href: "/admin/labels", label: "Print sheets" },
          { href: "/admin/scan-codes", label: "Scan codes" },
        ],
      },
      { href: "/admin/holders", label: "Holders", icon: "holders", adminOnly: true },
    ],
  },
];

/** Every entry, flattened -- for tests and lookups. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/**
 * Until `is_admin()` has answered, show the procurement subset: an admin
 * briefly missing three entries is better than a reviewer briefly seeing them.
 * A group left with no entries disappears with its heading.
 */
export function visibleNavGroups(isAdmin: boolean): NavGroup[] {
  return NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => isAdmin || !item.adminOnly),
  })).filter((group) => group.items.length > 0);
}

/**
 * Prefix match, so a detail route like /admin/products/123 still highlights
 * "Products". "/admin" itself is exact: as a prefix it would match every
 * route in the section. The trailing-slash guard stops "/admin/holdings"
 * from also matching "/admin/holders" by bare string prefix.
 */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

/** The sidebar entry for a path: its own href, or any of its tabs. */
export function navItemFor(pathname: string): NavItem | undefined {
  return NAV_ITEMS.find((item) =>
    [item.href, ...(item.tabs ?? []).map((tab) => tab.href)].some((href) => isActive(pathname, href)),
  );
}

/**
 * The tab a path belongs to. Longest match wins, so /admin/stocktake/variance
 * is "Variance" and not also "Count" (whose href is its prefix).
 */
export function activeTabHref(pathname: string, tabs: readonly NavTab[]): string | undefined {
  return tabs
    .filter((tab) => isActive(pathname, tab.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;
}
