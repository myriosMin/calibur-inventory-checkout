"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { getBrowserClient } from "@/lib/supabase/browser";

import { isActive, visibleNavLinks } from "./nav";

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === "/admin/login";
  const [isAdmin, setIsAdmin] = useState(false);

  // Re-checked when leaving the login page: this layout stays mounted across
  // the sign-in navigation, so a mount-only check would still hold the
  // signed-out answer.
  useEffect(() => {
    if (onLogin) return;
    let cancelled = false;
    getBrowserClient()
      .rpc("is_admin")
      .then(({ data }) => {
        if (!cancelled) setIsAdmin(data === true);
      });
    return () => {
      cancelled = true;
    };
  }, [onLogin]);

  if (onLogin) {
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
            {visibleNavLinks(isAdmin).map((link) => (
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
