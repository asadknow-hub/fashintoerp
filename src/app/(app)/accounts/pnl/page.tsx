import { sql } from "drizzle-orm";
import Link from "next/link";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import {
  dayWithin,
  namedPeriods,
  type PeriodKey,
  periodMoney,
  periodRange,
} from "@/lib/order-amount";
import { getPrefs } from "@/lib/settings";

// Profit and loss for a period, top to bottom:
//
//   money in for delivered orders
//   − what the delivery companies kept − refunds to customers
//   = income from orders
//   − what the goods that were sold cost
//   = gross profit
//   + other money in − expenses          (the accounts book)
//   = net profit
//
// Stock that was bought is not an expense here: it is counted, piece by
// piece, as cost of goods when it is sold. Every amount is counted on the
// day it happened. Only Owners and the System Admin can see it.
export default async function ProfitAndLossPage({ searchParams }: PageProps<"/accounts/pnl">) {
  const [, params, { currency, timezone }] = await Promise.all([
    requireOwner(),
    searchParams,
    getPrefs(),
  ]);
  const period: PeriodKey = namedPeriods.some((p) => p.key === params.period)
    ? (params.period as PeriodKey)
    : "month";
  const range = periodRange(period, timezone);
  const money = periodMoney(range.from, range.to);
  const inRange = (at: ReturnType<typeof sql>) => sql`(
    ${range.from === null ? sql`true` : sql`${at} >= ${range.from}`}
    and ${range.to === null ? sql`true` : sql`${at} < ${range.to}`}
  )`;

  const [[fromOrders], [goods], book, [stock]] = await Promise.all([
    db
      .select({
        sales: money.sales,
        charges: money.charges,
        refunds: money.refunds,
        delivered: money.deliveredOrders,
      })
      .from(orders)
      .where(money.touched),
    // The pieces of orders delivered in the period, less the pieces that
    // came back into stock in it.
    db.execute<{ out: string; back: string; unknown: number }>(sql`
      select
        coalesce(sum(i.quantity * i.unit_cost) filter (where ${money.delivered}), 0) as out,
        coalesce(sum(i.quantity * i.unit_cost) filter (
          where i.back_state = 'stock' and ${inRange(sql`i.back_at`)}
        ), 0) as back,
        coalesce(sum(i.quantity) filter (where ${money.delivered} and i.unit_cost is null), 0)::int as unknown
      from order_items i
      join orders on orders.id = i.order_id
      where orders.delivered_at is not null`),
    // The accounts book, added up by what each line was for.
    db.execute<{ direction: "out" | "in"; purpose: string; total: string; lines: number }>(sql`
      select direction, min(purpose) as purpose, sum(amount) as total, count(*)::int as lines
      from transactions
      where ${dayWithin(sql`day`, range, timezone)}
      group by direction, lower(trim(purpose))
      order by direction, sum(amount) desc`),
    db.execute<{ paid: string; units: number }>(sql`
      select coalesce(sum(total_cost), 0) as paid, coalesce(sum(units), 0)::int as units
      from stock_purchases
      where ${inRange(sql`created_at`)}`),
  ]);

  const sales = Number(fromOrders.sales);
  const charges = Number(fromOrders.charges);
  const refunds = Number(fromOrders.refunds);
  const income = sales - charges - refunds;
  const goodsCost = Number(goods.out) - Number(goods.back);
  const gross = income - goodsCost;
  const moneyIn = book.filter((line) => line.direction === "in");
  const expenses = book.filter((line) => line.direction === "out");
  const otherIn = moneyIn.reduce((sum, line) => sum + Number(line.total), 0);
  const spent = expenses.reduce((sum, line) => sum + Number(line.total), 0);
  const net = gross + otherIn - spent;

  const show = (value: number) => `${value < 0 ? "− " : ""}${formatMoney(Math.abs(value), currency)}`;
  // One line of the statement. `sign` is how it counts: "+" in, "−" out.
  const line = (label: React.ReactNode, value: number, sign: "+" | "−", key: string, sub = false) => (
    <div
      key={key}
      data-line={key}
      className={"flex items-baseline justify-between gap-3 px-4 py-2 " + (sub ? "pl-8 text-stone-600" : "")}
    >
      <dt className="min-w-0">{label}</dt>
      <dd className={"shrink-0 tabular-nums " + (sign === "−" ? "text-rose-700" : "")}>
        {sign === "−" ? "− " : ""}
        {formatMoney(value, currency)}
      </dd>
    </div>
  );
  const total = (label: string, value: number, key: string, strong = false) => (
    <div
      key={key}
      data-line={key}
      className={
        "flex items-baseline justify-between gap-3 px-4 py-2.5 font-bold " +
        (strong
          ? value < 0
            ? "bg-rose-600 text-white"
            : "bg-brand text-white"
          : "bg-brand-50")
      }
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{show(value)}</dd>
    </div>
  );
  const pill = (on: boolean) =>
    "rounded-full px-3 py-1.5 text-xs font-semibold " +
    (on ? "bg-brand text-white" : "bg-stone-200/70 text-stone-700 hover:bg-stone-200");

  return (
    <>
      <PageHeader
        title="P&L"
        subtitle="Profit and loss: what came in, what it cost, and what is left."
      />

      <div className="mb-3 flex flex-wrap gap-1" aria-label="Period">
        {namedPeriods.map((option) => (
          <Link
            key={option.key}
            href={option.key === "month" ? "/accounts/pnl" : `/accounts/pnl?period=${option.key}`}
            className={pill(period === option.key)}
          >
            {option.label}
          </Link>
        ))}
      </div>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <dl className="card divide-y divide-stone-100 overflow-hidden text-sm" data-pnl>
          <div className="bg-stone-50 px-4 py-2 text-xs font-bold text-stone-600">Orders</div>
          {line(
            <>
              Money in for delivered orders{" "}
              <span className="text-xs text-stone-500">
                ({fromOrders.delivered} delivered and kept)
              </span>
            </>,
            sales,
            "+",
            "sales",
          )}
          {line("Delivery companies' charges", charges, "−", "charges")}
          {line("Refunds to customers", refunds, "−", "refunds")}
          {total("Income from orders", income, "income")}
          {line(
            <>
              Cost of the goods sold
              {goods.unknown > 0 && (
                <span className="block text-xs text-amber-700">
                  {goods.unknown} {goods.unknown === 1 ? "piece has" : "pieces have"} no cost
                  recorded, so the real figure is higher.
                </span>
              )}
            </>,
            goodsCost,
            "−",
            "goods",
          )}
          {total("Gross profit", gross, "gross")}

          <div className="bg-stone-50 px-4 py-2 text-xs font-bold text-stone-600">
            Accounts book
          </div>
          {line("Other money in", otherIn, "+", "other-in")}
          {moneyIn.map((entry) =>
            line(entry.purpose, Number(entry.total), "+", `in:${entry.purpose}`, true),
          )}
          {line("Expenses", spent, "−", "expenses")}
          {expenses.map((entry) =>
            line(
              <>
                {entry.purpose}
                {entry.lines > 1 && <span className="text-xs text-stone-400"> × {entry.lines}</span>}
              </>,
              Number(entry.total),
              "−",
              `out:${entry.purpose}`,
              true,
            ),
          )}
          {total(net < 0 ? "Net loss" : "Net profit", net, "net", true)}
        </dl>

        <div className="space-y-3 text-sm">
          <div className="card p-4" data-pnl-notes>
            <h2 className="mb-2 text-sm font-bold">How to read this</h2>
            <ul className="list-disc space-y-1.5 pl-4 text-stone-600">
              <li>Every amount is counted on the day it happened.</li>
              <li>
                Stock you bought is not an expense here. It is counted piece by piece, as cost of
                goods, when it is sold.
              </li>
              <li>
                Stock bought in this period: <b>{formatMoney(stock.paid, currency)}</b> for{" "}
                {stock.units} {stock.units === 1 ? "piece" : "pieces"}.
              </li>
              <li>
                Expenses and other money in come from the{" "}
                <Link href="/accounts" className="font-semibold text-brand hover:underline">
                  transactions
                </Link>{" "}
                you record under Accounts.
              </li>
            </ul>
          </div>
        </div>
      </div>
    </>
  );
}
