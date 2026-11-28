import { type SQL, sql } from "drizzle-orm";
import { orders } from "@/db/schema";

// What an order brings in: the cash collected on delivery, or, for an order
// that was paid beforehand, the value of its items and delivery.
// (An exchange always counts by its COD, even when that is zero: nothing was
// paid beforehand, the goods were paid for on the order it replaces.)
export const orderAmount = sql<string>`case when ${orders.payment} = 'cod' or ${orders.exchangeOfId} is not null then ${orders.codAmount} else ${orders.total} end`;

// Was an order that replaced this one in an exchange (or one further down
// the chain) returned in the end? Then nothing was sold after all: the
// customer got their money back.
export const exchangeReturned = (id: SQL) => sql`exists (
  with recursive chain as (
    select x.id, x.status from orders x
    where x.exchange_of_id = ${id} and x.status <> 'cancelled'
    union all
    select y.id, y.status from orders y
    join chain c on y.exchange_of_id = c.id
    where y.status <> 'cancelled'
  )
  select 1 from chain where status = 'returned'
)`;

// An order that counts as a sale: not cancelled, not returned, not an
// exchange (that replaces pieces already sold; its COD is only the delivery
// charge), and not an order whose exchange was returned in the end.
// (The order's own id is written out in full so it can never be mistaken
// for a column of the orders looked at inside.)
export const countsAsSale = sql`(
  ${orders.status} not in ('cancelled', 'returned')
  and ${orders.exchangeOfId} is null
  and not ${exchangeReturned(sql.raw('"orders"."id"'))}
)`;

// One row per line of an order, with `share`: that line's part of what the
// order brought in, and `counts`: whether the order counts as a sale.
// Revenue is the money the customer pays (the COD), not the price list, so
// the order's amount is split over its lines by their value, or by pieces
// when no prices were typed.
export const itemShares = sql`
  select
    i.order_id,
    i.variant_id,
    i.quantity,
    o.status,
    o.created_at,
    o.exchange_of_id,
    (
      o.status not in ('cancelled', 'returned')
      and o.exchange_of_id is null
      and not ${exchangeReturned(sql.raw("o.id"))}
    ) as counts,
      (case when o.payment = 'cod' or o.exchange_of_id is not null then o.cod_amount else o.total end)
    * (case
        when sum(i.quantity * i.unit_price - i.discount) over w > 0
          then (i.quantity * i.unit_price - i.discount)
            / sum(i.quantity * i.unit_price - i.discount) over w
        else i.quantity::numeric / nullif(sum(i.quantity) over w, 0)
      end) as share
  from order_items i
  join orders o on o.id = i.order_id
  window w as (partition by i.order_id)`;

// The delivery company's side of an order.
//
// What it collected from customers: the COD of an order it delivered. That
// stays collected even if the order was returned afterwards; the customer is
// paid back by bank transfer, not by the delivery company.
export const courierCollected = sql<string>`(
  case when ${orders.deliveredAt} is not null and ${orders.status} in ('delivered', 'returned')
    then ${orders.codAmount} else 0 end
)`;

// What it keeps for itself: the delivery charge of a delivered order, the
// charge for collecting a return, and the charge for a parcel that was
// opened and then refused.
export const courierCharges = sql<string>`(
  case when ${orders.deliveredAt} is not null and ${orders.status} in ('delivered', 'returned')
    then coalesce(${orders.deliveryCharge}, 0) else 0 end
  + case when ${orders.status} = 'returned' then coalesce(${orders.returnCharge}, 0) else 0 end
  + case when ${orders.status} = 'cancelled' then coalesce(${orders.cancelFee}, 0) else 0 end
)`;

// What goes back to the customer by bank transfer on a return: what they
// paid for the goods (on an exchange, what they paid on the order it
// replaced), less the part of the delivery cost they agreed to cover.
export const customerRefund = sql<string>`(
  case when ${orders.status} = 'returned' and ${orders.deliveredAt} is not null
    then greatest(coalesce(${orders.refundBase}, ${orderAmount}) - coalesce(${orders.returnFee}, 0), 0)
    else 0 end
)`;

// What an order earned in the end: the money that came in for it once it was
// delivered (its COD, or what was paid beforehand), less everything the
// delivery company charged, less what was sent back to the customer. A
// return therefore costs both delivery trips, less what the customer covered.
export const orderIncome = sql<string>`(
  case when ${orders.deliveredAt} is not null and ${orders.status} in ('delivered', 'returned')
    then ${orderAmount} else 0 end
  - ${courierCharges}
  - ${customerRefund}
)`;

/* ---------- A period of time ---------- */

// Where "the last N days" starts: at midnight, in the business's own time
// zone, N − 1 days ago. So "last 7 days" is today and the six days before
// it, whole days, not the last 168 hours. Nothing for "all time".
export function periodStart(days: number | null, timezone: string): SQL | null {
  if (days === null) return null;
  return sql`((date_trunc('day', now() at time zone ${timezone}) - make_interval(days => ${days - 1})) at time zone ${timezone})`;
}

// A stretch of time by name, for the accounts pages: where it starts and
// (for a month that is over) where it ends, both at midnight in the
// business's own time zone. Nothing means "no limit on that side".
export const namedPeriods = [
  { key: "month", label: "This month" },
  { key: "last-month", label: "Last month" },
  { key: "90", label: "Last 90 days" },
  { key: "year", label: "This year" },
  { key: "all", label: "All time" },
] as const;
export type PeriodKey = (typeof namedPeriods)[number]["key"];

export function periodRange(key: PeriodKey, timezone: string): { from: SQL | null; to: SQL | null } {
  const startOf = (unit: "month" | "year", back = sql`interval '0'`) =>
    sql`((date_trunc(${unit}, now() at time zone ${timezone}) - ${back}) at time zone ${timezone})`;
  switch (key) {
    case "month":
      return { from: startOf("month"), to: null };
    case "last-month":
      return { from: startOf("month", sql`interval '1 month'`), to: startOf("month") };
    case "90":
      return { from: periodStart(90, timezone), to: null };
    case "year":
      return { from: startOf("year"), to: null };
    default:
      return { from: null, to: null };
  }
}

// The same stretch for something kept as a calendar day (no time of day).
export const dayWithin = (day: SQL, range: { from: SQL | null; to: SQL | null }, timezone: string) =>
  sql`(
    ${range.from === null ? sql`true` : sql`${day} >= (${range.from} at time zone ${timezone})::date`}
    and ${range.to === null ? sql`true` : sql`${day} < (${range.to} at time zone ${timezone})::date`}
  )`;

const within = (at: SQL, since: SQL | null, until: SQL | null = null) =>
  sql`(
    ${since === null ? sql`true` : sql`${at} >= ${since}`}
    and ${until === null ? sql`true` : sql`${at} < ${until}`}
  )`;

// The money of a period, each amount counted on the day it happened: an
// order's COD and delivery charge on the day it was delivered, a return's
// charge and refund on the day it was returned, an opened-parcel fee on the
// day it was cancelled. So an order delivered in one month and returned in
// the next shows as money in for the first and money out for the second,
// the way the delivery company's own statements have it.
//
// The pieces are sums: use them in a select over orders.
export function periodMoney(since: SQL | null, until: SQL | null = null) {
  const delivered = sql`(
    ${orders.deliveredAt} is not null and ${orders.status} in ('delivered', 'returned')
    and ${within(sql`${orders.deliveredAt}`, since, until)}
  )`;
  const returned = sql`(
    ${orders.status} = 'returned'
    and ${within(sql`coalesce(${orders.returnedAt}, ${orders.deliveredAt}, ${orders.createdAt})`, since, until)}
  )`;
  const cancelled = sql`(
    ${orders.status} = 'cancelled'
    and ${within(sql`coalesce(${orders.cancelledAt}, ${orders.createdAt})`, since, until)}
  )`;
  // What came in for the delivered orders: their COD, or what was paid beforehand.
  const sales = sql<string>`coalesce(sum(${orderAmount}) filter (where ${delivered}), 0)`;
  // What the delivery company collected from customers.
  const collected = sql<string>`coalesce(sum(${orders.codAmount}) filter (where ${delivered}), 0)`;
  // What it kept: delivery charges, return charges, opened-parcel fees.
  const charges = sql<string>`(
    coalesce(sum(${orders.deliveryCharge}) filter (where ${delivered}), 0)
    + coalesce(sum(${orders.returnCharge}) filter (where ${returned}), 0)
    + coalesce(sum(${orders.cancelFee}) filter (where ${cancelled}), 0)
  )`;
  // What went back to customers by bank transfer.
  const refunds = sql<string>`coalesce(sum(${customerRefund}) filter (where ${returned}), 0)`;
  // What the business earned: money in for delivered orders, less the
  // delivery company's charges, less refunds.
  const income = sql<string>`(
    coalesce(sum(${orderAmount}) filter (where ${delivered}), 0) - ${charges} - ${refunds}
  )`;
  const deliveredOrders = sql<number>`(count(*) filter (where ${delivered} and ${orders.status} = 'delivered'))::int`;
  // Orders with anything at all in the period.
  const touched = sql`(${delivered} or ${returned} or ${cancelled})`;
  return {
    delivered,
    returned,
    cancelled,
    sales,
    collected,
    charges,
    refunds,
    income,
    deliveredOrders,
    touched,
  };
}
