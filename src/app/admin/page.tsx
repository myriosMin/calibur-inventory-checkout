import Link from "next/link";

const SECTIONS = [
  { href: "/admin/products", label: "Products", description: "Catalog CRUD" },
  { href: "/admin/holders", label: "Holders", description: "Robots and pseudo-holders" },
  { href: "/admin/scan-codes", label: "Scan codes", description: "QR labels: create, retire, reprint" },
  { href: "/admin/bind-queue", label: "Bind queue", description: "Resolve unrecognised Telegram users" },
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
