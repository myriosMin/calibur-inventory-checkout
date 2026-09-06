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
      <h1 className="mb-4 text-xl font-semibold text-gray-900">Admin</h1>
      <ul className="grid gap-3 sm:grid-cols-2">
        {SECTIONS.map((section) => (
          <li key={section.href}>
            <Link
              href={section.href}
              className="block rounded-lg border border-gray-200 bg-white p-4 hover:border-blue-300 hover:bg-blue-50"
            >
              <span className="block font-medium text-gray-900">{section.label}</span>
              <span className="block text-sm text-gray-500">{section.description}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
