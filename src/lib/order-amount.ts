import { sql } from "drizzle-orm";
import { orders } from "@/db/schema";

// What an order brings in: the cash collected on delivery, or, for an order
// that was paid beforehand, the value of its items and delivery.
export const orderAmount = sql<string>`case when ${orders.payment} = 'cod' then ${orders.codAmount} else ${orders.total} end`;
