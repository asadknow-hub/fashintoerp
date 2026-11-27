"use client";

import {
  ChartColumn,
  LayoutGrid,
  Package,
  Settings,
  ShoppingBag,
  ShoppingCart,
  Users,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutGrid },
  { href: "/orders", label: "Orders", icon: ShoppingCart },
  { href: "/products", label: "Products", icon: Package },
  { href: "/inventory", label: "Inventory", icon: Warehouse },
  { href: "/purchases", label: "Purchases", icon: ShoppingBag },
  { href: "/reports", label: "Reports", icon: ChartColumn },
  { href: "/customers", label: "Customers", icon: Users },
  { href: "/settings", label: "Settings", icon: Settings },
];

// Pages that belong to a menu item even though their address differs.
const alsoUnder: Record<string, string[]> = {
  "/settings": ["/staff", "/inbox", "/automations"],
};

export function Nav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto md:min-h-0 md:flex-col md:overflow-x-visible md:overflow-y-auto">
      {links.map((link) => {
        const active =
          link.href === "/"
            ? pathname === "/"
            : [link.href, ...(alsoUnder[link.href] ?? [])].some((start) =>
                pathname.startsWith(start),
              );
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? "page" : undefined}
            className={
              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition " +
              (active
                ? "bg-brand-100 text-brand"
                : "text-stone-700 hover:bg-stone-200/70 hover:text-stone-900")
            }
          >
            <link.icon className="size-[18px] shrink-0" strokeWidth={1.9} />
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
