import { and, asc, desc, eq, inArray, isNull, lte, notInArray, sql } from "drizzle-orm";
import { Package, TrendingUp, TriangleAlert, Truck } from "lucide-react";
import Link from "next/link";
import {
  Badge,
  Block,
  OrderBadge,
  PageHeader,
  stockTone,
} from "@/components/ui";
import { db } from "@/db";
import {
  customers,
  orders,
  products,
  settings,
  users,
  variants,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, orderName, variantLabel } from "@/lib/format";
import { orderAmount } from "@/lib/order-amount";
import { getPrefs } from "@/lib/settings";

export default async function DashboardPage() {
  const [user, { currency, timezone }] = await Promise.all([requireUser(), getPrefs()]);

  const [[sales], [toShip], [onHand], lowStock, recentOrders, [care]] = await Promise.all([
    db
      .select({
        total: sql<string>`coalesce(sum(${orderAmount}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(
        and(
          sql`${orders.createdAt} >= now() - interval '7 days'`,
          notInArray(orders.status, ["cancelled", "returned"]),
          isNull(orders.exchangeOfId),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(inArray(orders.status, ["new", "confirmed", "packed"])),
    db
      .select({ units: sql<number>`coalesce(sum(${variants.stock}), 0)::int` })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(eq(products.archived, false)),
    db
      .select({
        id: variants.id,
        productId: products.id,
        name: products.name,
        size: variants.size,
        color: variants.color,
        stock: variants.stock,
        lowStockAt: variants.lowStockAt,
      })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(
        and(eq(products.archived, false), lte(variants.stock, variants.lowStockAt)),
      )
      .orderBy(asc(variants.stock))
      .limit(8),
    db
      .select({
        id: orders.id,
        number: orders.number,
        ref: orders.trackingNumber,
        exchanged: sql<boolean>`exists (
          select 1 from orders x where x.exchange_of_id = ${orders.id} and x.status <> 'cancelled'
        )`,
        status: orders.status,
        payment: orders.payment,
        codAmount: orders.codAmount,
        createdAt: orders.createdAt,
        customer: customers.name,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .orderBy(desc(orders.createdAt))
      .limit(8),
    // Housekeeping an owner should not forget.
    db
      .select({
        backupDue: sql<boolean>`(select ${settings.lastBackupAt} is null or ${settings.lastBackupAt} < now() - interval '7 days' from ${settings} limit 1)`,
        hasData: sql<boolean>`exists (select 1 from ${products})`,
        hasCode: sql<boolean>`${users.recoveryHash} is not null`,
      })
      .from(users)
      .where(eq(users.id, user.id)),
  ]);
  const reminders =
    user.role !== "staff"
      ? [
          care?.backupDue && care.hasData
            ? "You haven't downloaded a safety copy of your data in the last 7 days."
            : null,
          care && !care.hasCode
            ? "You have no recovery code, so a forgotten password could lock you out."
            : null,
        ].filter((text) => text !== null)
      : [];

  const stats = [
    {
      label: "Sales, last 7 days",
      value: formatMoney(sales.total, currency),
      note: sales.count === 1 ? "1 order" : `${sales.count} orders`,
      href: "/orders",
      icon: TrendingUp,
      tone: "bg-brand-50 border-brand-100",
      iconTone: "bg-brand-100 text-brand",
    },
    {
      label: "Orders to send out",
      value: String(toShip.count),
      note: "New, confirmed or packed",
      href: "/orders?status=open",
      icon: Truck,
      tone: "bg-rose-50 border-rose-100",
      iconTone: "bg-rose-100 text-rose-600",
    },
    {
      label: "Stock on hand",
      value: `${onHand.units} units`,
      note: "Across all products",
      href: "/inventory",
      icon: Package,
      tone: "bg-emerald-50 border-emerald-100",
      iconTone: "bg-emerald-100 text-emerald-600",
    },
    {
      label: "Low stock items",
      value: lowStock.length >= 8 ? "8+" : String(lowStock.length),
      note: "At or below alert level",
      href: "/inventory?view=low",
      icon: TriangleAlert,
      tone: "bg-amber-50 border-amber-100",
      iconTone: "bg-amber-100 text-amber-600",
    },
  ];

  const row = "flex items-center gap-2 px-4 py-2 text-sm hover:bg-stone-50";

  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(" ")[0]}`} subtitle="Today at a glance." />

      {reminders.length > 0 && (
        <div
          data-reminders
          className="card mb-3 space-y-0.5 border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
        >
          {reminders.map((text) => (
            <p key={text}>{text}</p>
          ))}
          <Link href="/settings" className="inline-block font-semibold underline">
            Fix this in Settings
          </Link>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className={"flex items-center gap-3 rounded-xl border px-4 py-3 hover:shadow-sm " + stat.tone}
          >
            <span className={"flex size-10 shrink-0 items-center justify-center rounded-lg " + stat.iconTone}>
              <stat.icon className="size-5" strokeWidth={1.9} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-stone-600">{stat.label}</span>
              <span className="block text-base leading-tight font-extrabold tabular-nums">
                {stat.value}
              </span>
              <span className="block truncate text-[11px] text-stone-500">{stat.note}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-2">
        <Block
          title="Recent orders"
          icon={<TrendingUp />}
          flush
          aside={
            <Link href="/orders/new" className="text-xs font-semibold underline">
              Create Order
            </Link>
          }
        >
          <div className="divide-y divide-stone-100">
            {recentOrders.length === 0 && (
              <p className="px-3 py-2 text-sm text-stone-500">No orders yet.</p>
            )}
            {recentOrders.map((order) => (
              <Link key={order.id} href={`/orders/${order.id}`} className={row}>
                <span className="font-semibold tabular-nums">
                  {orderName(order.ref, order.number)}
                </span>
                <span className="min-w-0 flex-1 truncate text-stone-600">
                  {order.customer} · {formatDate(order.createdAt, timezone)}
                </span>
                <OrderBadge status={order.status} exchanged={order.exchanged} />
                <span className="text-right tabular-nums">
                  {order.payment === "cod" ? formatMoney(order.codAmount, currency) : "Paid"}
                </span>
              </Link>
            ))}
          </div>
        </Block>

        <Block title="Running low" icon={<TriangleAlert />} flush>
          <div className="divide-y divide-stone-100">
            {lowStock.length === 0 && (
              <p className="px-3 py-2 text-sm text-stone-500">Nothing is running low.</p>
            )}
            {lowStock.map((item) => (
              <Link key={item.id} href={`/inventory/${item.productId}`} className={row}>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-stone-500"> · {variantLabel(item)}</span>
                </span>
                <Badge tone={stockTone(item.stock, item.lowStockAt)}>{item.stock} left</Badge>
              </Link>
            ))}
          </div>
        </Block>
      </div>
    </>
  );
}
