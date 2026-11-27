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
