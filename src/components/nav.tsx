"use client";

import {
  ChartColumn,
  ChevronDown,
  History,
  LayoutGrid,
  type LucideIcon,
  Package,
  Settings,
  ShoppingCart,
  UserCog,
  Users,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";

// `manager` marks what only Owners and the System Admin get: the money of
// the business, adding products, staff accounts and the activity log.
type Entry = {
  label: string;
  href: string;
  icon: LucideIcon;
  manager?: boolean;
  items?: { label: string; href: string; manager?: boolean }[];
};

const menu: Entry[] = [
  { label: "Dashboard", href: "/", icon: LayoutGrid },
  {
    label: "Orders",
    href: "/orders",
    icon: ShoppingCart,
    items: [
      { label: "Create Order", href: "/orders/new" },
      { label: "All Orders", href: "/orders" },
      { label: "Order Board", href: "/orders?view=board" },
      { label: "Order Returns", href: "/orders?status=returned" },
    ],
  },
  {
    label: "Products",
    href: "/products",
    icon: Package,
    items: [
      { label: "All Products", href: "/products" },
      { label: "Add Product", href: "/inventory/new", manager: true },
      { label: "Low Stock", href: "/inventory?view=low" },
    ],
  },
  {
    label: "Accounts",
    href: "/accounts",
    icon: Wallet,
    manager: true,
    items: [
      { label: "Transactions", href: "/accounts" },
      { label: "P&L", href: "/accounts/pnl" },
    ],
  },
  { label: "Customers", href: "/customers", icon: Users },
  { label: "Reports", href: "/reports", icon: ChartColumn, manager: true },
  { label: "Staff", href: "/staff", icon: UserCog, manager: true },
  { label: "Activity Log", href: "/activity", icon: History, manager: true },
  { label: "Settings", href: "/settings", icon: Settings },
];

// Where a page sits in the menu: its section, the menu line that is lit up,
// and (for pages that are not in the menu) what to call it in the top bar.
type Place = { section: string; item?: string; page?: string };

function place(pathname: string, params: URLSearchParams): Place {
  if (pathname === "/") return { section: "Dashboard" };
  if (pathname === "/orders/new") return { section: "Orders", item: "Create Order" };
  if (pathname === "/orders") {
    return {
      section: "Orders",
      item:
        params.get("view") === "board"
          ? "Order Board"
          : params.get("status") === "returned"
            ? "Order Returns"
            : "All Orders",
    };
  }
  if (pathname.startsWith("/orders/")) {
    return { section: "Orders", item: "All Orders", page: "Order Details" };
  }
  if (pathname === "/products") return { section: "Products", item: "All Products" };
  if (pathname === "/inventory/new") return { section: "Products", item: "Add Product" };
  if (pathname.startsWith("/inventory/")) {
    return { section: "Products", item: "All Products", page: "Product Details" };
  }
  // The same products as a table with their stock.
  if (pathname === "/inventory") {
    return params.get("view") === "low"
      ? { section: "Products", item: "Low Stock" }
      : { section: "Products", item: "All Products", page: "Stock List" };
  }
  if (pathname === "/accounts/pnl") return { section: "Accounts", item: "P&L" };
  if (pathname.startsWith("/accounts") || pathname === "/purchases") {
    return { section: "Accounts", item: "Transactions" };
  }
  if (pathname.startsWith("/customers")) return { section: "Customers" };
  if (pathname.startsWith("/reports")) return { section: "Reports" };
  if (pathname.startsWith("/activity")) return { section: "Activity Log" };
  if (pathname === "/staff") return { section: "Staff" };
  if (pathname === "/staff/new") return { section: "Staff", page: "Add Staff" };
  if (pathname.startsWith("/staff/")) return { section: "Staff", page: "Staff Member" };
  if (pathname.startsWith("/settings")) return { section: "Settings" };
  if (pathname.startsWith("/search")) return { section: "Search" };
  return { section: "" };
}

function usePlace() {
  return place(usePathname(), useSearchParams());
}

const row =
  "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-semibold whitespace-nowrap transition ";
const idle = "text-stone-700 hover:bg-stone-200/70 hover:text-stone-900";
const lit = "bg-brand-100 text-brand";

// `manager` is whether an Owner or the System Admin is signed in: they get
// the entries marked for them.
export function Nav({ manager }: { manager: boolean }) {
  const here = usePlace();
  // The section you are in is the one that is open. Arrows clicked by hand
  // win until you move to another section.
  const [byHand, setByHand] = useState<{ at: string; open: Record<string, boolean> }>({
    at: here.section,
    open: {},
  });
  const chosen = byHand.at === here.section ? byHand.open : {};
  const setOpen = (label: string, open: boolean) =>
    setByHand({ at: here.section, open: { ...chosen, [label]: open } });

  return (
    <nav className="flex min-h-0 flex-col gap-0.5 overflow-y-auto">
      {menu
        .filter((entry) => manager || !entry.manager)
        .map((entry) => {
        const inside = here.section === entry.label;
        if (!entry.items) {
          return (
            <Link
              key={entry.label}
              href={entry.href}
              aria-current={inside && !here.page ? "page" : undefined}
              className={row + (inside ? lit : idle)}
            >
              <entry.icon className="size-[18px] shrink-0" strokeWidth={1.9} />
              {entry.label}
            </Link>
          );
        }
        const open = chosen[entry.label] ?? inside;
        return (
          <div key={entry.label} data-nav-group={entry.label}>
            <div className={"flex items-center rounded-lg " + (inside ? "text-brand" : idle)}>
              <Link
                href={entry.href}
                className="flex min-w-0 flex-1 items-center gap-2.5 py-2 pl-3 text-sm font-semibold"
              >
                <entry.icon className="size-[18px] shrink-0" strokeWidth={1.9} />
                {entry.label}
              </Link>
              <button
                type="button"
                aria-label={(open ? "Close " : "Open ") + entry.label}
                aria-expanded={open}
                onClick={() => setOpen(entry.label, !open)}
                className="cursor-pointer rounded-lg p-2"
              >
                <ChevronDown
                  className={"size-4 transition-transform " + (open ? "rotate-180" : "")}
                />
              </button>
            </div>
            {open && (
              <div className="mt-0.5 mb-1 ml-[21px] flex flex-col gap-0.5 border-l border-stone-300 pl-2.5">
                {entry.items
                  .filter((item) => manager || !item.manager)
                  .map((item) => {
                  const active = inside && here.item === item.label;
                  return (
                    <Link
                      key={item.label}
                      href={item.href}
                      aria-current={active && !here.page ? "page" : undefined}
                      className={
                        "rounded-lg px-3 py-1.5 text-[13px] whitespace-nowrap transition " +
                        (active ? lit + " font-bold" : idle + " font-medium")
                      }
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

// "Orders / Create Order" in the top bar.
export function Crumbs() {
  const here = usePlace();
  const entry = menu.find((e) => e.label === here.section);
  const last = here.page ?? here.item;
  if (!here.section) return null;
  return (
    <p data-crumbs className="flex min-w-0 items-center gap-2 text-sm whitespace-nowrap">
      {last ? (
        <>
          <Link
            href={entry?.href ?? "/"}
            className="font-medium text-stone-500 hover:text-brand max-sm:hidden"
          >
            {here.section}
          </Link>
          <span className="text-stone-400 max-sm:hidden">/</span>
          <span className="truncate font-bold text-stone-900">{last}</span>
        </>
      ) : (
        <span className="truncate font-bold text-stone-900">{here.section}</span>
      )}
    </p>
  );
}
