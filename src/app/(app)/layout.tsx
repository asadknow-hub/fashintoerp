import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { Bell, Box, ChevronDown, LogOut, Settings, Truck, TriangleAlert, UserCog } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { logout } from "@/app/auth-actions";
import { Menu } from "@/components/menu";
import { Crumbs, Nav } from "@/components/nav";
import { SearchBox } from "@/components/search-box";
import { Shell } from "@/components/shell";
import { SubmitButton } from "@/components/submit-button";
import { db } from "@/db";
import { orders, products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getSettings } from "@/lib/settings";

export default function AppLayout({ children }: LayoutProps<"/">) {
  return (
    <Shell
      sidebar={
        <>
          <Link href="/" className="mb-5 flex items-center gap-2.5 px-2">
            <span className="flex size-8 items-center justify-center rounded-lg bg-brand text-white">
              <Box className="size-[18px]" strokeWidth={2.2} />
            </span>
            <span className="truncate text-base font-extrabold tracking-tight">
              <Suspense fallback="ERP">
                <BusinessName />
              </Suspense>
            </span>
          </Link>
          <Suspense>
            <Nav />
          </Suspense>
          {/* Shows which version of the app is live, to make support easier. */}
          <p className="mt-auto px-3 pt-3 text-[10px] text-stone-400">
            Version {process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev"}
          </p>
        </>
      }
      bar={
        <>
          <Suspense>
            <Crumbs />
          </Suspense>
          <div className="ml-auto flex min-w-0 items-center gap-1.5 max-sm:flex-1">
            <SearchBox />
            <Suspense fallback={<Bell className="m-1 size-5 text-stone-400" />}>
              <Alerts />
            </Suspense>
            <Suspense>
              <UserMenu />
            </Suspense>
          </div>
        </>
      }
    >
      {children}
    </Shell>
  );
}

async function BusinessName() {
  await requireUser();
  return (await getSettings())?.businessName ?? "ERP";
}

// The bell: things that need someone's attention right now.
async function Alerts() {
  await requireUser();
  const [[stock], [shipping]] = await Promise.all([
    db
      .select({ low: sql<number>`count(*)::int` })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(and(eq(products.archived, false), lte(variants.stock, variants.lowStockAt))),
    db
      .select({ waiting: sql<number>`count(*)::int` })
      .from(orders)
      .where(inArray(orders.status, ["new", "confirmed", "packed"])),
  ]);
  const items = [
    {
      count: shipping.waiting,
      href: "/orders?status=open",
      icon: Truck,
      text: shipping.waiting === 1 ? "order to send out" : "orders to send out",
    },
    {
      count: stock.low,
      href: "/inventory?view=low",
      icon: TriangleAlert,
      text: stock.low === 1 ? "item low or out of stock" : "items low or out of stock",
    },
  ].filter((item) => item.count > 0);

  return (
    <Menu
      label="Alerts"
      button={
        <span className="relative block">
          <Bell className="size-5 text-stone-700" strokeWidth={1.9} />
          {items.length > 0 && (
            <span
              data-alert-dot
              className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-brand ring-2 ring-white"
            />
          )}
        </span>
      }
    >
      <p className="border-b border-stone-200 px-3 py-2 text-xs font-bold">Needs attention</p>
      {items.length === 0 && (
        <p className="px-3 py-3 text-sm text-stone-500">Nothing right now.</p>
      )}
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className="flex items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-stone-50"
        >
          <item.icon className="size-4 shrink-0 text-brand" />
          <span>
            <b className="tabular-nums">{item.count}</b> {item.text}
          </span>
        </Link>
      ))}
    </Menu>
  );
}

// Who is signed in, with their links.
async function UserMenu() {
  const user = await requireUser();
  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? "")
    .join("");
  const item = "flex w-full items-center gap-2.5 px-3 py-2.5 text-sm hover:bg-stone-50";
  return (
    <Menu
      label="Your account"
      button={
        <span className="flex items-center gap-2.5 px-1">
          <span className="flex size-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand">
            {initials}
          </span>
          <span className="text-sm font-bold max-sm:hidden">{user.name}</span>
          <ChevronDown className="size-4 text-stone-500 max-sm:hidden" />
        </span>
      }
    >
      <p className="border-b border-stone-200 px-3 py-2 text-xs text-stone-500">{user.email}</p>
      <Link href="/settings" className={item}>
        <Settings className="size-4 text-stone-500" /> Settings
      </Link>
      {user.role === "owner" && (
        <Link href="/staff" className={item}>
          <UserCog className="size-4 text-stone-500" /> Staff
        </Link>
      )}
      <form action={logout} className="border-t border-stone-200">
        <SubmitButton className={item + " cursor-pointer disabled:opacity-50"} working="Signing out…">
          <LogOut className="size-4 text-stone-500" /> Sign out
        </SubmitButton>
      </form>
    </Menu>
  );
}
