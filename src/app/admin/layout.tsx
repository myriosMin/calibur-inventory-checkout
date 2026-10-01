"use client";

import { usePathname } from "next/navigation";

import AdminSWRProvider from "@/lib/admin/swr";

import AdminShell from "./AdminShell";

/**
 * /admin frame. The SWR provider sits here because this layout stays
 * mounted across client navigation, so cached reads survive page switches.
 * The login page gets neither: it has no session to read with.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  if (pathname === "/admin/login") {
    return <>{children}</>;
  }
  return (
    <AdminSWRProvider>
      <AdminShell>{children}</AdminShell>
    </AdminSWRProvider>
  );
}
