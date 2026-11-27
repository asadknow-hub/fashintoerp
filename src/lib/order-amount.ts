import { sql } from "drizzle-orm";
import { orders } from "@/db/schema";

// What an order brings in: the cash collected on delivery, or, for an order
// that was paid beforehand, the value of its items and delivery.
export const orderAmount = sql<string>`case when ${orders.payment} = 'cod' then ${orders.codAmount} else ${orders.total} end`;

// One row per line of an order, with `share`: that line's part of what the
// order brought in. Revenue is the money the customer pays (the COD), not
// the price list, so the order's amount is split over its lines by their
// value, or by pieces when no prices were typed.
export const itemShares = sql`
  select
    i.order_id,
    i.variant_id,
    i.quantity,
    o.status,
    o.created_at,
    o.exchange_of_id,
    (case when o.payment = 'cod' then o.cod_amount else o.total end)
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
// What it collected from customers: the COD of an order it delivered (that
// stays collected even if the order was returned afterwards), plus what a
// customer paid on a return waybill.
export const courierCollected = sql<string>`(
  case when ${orders.deliveredAt} is not null and ${orders.status} in ('delivered', 'returned')
    then ${orders.codAmount} else 0 end
  + case when ${orders.status} = 'returned' then coalesce(${orders.returnFee}, 0) else 0 end
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

// What an order earned in the end: what the delivery company pays over
// (collected less its charges), less the COD given back to the customer when
// a delivered order was returned. An exchange earns COD less the delivery
// charge like any order, which is zero when the customer pays the charge and
// negative when they pay less.
export const orderIncome = sql<string>`(
  ${courierCollected} - ${courierCharges}
  - case when ${orders.status} = 'returned' and ${orders.deliveredAt} is not null
      then ${orders.codAmount} else 0 end
)`;

// The day an order's money was settled: delivered, returned or cancelled.
export const settledAt = sql<Date>`coalesce(${orders.returnedAt}, ${orders.cancelledAt}, ${orders.deliveredAt}, ${orders.createdAt})`;
