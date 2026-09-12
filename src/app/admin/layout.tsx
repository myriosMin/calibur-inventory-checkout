"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { getBrowserClient } from "@/lib/supabase/browser";

const NAV_LINKS = [
  { href: "/admin", label: "Dashboard" },
  { href: "/admin/products", label: "Products" },
  { href: "/admin/holders", label: "Holders" },
  { href: "/admin/members", label: "Members" },
  { href: "/admin/scan-codes", label: "Scan codes" },
  { href: "/admin/bind-queue", label: "Bind queue" },
  { href: "/admin/restock", label: "Restock" },
  { href: "/admin/movements", label: "Movements" },
  { href: "/admin/holdings", label: "Holdings" },
  { href: "/admin/stocktake", label: "Stocktake" },
  { href: "/admin/labels", label: "Labels" },
];

/**
 * Prefix match, so a detail route like /admin/movements/123 still highlights
 * "Movements" -- the previous exact-equality check highlighted nothing there.
 * "/admin" itself is special-cased to exact equality: as a prefix it matches
 * every route in the section and would light up Dashboard permanently.
 * The trailing-slash guard stops "/admin/holdings" from also matching
 * "/admin/holders" style neighbours by bare string prefix.
 */
function isActive(pathname: string, href: string): boolean {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/admin/login") {
    return <>{children}</>;
  }

  const handleSignOut = async () => {
    const supabase = getBrowserClient();
    await supabase.auth.signOut();
    router.push("/admin/login");
    router.refresh();
  };

  return (
    <div className="min-h-dvh bg-neutral-950">
      <header className="border-b border-neutral-800 bg-neutral-900">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <nav className="flex flex-wrap gap-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium ${
                  isActive(pathname, link.href)
                    ? "text-red-400"
                    : "text-neutral-300 hover:text-neutral-100"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm font-medium text-neutral-400 hover:text-neutral-100"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}
