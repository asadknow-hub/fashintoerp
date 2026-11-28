import { and, eq, inArray, lte, sql } from "drizzle-orm";
import { Bell, Box, ChevronDown, Settings, Truck, TriangleAlert, UserCog } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { SignOut } from "@/components/sign-out";
import { Menu } from "@/components/menu";
import { Online } from "@/components/online";
import { Crumbs, Nav } from "@/components/nav";
import { SearchBox } from "@/components/search-box";
import { Shell } from "@/components/shell";
import { roleLabel } from "@/components/ui";
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
            <RoleNav />
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
            <Suspense>
              <WhoIsOnline />
            </Suspense>
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

// The menu, with the Staff entry for an Owner or the System Admin.
async function RoleNav() {
  const user = await requireUser();
  return <Nav manager={user.role !== "staff"} />;
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

// Every screen says "still here" now and then; Owners and the System Admin
// are also shown who is online.
async function WhoIsOnline() {
  const user = await requireUser();
  return <Online show={user.role !== "staff"} />;
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
          <span className="text-left leading-tight max-sm:hidden">
            <span className="block text-sm font-bold">{user.name}</span>
            <span data-role className="block text-[11px] text-stone-500">
              {roleLabel[user.role]}
            </span>
          </span>
          <ChevronDown className="size-4 text-stone-500 max-sm:hidden" />
        </span>
      }
    >
      <p className="border-b border-stone-200 px-3 py-2 text-xs text-stone-500">
        {user.email}
        <span className="block font-semibold text-stone-700">{roleLabel[user.role]}</span>
      </p>
      <Link href="/settings" className={item}>
        <Settings className="size-4 text-stone-500" /> Settings
      </Link>
      {user.role !== "staff" && (
        <Link href="/staff" className={item}>
          <UserCog className="size-4 text-stone-500" /> Staff
        </Link>
      )}
      <div className="border-t border-stone-200">
        <SignOut className={item + " w-full cursor-pointer disabled:opacity-50"} />
      </div>
    </Menu>
  );
}
