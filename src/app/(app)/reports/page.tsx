import { and, desc, eq, lte, notInArray, sql } from "drizzle-orm";
import { Coins, Package, ShoppingCart, TrendingUp } from "lucide-react";
import Link from "next/link";
import { Block, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { orderItems, orders, products, stockPurchases, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { getPrefs } from "@/lib/settings";

const periods = [
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "all", label: "All time", days: null },
];

// The business in numbers: what sold, what it brought in, and what the stock
// on the shelf is worth.
export default async function ReportsPage({ searchParams }: PageProps<"/reports">) {
  const [, params, { currency }] = await Promise.all([requireUser(), searchParams, getPrefs()]);
  const period = periods.find((p) => p.key === params.period) ?? periods[1];
  // Orders that count as sales: not cancelled, not returned, inside the period.
  const counted = and(
    notInArray(orders.status, ["cancelled", "returned"]),
    period.days === null
      ? undefined
      : sql`${orders.createdAt} >= now() - make_interval(days => ${period.days})`,
  );

  const [[sales], [pieces], [stock], [paid], [low], best] = await Promise.all([
    db
      .select({
        orders: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orders.total}), 0)`,
      })
      .from(orders)
      .where(counted),
    db
      .select({ units: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int` })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(counted),
    db
      .select({
        units: sql<number>`coalesce(sum(${variants.stock}), 0)::int`,
        cost: sql<string>`coalesce(sum(${variants.stock} * ${variants.cost}), 0)`,
        selling: sql<string>`coalesce(sum(${variants.stock} * ${variants.price}), 0)`,
      })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(eq(products.archived, false)),
    db
      .select({
        total: sql<string>`coalesce(sum(${stockPurchases.totalCost}), 0)`,
        units: sql<number>`coalesce(sum(${stockPurchases.units}), 0)::int`,
      })
      .from(stockPurchases),
    db
      .select({ items: sql<number>`count(*)::int` })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(and(eq(products.archived, false), lte(variants.stock, variants.lowStockAt))),
    db
      .select({
        id: products.id,
        name: products.name,
        units: sql<number>`sum(${orderItems.quantity})::int`,
        revenue: sql<string>`sum(${orderItems.quantity} * ${orderItems.unitPrice} - ${orderItems.discount})`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(variants, eq(variants.id, orderItems.variantId))
      .innerJoin(products, eq(products.id, variants.productId))
      .where(counted)
      .groupBy(products.id)
      .orderBy(desc(sql`sum(${orderItems.quantity})`))
      .limit(10),
  ]);

  const cards = [
    {
      label: "Sales",
      value: formatMoney(sales.revenue, currency),
      note: `${sales.orders} ${sales.orders === 1 ? "order" : "orders"}`,
      icon: TrendingUp,
      tone: "bg-brand-50 border-brand-100",
      iconTone: "bg-brand-100 text-brand",
      href: "/orders",
    },
    {
      label: "Units Sold",
      value: `${pieces.units} units`,
      note: period.label,
      icon: ShoppingCart,
      tone: "bg-rose-50 border-rose-100",
      iconTone: "bg-rose-100 text-rose-600",
      href: "/orders",
    },
    {
      label: "Stock on hand",
      value: `${stock.units} units`,
      note: `${low.items} low or out`,
      icon: Package,
      tone: "bg-emerald-50 border-emerald-100",
      iconTone: "bg-emerald-100 text-emerald-600",
      href: "/inventory",
    },
    {
      label: "Inventory Value (at cost)",
      value: formatMoney(stock.cost, currency),
      note: `${formatMoney(stock.selling, currency)} at selling price`,
      icon: Coins,
      tone: "bg-brand-50 border-brand-100",
      iconTone: "bg-brand-100 text-brand",
      href: "/inventory",
    },
  ];

  return (
    <>
      <PageHeader title="Reports" subtitle="Your business in numbers." />

      <div className="mb-3 flex flex-wrap gap-1" aria-label="Period">
        {periods.map((p) => (
          <Link
            key={p.key}
            href={p.key === "30" ? "/reports" : `/reports?period=${p.key}`}
            className={
              "rounded-full px-3 py-1.5 text-xs font-semibold " +
              (p.key === period.key
                ? "bg-brand text-white"
                : "bg-stone-200/70 text-stone-700 hover:bg-stone-200")
            }
          >
            {p.label}
          </Link>
        ))}
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4" data-report-cards>
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className={"flex items-center gap-3 rounded-xl border px-4 py-3 hover:shadow-sm " + card.tone}
          >
            <span className={"flex size-10 shrink-0 items-center justify-center rounded-lg " + card.iconTone}>
              <card.icon className="size-5" strokeWidth={1.9} />
            </span>
            <span className="min-w-0">
              <span className="block truncate text-xs font-medium text-stone-600">{card.label}</span>
              <span className="block text-base leading-tight font-extrabold tabular-nums">
                {card.value}
              </span>
              <span className="block truncate text-[11px] text-stone-500">{card.note}</span>
            </span>
          </Link>
        ))}
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <Block title="Best sellers" subtitle={period.label} icon={<TrendingUp />} flush>
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full tabular-nums" data-best-sellers>
              <thead>
                <tr>
                  <th className="th rounded-l-lg">Product</th>
                  <th className="th text-center">Units Sold</th>
                  <th className="th rounded-r-lg text-right">Revenue</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {best.length === 0 && (
                  <tr>
                    <td colSpan={3} className="td py-4 text-center text-stone-500">
                      No sales in this period.
                    </td>
                  </tr>
                )}
                {best.map((row) => (
                  <tr key={row.id} className="hover:bg-stone-50">
                    <td className="td font-semibold">
                      <Link href={`/inventory/${row.id}`} className="hover:text-brand hover:underline">
                        {row.name}
                      </Link>
                    </td>
                    <td className="td text-center font-bold">{row.units}</td>
                    <td className="td text-right">{formatMoney(row.revenue, currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Block>

        <Block title="Money in stock" icon={<Coins />}>
          <dl className="space-y-2 text-sm">
            {[
              ["Total paid for stock", formatMoney(paid.total, currency), "/purchases"],
              ["Units purchased", String(paid.units), "/purchases"],
              ["Inventory value (at cost)", formatMoney(stock.cost, currency), "/inventory"],
              ["Inventory value (at selling price)", formatMoney(stock.selling, currency), "/inventory"],
              ["Items low or out of stock", String(low.items), "/inventory?view=low"],
            ].map(([label, value, href]) => (
              <Link key={label} href={href} className="flex items-center gap-3 hover:text-brand">
                <dt className="min-w-0 flex-1 font-semibold">{label}</dt>
                <dd className="w-36 rounded-lg bg-brand-50 px-3 py-1.5 text-right font-bold tabular-nums">
                  {value}
                </dd>
              </Link>
            ))}
          </dl>
        </Block>
      </div>
    </>
  );
}
