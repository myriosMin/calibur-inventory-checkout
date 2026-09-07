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
];

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
    <div className="min-h-dvh bg-slate-50">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <nav className="flex flex-wrap gap-4">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-sm font-medium ${
                  pathname === link.href
                    ? "text-emerald-700"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-sm font-medium text-slate-500 hover:text-slate-900"
          >
            Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}
