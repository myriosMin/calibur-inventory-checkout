"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, useSyncExternalStore, type ComponentType, type ReactNode } from "react";
import useSWR from "swr";

import SectionTabs from "@/components/admin/SectionTabs";
import {
  IconBox,
  IconClipboard,
  IconDashboard,
  IconInbox,
  IconLayers,
  IconList,
  IconLogOut,
  IconMenu,
  IconQr,
  IconRobot,
  IconSidebar,
  IconTruck,
  IconUsers,
  IconX,
  type IconProps,
} from "@/components/ui/icons";
import { clearAdminCache, useIsAdmin, useNavBadges, type NavBadges } from "@/lib/admin/queries";
import { getBrowserClient } from "@/lib/supabase/browser";

import { isActive, navItemFor, visibleNavGroups, type NavGroup, type NavIcon, type NavItem } from "./nav";

const ICONS: Record<NavIcon, ComponentType<IconProps>> = {
  dashboard: IconDashboard,
  review: IconInbox,
  products: IconBox,
  stock: IconLayers,
  restock: IconTruck,
  stocktake: IconClipboard,
  builds: IconList,
  people: IconUsers,
  labels: IconQr,
  holders: IconRobot,
};

const COLLAPSED_KEY = "admin:sidebar-collapsed";

// The sidebar's collapsed flag, remembered per browser. An external store
// rather than state + effect so the first client render already has it.
// Falls back to memory when storage is blocked: still toggles, just isn't
// remembered.
const collapsedListeners = new Set<() => void>();
let collapsedMemory = false;

function readCollapsed(): boolean {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === "1";
  } catch {
    return collapsedMemory;
  }
}

function writeCollapsed(value: boolean) {
  collapsedMemory = value;
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? "1" : "0");
  } catch {
    // Memory only.
  }
  collapsedListeners.forEach((listener) => listener());
}

function subscribeCollapsed(listener: () => void) {
  collapsedListeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    collapsedListeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

function itemIsActive(pathname: string, item: NavItem): boolean {
  return navItemFor(pathname)?.href === item.href || isActive(pathname, item.href);
}

/**
 * The /admin frame: a left sidebar (icon rail when collapsed, off-canvas
 * drawer on a phone), and the section tabs for entries that group several
 * pages. Replaces the 13-link top bar that wrapped onto two lines.
 */
export default function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { data: isAdmin = false } = useIsAdmin();
  const { data: badges } = useNavBadges();
  const { data: email } = useSWR("admin/user-email", async () => {
    const { data } = await getBrowserClient().auth.getUser();
    return data.user?.email ?? null;
  }, { revalidateOnFocus: false });

  const collapsed = useSyncExternalStore(subscribeCollapsed, readCollapsed, () => false);
  // The drawer remembers which page it was opened on, so navigating from it
  // closes it without an effect.
  const [drawerPath, setDrawerPath] = useState<string | null>(null);
  const mobileOpen = drawerPath === pathname;
  const setMobileOpen = (open: boolean) => setDrawerPath(open ? pathname : null);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerPath(null);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const toggleCollapsed = () => writeCollapsed(!collapsed);

  const handleSignOut = async () => {
    await getBrowserClient().auth.signOut();
    await clearAdminCache();
    router.push("/admin/login");
    router.refresh();
  };

  const groups = visibleNavGroups(isAdmin);
  const current = navItemFor(pathname);
  const tabs = current?.tabs && (isAdmin || !current.adminOnly) ? current.tabs : null;

  return (
    <div className="flex min-h-dvh bg-neutral-950">
      <a
        href="#admin-main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-lg focus:bg-neutral-100 focus:px-3 focus:py-2 focus:text-sm focus:text-neutral-950"
      >
        Skip to content
      </a>

      {/* Desktop / tablet sidebar */}
      <aside
        className={`sticky top-0 hidden h-dvh shrink-0 flex-col border-r border-neutral-800/80 bg-neutral-950 transition-[width] duration-200 md:flex ${
          collapsed ? "w-[4.25rem]" : "w-60"
        }`}
      >
        <SidebarBody
          groups={groups}
          pathname={pathname}
          badges={badges}
          collapsed={collapsed}
          email={email ?? null}
          onSignOut={handleSignOut}
          onToggleCollapsed={toggleCollapsed}
        />
      </aside>

      {/* Phone: drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-50 md:hidden">
          <button
            type="button"
            aria-label="Close menu"
            className="animate-fade-in absolute inset-0 bg-black/60"
            onClick={() => setMobileOpen(false)}
          />
          <aside className="relative flex h-full w-72 max-w-[85vw] flex-col border-r border-neutral-800 bg-neutral-950 shadow-2xl">
            <button
              type="button"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
              className="absolute right-3 top-3.5 inline-flex size-9 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800 hover:text-neutral-100"
            >
              <IconX size={18} />
            </button>
            <SidebarBody
              groups={groups}
              pathname={pathname}
              badges={badges}
              collapsed={false}
              email={email ?? null}
              onSignOut={handleSignOut}
            />
          </aside>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Phone: top bar */}
        <header className="sticky top-0 z-40 flex h-14 items-center gap-3 border-b border-neutral-800/80 bg-neutral-950/90 px-4 backdrop-blur md:hidden">
          <button
            type="button"
            aria-label="Open menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen(true)}
            className="-ml-2 inline-flex size-10 items-center justify-center rounded-lg text-neutral-300 hover:bg-neutral-800"
          >
            <IconMenu size={20} />
          </button>
          <span aria-hidden className="grid size-7 place-items-center rounded-md bg-red-600 font-display text-sm font-bold text-white">
            C
          </span>
          <span className="font-display text-base font-semibold text-neutral-100">Calibur Store</span>
          {current ? <span className="truncate text-sm text-neutral-500">/ {current.label}</span> : null}
        </header>

        <main id="admin-main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 md:px-8 md:py-8">
          {tabs ? <SectionTabs tabs={tabs} pathname={pathname} /> : null}
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarBody({
  groups,
  pathname,
  badges,
  collapsed,
  email,
  onSignOut,
  onToggleCollapsed,
}: {
  groups: NavGroup[];
  pathname: string;
  badges: NavBadges | undefined;
  collapsed: boolean;
  email: string | null;
  onSignOut: () => void;
  onToggleCollapsed?: () => void;
}) {
  return (
    <>
      <div className={`flex h-16 shrink-0 items-center gap-2.5 ${collapsed ? "justify-center px-2" : "px-5"}`}>
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-red-600 font-display text-base font-bold text-white">
          C
        </span>
        {!collapsed ? (
          <span className="min-w-0 leading-tight">
            <span className="block font-display text-base font-semibold text-neutral-100">Calibur Store</span>
            <span className="block text-xs text-neutral-500">Admin</span>
          </span>
        ) : null}
      </div>

      <nav aria-label="Admin" className="flex-1 overflow-y-auto px-3 pb-4">
        {groups.map((group) => (
          <div key={group.label ?? "top"} className="mt-4 first:mt-1">
            {group.label ? (
              collapsed ? (
                <div aria-hidden className="mx-3 mb-2 border-t border-neutral-800" />
              ) : (
                <p className="mb-1 px-3 text-[0.6875rem] font-medium uppercase tracking-wider text-neutral-500">
                  {group.label}
                </p>
              )
            ) : null}
            <ul className="flex flex-col gap-0.5">
              {group.items.map((item) => {
                const Icon = ICONS[item.icon];
                const active = itemIsActive(pathname, item);
                const count = item.badge ? (badges?.[item.badge] ?? 0) : 0;
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      title={collapsed ? item.label : undefined}
                      className={`relative flex h-9 items-center gap-3 rounded-lg text-sm font-medium transition-colors ${
                        collapsed ? "justify-center" : "px-3"
                      } ${
                        active
                          ? "bg-neutral-800/70 text-neutral-50"
                          : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-100"
                      }`}
                    >
                      {active ? (
                        <span aria-hidden className="absolute -left-3 top-1.5 h-6 w-0.5 rounded-r-full bg-red-500" />
                      ) : null}
                      <Icon size={18} className={active ? "text-neutral-100" : "text-neutral-500"} />
                      {collapsed ? (
                        <span className="sr-only">{item.label}</span>
                      ) : (
                        <span className="flex-1 truncate">{item.label}</span>
                      )}
                      {count > 0 ? (
                        collapsed ? (
                          <span aria-label={`${count} waiting`} className="absolute right-2 top-1.5 size-2 rounded-full bg-amber-400" />
                        ) : (
                          <span className="rounded-full bg-amber-500/15 px-1.5 text-xs tabular-nums text-amber-300">
                            {count}
                          </span>
                        )
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className={`flex shrink-0 flex-col gap-1 border-t border-neutral-800/80 p-3 ${collapsed ? "items-center" : ""}`}>
        {!collapsed && email ? <p className="truncate px-3 pb-1 text-xs text-neutral-500" title={email}>{email}</p> : null}
        <button
          type="button"
          onClick={onSignOut}
          title={collapsed ? "Sign out" : undefined}
          className={`flex h-9 cursor-pointer items-center gap-3 rounded-lg text-sm text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-neutral-100 ${
            collapsed ? "w-9 justify-center" : "px-3"
          }`}
        >
          <IconLogOut size={18} className="text-neutral-500" />
          {collapsed ? <span className="sr-only">Sign out</span> : "Sign out"}
        </button>
        {onToggleCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : undefined}
            className={`flex h-9 cursor-pointer items-center gap-3 rounded-lg text-sm text-neutral-500 transition-colors hover:bg-neutral-900 hover:text-neutral-100 ${
              collapsed ? "w-9 justify-center" : "px-3"
            }`}
          >
            <IconSidebar size={18} />
            {collapsed ? null : "Collapse"}
          </button>
        ) : null}
      </div>
    </>
  );
}
