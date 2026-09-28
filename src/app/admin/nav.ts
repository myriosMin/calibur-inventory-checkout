/**
 * The /admin navigation, and which of it a procurement account sees.
 *
 * This is NOT a security boundary -- RLS is (migrations 0024/0025). Hiding
 * a link only spares a procurement reviewer pages that would come back empty
 * or refuse every write. Anyone can still type the URL; the database still
 * says no.
 */

export interface NavLink {
  href: string;
  label: string;
  /** Hidden from procurement: the page manages people, labels or holders. */
  adminOnly?: boolean;
}

export const NAV_LINKS: NavLink[] = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/review", label: "Review" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/holders", label: "Holders", adminOnly: true },
  { href: "/admin/members", label: "Members", adminOnly: true },
  { href: "/admin/join-codes", label: "Join codes", adminOnly: true },
  { href: "/admin/scan-codes", label: "Scan codes", adminOnly: true },
  { href: "/admin/bind-queue", label: "Bind queue", adminOnly: true },
  { href: "/admin/restock", label: "Restock" },
  { href: "/admin/movements", label: "Movements" },
  { href: "/admin/holdings", label: "Holdings" },
  { href: "/admin/stocktake", label: "Stocktake" },
  { href: "/admin/labels", label: "Labels", adminOnly: true },
];

/**
 * Until `is_admin()` has answered, show the procurement subset: an admin
 * briefly missing five links is better than a reviewer briefly seeing them.
 */
export function visibleNavLinks(isAdmin: boolean): NavLink[] {
  return isAdmin ? NAV_LINKS : NAV_LINKS.filter((link) => !link.adminOnly);
}

/**
 * Prefix match, so a detail route like /admin/movements/123 still highlights
 * "Movements". "/admin" itself is exact: as a prefix it would match every
 * route in the section. The trailing-slash guard stops "/admin/holdings"
 * from also matching "/admin/holders" by bare string prefix.
 */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}
