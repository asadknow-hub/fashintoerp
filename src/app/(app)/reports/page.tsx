import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  Coins,
  Package,
  PiggyBank,
  ShoppingCart,
  TrendingUp,
  Truck,
  Undo2,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { Block, PageHeader } from "@/components/ui";
import { db } from "@/db";
import {
  deliveryCompanies,
  orderItems,
  orders,
  products,
  stockPurchases,
  variants,
} from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import {
  countsAsSale,
  customerRefund,
  itemShares,
  orderAmount,
  periodMoney,
  periodStart,
} from "@/lib/order-amount";
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
  const [, params, { currency, timezone }] = await Promise.all([
    // The money of the business is for Owners and the System Admin.
    requireOwner(),
    searchParams,
    getPrefs(),
  ]);
  const period = periods.find((p) => p.key === params.period) ?? periods[1];
  // Whole days in the business's own time zone, today included.
  const since = periodStart(period.days, timezone);
  // Orders that count as sales, taken inside the period.
  const counted = and(
    countsAsSale,
    since === null ? undefined : sql`${orders.createdAt} >= ${since}`,
  );
  // The money of the period, each amount on the day it happened.
  const money = periodMoney(since);

  const [
    [sales],
    [pieces],
    [stock],
    [paid],
    [low],
    best,
    payouts,
    [earned],
    [returns],
    [owed],
    [goods],
  ] = await Promise.all([
    db
      .select({
        orders: sql<number>`count(*)::int`,
        revenue: sql<string>`coalesce(sum(${orderAmount}), 0)`,
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
    // What each product brought in: its share of what customers paid (COD).
    db.execute<{ id: string; name: string; units: number; revenue: string }>(sql`
      select p.id, p.name, sum(s.quantity)::int as units, coalesce(sum(s.share), 0) as revenue
      from (${itemShares}) s
      join variants v on v.id = s.variant_id
      join products p on p.id = v.product_id
      where s.counts
        ${since === null ? sql`` : sql`and s.created_at >= ${since}`}
      group by p.id, p.name
      order by sum(s.quantity) desc, p.name
      limit 10`),
    db
      .select({
        company: sql<string>`coalesce(${deliveryCompanies.name}, 'No company chosen')`,
        orders: money.deliveredOrders,
        cod: money.collected,
        charges: money.charges,
      })
      .from(orders)
      .leftJoin(deliveryCompanies, eq(deliveryCompanies.id, orders.deliveryCompanyId))
      .where(money.touched)
      .groupBy(deliveryCompanies.id, deliveryCompanies.name)
      .having(sql`${money.collected} <> 0 or ${money.charges} <> 0 or ${money.deliveredOrders} > 0`)
      .orderBy(deliveryCompanies.name),
    // What the business earned: money in for delivered orders, less the
    // delivery companies' charges, less what was sent back on returns.
    db
      .select({ income: money.income, delivered: money.deliveredOrders })
      .from(orders)
      .where(money.touched),
    // Returns made in the period: what goes back to customers and what it costs.
    db
      .select({
        orders: sql<number>`count(*)::int`,
        refunds: sql<string>`coalesce(sum(${customerRefund}), 0)`,
        covered: sql<string>`coalesce(sum(${orders.returnFee}), 0)`,
        charges: sql<string>`coalesce(sum(${orders.returnCharge}), 0)`,
      })
      .from(orders)
      .where(money.returned),
    // Refunds not sent yet, however long ago the return was: money still owed.
    db
      .select({
        orders: sql<number>`count(*)::int`,
        unsent: sql<string>`coalesce(sum(${customerRefund}), 0)`,
      })
      .from(orders)
      .where(and(eq(orders.status, "returned"), isNull(orders.refundSentAt), sql`${customerRefund} > 0`)),
    // What the goods cost: the pieces of orders delivered in the period, less
    // the pieces that came back into stock in it. Pieces with no cost
    // recorded can't be counted and are reported as such.
    db.execute<{ out: string; back: string; unknown: number }>(sql`
      select
        coalesce(sum(i.quantity * i.unit_cost) filter (where ${money.delivered}), 0) as out,
        coalesce(sum(i.quantity * i.unit_cost) filter (
          where i.back_state = 'stock' and ${since === null ? sql`true` : sql`i.back_at >= ${since}`}
        ), 0) as back,
        coalesce(sum(i.quantity) filter (where ${money.delivered} and i.unit_cost is null), 0)::int as unknown
      from order_items i
      join orders on orders.id = i.order_id
      where orders.delivered_at is not null`),
  ]);
  const goodsCost = Number(goods.out) - Number(goods.back);
  const profit = Number(earned.income) - goodsCost;
  const payoutTotal = payouts.reduce(
    (sum, row) => ({
      orders: sum.orders + row.orders,
      cod: sum.cod + Number(row.cod),
      charges: sum.charges + Number(row.charges),
    }),
    { orders: 0, cod: 0, charges: 0 },
  );

  const cards = [
    {
      label: "Sales",
      value: formatMoney(sales.revenue, currency),
      note: `${sales.orders} ${sales.orders === 1 ? "order" : "orders"} · what customers pay (COD)`,
      icon: TrendingUp,
      tone: "bg-brand-50 border-brand-100",
      iconTone: "bg-brand-100 text-brand",
      href: "/orders",
    },
    {
      label: "Income",
      value: formatMoney(earned.income, currency),
      note: `${earned.delivered} delivered · COD less charges, returns and cancellations`,
      icon: Wallet,
      tone: "bg-emerald-50 border-emerald-100",
      iconTone: "bg-emerald-100 text-emerald-600",
      href: "/orders?status=delivered",
    },
    {
      label: "Profit",
      value: formatMoney(profit, currency),
      note:
        `Income less ${formatMoney(goodsCost, currency)} cost of goods` +
        (goods.unknown > 0 ? ` · ${goods.unknown} pcs have no cost` : ""),
      icon: PiggyBank,
      tone: "bg-amber-50 border-amber-100",
      iconTone: "bg-amber-100 text-amber-600",
      href: "/accounts?kind=stock",
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

      <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-5" data-report-cards>
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
                  <th className="th rounded-r-lg text-right">Revenue (COD)</th>
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
              ["Total paid for stock", formatMoney(paid.total, currency), "/accounts?kind=stock"],
              ["Units purchased", String(paid.units), "/accounts?kind=stock"],
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

      <div className="mt-3">
        <Block
          title="Money from delivery companies"
          subtitle={`Deliveries, returns and cancellations · ${period.label}`}
          icon={<Truck />}
          flush
        >
          <div className="overflow-x-auto px-4 pb-4">
            <table className="w-full tabular-nums" data-payouts>
              <thead>
                <tr>
                  <th className="th rounded-l-lg">Delivery company</th>
                  <th className="th text-center">Delivered orders</th>
                  <th className="th text-right">Collected from customers</th>
                  <th className="th text-right">Their delivery charges</th>
                  <th className="th rounded-r-lg text-right">You receive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {payouts.length === 0 && (
                  <tr>
                    <td colSpan={5} className="td py-4 text-center text-stone-500">
                      Nothing was delivered, returned or cancelled in this period.
                    </td>
                  </tr>
                )}
                {payouts.map((row) => (
                  <tr key={row.company} className="hover:bg-stone-50">
                    <td className="td font-semibold">{row.company}</td>
                    <td className="td text-center font-bold">{row.orders}</td>
                    <td className="td text-right">{formatMoney(row.cod, currency)}</td>
                    <td className="td text-right">− {formatMoney(row.charges, currency)}</td>
                    <td className="td text-right font-bold">
                      {formatMoney(Number(row.cod) - Number(row.charges), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {payouts.length > 0 && (
                <tfoot>
                  <tr className="bg-brand-100 font-bold">
                    <td className="td rounded-l-lg">Total</td>
                    <td className="td text-center">{payoutTotal.orders}</td>
                    <td className="td text-right">{formatMoney(payoutTotal.cod, currency)}</td>
                    <td className="td text-right">− {formatMoney(payoutTotal.charges, currency)}</td>
                    <td className="td rounded-r-lg bg-brand text-right text-white">
                      {formatMoney(payoutTotal.cod - payoutTotal.charges, currency)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </Block>
      </div>

      <div className="mt-3">
        <Block title="Returns" subtitle={period.label} icon={<Undo2 />}>
          <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-5" data-returns>
            {[
              ["Returned orders", String(returns.orders)],
              ["Refunds to customers", formatMoney(returns.refunds, currency)],
              ["Refunds still to send (all time)", formatMoney(owed.unsent, currency)],
              ["Return charges", formatMoney(returns.charges, currency)],
              ["Covered by customers", formatMoney(returns.covered, currency)],
            ].map(([label, value]) => (
              <Link
                key={label}
                href="/orders?status=returned"
                className="rounded-lg bg-brand-50 px-3 py-2 hover:bg-brand-100"
              >
                <dt className="text-xs font-semibold text-stone-600">{label}</dt>
                <dd className="font-bold tabular-nums">{value}</dd>
              </Link>
            ))}
          </dl>
        </Block>
      </div>
    </>
  );
}
