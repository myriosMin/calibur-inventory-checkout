import Link from "next/link";

// Keep in sync with NAV_LINKS in ./layout.tsx -- these two drifted once
// already (Members was in the nav but missing here).
const SECTIONS = [
  { href: "/admin/products", label: "Products", description: "Catalog CRUD" },
  { href: "/admin/holders", label: "Holders", description: "Robots and pseudo-holders" },
  { href: "/admin/members", label: "Members", description: "Roster, roles, Telegram bindings" },
  { href: "/admin/scan-codes", label: "Scan codes", description: "QR labels: create, retire, reprint" },
  { href: "/admin/bind-queue", label: "Bind queue", description: "Resolve unrecognised Telegram users" },
  { href: "/admin/restock", label: "Restock", description: "Log newly received stock into the store" },
  { href: "/admin/movements", label: "Movements", description: "The ledger: browse and reverse" },
  { href: "/admin/holdings", label: "Holdings", description: "Who holds what, right now" },
  { href: "/admin/stocktake", label: "Stocktake", description: "Count a shelf and commit the variance" },
  { href: "/admin/labels", label: "Labels", description: "Print QR label sheets" },
];

export default function AdminHomePage() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-neutral-100">Admin</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="block rounded-lg border border-neutral-800 bg-neutral-900 p-4 transition-colors hover:border-red-500/50 hover:bg-red-500/5"
            >
              <span className="block font-medium text-neutral-100">{section.label}</span>
              <span className="block text-sm text-neutral-400">{section.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
