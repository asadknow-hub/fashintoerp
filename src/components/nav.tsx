"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard" },
  { href: "/inbox", label: "Inbox" },
  { href: "/orders", label: "Orders" },
  { href: "/inventory", label: "Inventory" },
  { href: "/customers", label: "Customers" },
  { href: "/automations", label: "Auto replies" },
  { href: "/staff", label: "Staff", ownerOnly: true },
  { href: "/settings", label: "Settings" },
];

export function Nav({ owner = false }: { owner?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="flex gap-0.5 overflow-x-auto md:min-h-0 md:flex-col md:overflow-x-visible md:overflow-y-auto">
      {links
        .filter((link) => owner || !link.ownerOnly)
        .map((link) => {
          const active =
            link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? "page" : undefined}
              className={
                "rounded-md px-2.5 py-1.5 text-sm font-medium whitespace-nowrap transition " +
                (active
                  ? "bg-stone-900 text-white"
                  : "text-stone-600 hover:bg-stone-200/70 hover:text-stone-900")
              }
            >
              {link.label}
            </Link>
          );
        })}
    </nav>
  );
}
