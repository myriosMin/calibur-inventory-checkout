"use client";

import Link from "next/link";

import { activeTabHref, type NavTab } from "@/app/admin/nav";

/**
 * The tabs under one sidebar entry (People: Members / Join codes / Bind
 * queue). Rendered by AdminShell from nav.ts, so each page stays its own
 * route and its own URL. These are links styled as tabs, not an ARIA
 * tablist, because each one navigates.
 */
export default function SectionTabs({ tabs, pathname }: { tabs: NavTab[]; pathname: string }) {
  const active = activeTabHref(pathname, tabs);
  return (
    <nav aria-label="Section" className="-mx-1 mb-5 flex gap-1 overflow-x-auto border-b border-neutral-800">
      {tabs.map((tab) => {
        const selected = tab.href === active;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={selected ? "page" : undefined}
            className={`relative shrink-0 px-3 pb-2.5 pt-1 text-sm font-medium transition-colors ${
              selected ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-200"
            }`}
          >
            {tab.label}
            {selected ? <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-red-500" /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
