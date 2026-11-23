import { and, asc, desc, eq, inArray, lte, notInArray, sql } from "drizzle-orm";
import Link from "next/link";
import { Badge, orderStatusTone, stockTone } from "@/components/ui";
import { db } from "@/db";
import { conversations, customers, orders, products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, variantLabel } from "@/lib/format";
import { getPrefs } from "@/lib/settings";

export default async function DashboardPage() {
  const user = await requireUser();
  const { currency, timezone } = await getPrefs();

  const [[sales], [toShip], [chats], lowStock, recentOrders] = await Promise.all([
    db
      .select({
        total: sql<string>`coalesce(sum(${orders.total}), 0)`,
        count: sql<number>`count(*)::int`,
      })
      .from(orders)
      .where(
        and(
          sql`${orders.createdAt} >= now() - interval '7 days'`,
          notInArray(orders.status, ["cancelled", "returned"]),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(orders)
      .where(inArray(orders.status, ["new", "confirmed", "packed"])),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(conversations)
      .where(sql`${conversations.unread} > 0`),
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
        status: orders.status,
        total: orders.total,
        createdAt: orders.createdAt,
        customer: customers.name,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .orderBy(desc(orders.createdAt))
      .limit(6),
  ]);

  const stats = [
    {
      label: "Sales, last 7 days",
      value: formatMoney(sales.total, currency),
      note: sales.count === 1 ? "1 order" : `${sales.count} orders`,
      href: "/orders",
    },
    {
      label: "Orders to send out",
      value: toShip.count,
      note: "New, confirmed or packed",
      href: "/orders?status=open",
    },
    {
      label: "Chats waiting for a reply",
      value: chats.count,
      note: "Unread conversations",
      href: "/inbox",
    },
    {
      label: "Low stock items",
      value: lowStock.length >= 8 ? "8+" : lowStock.length,
      note: "At or below alert level",
      href: "/inventory?view=low",
    },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-xl font-semibold tracking-tight">
        Hello, {user.name.split(" ")[0]}
      </h1>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((stat) => (
          <Link key={stat.label} href={stat.href} className="card p-4 hover:border-stone-400">
            <p className="text-xs font-medium text-stone-500">{stat.label}</p>
            <p className="mt-2 text-2xl font-semibold tabular-nums">{stat.value}</p>
            <p className="mt-1 text-xs text-stone-500">{stat.note}</p>
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="min-w-0">
          <h2 className="mb-3 text-sm font-semibold">Recent orders</h2>
          <div className="card divide-y divide-stone-100">
            {recentOrders.length === 0 && (
              <p className="p-4 text-sm text-stone-500">
                No orders yet.{" "}
                <Link href="/orders/new" className="font-medium text-stone-900 underline">
                  Create one
                </Link>
              </p>
            )}
            {recentOrders.map((order) => (
              <Link
                key={order.id}
                href={`/orders/${order.id}`}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-stone-50"
              >
                <span className="font-medium tabular-nums">#{order.number}</span>
                <span className="min-w-0 flex-1 truncate text-stone-600">
                  {order.customer} · {formatDate(order.createdAt, timezone)}
                </span>
                <Badge tone={orderStatusTone[order.status]}>{order.status}</Badge>
                <span className="w-20 text-right tabular-nums">
                  {formatMoney(order.total, currency)}
                </span>
              </Link>
            ))}
          </div>
        </section>

        <section className="min-w-0">
          <h2 className="mb-3 text-sm font-semibold">Running low</h2>
          <div className="card divide-y divide-stone-100">
            {lowStock.length === 0 && (
              <p className="p-4 text-sm text-stone-500">
                Nothing is running low.
              </p>
            )}
            {lowStock.map((item) => (
              <Link
                key={item.id}
                href={`/inventory/${item.productId}`}
                className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-stone-50"
              >
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium">{item.name}</span>
                  <span className="text-stone-500"> · {variantLabel(item)}</span>
                </span>
                <Badge tone={stockTone(item.stock, item.lowStockAt)}>
                  {item.stock} left
                </Badge>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
