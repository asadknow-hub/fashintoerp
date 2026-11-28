import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { orderItems, orders, variants } from "@/db/schema";

// A count is of the shelf, and the shelf also holds the pieces of orders
// that were taken but not sent out yet: those are already off the stock
// number. So a count is compared with stock plus those pieces.
//
// Pieces per variant that are packed for (or waiting on) an order that has
// not been dispatched, for the given variants or for one whole product.
export async function shelfHeld(of: { variantIds: string[] } | { productId: string }) {
  const held = new Map<string, number>();
  if ("variantIds" in of && of.variantIds.length === 0) return held;
  const rows = await db
    .select({
      variantId: orderItems.variantId,
      pieces: sql<number>`sum(${orderItems.quantity})::int`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(variants, eq(variants.id, orderItems.variantId))
    .where(
      and(
        "variantIds" in of
          ? inArray(orderItems.variantId, of.variantIds)
          : eq(variants.productId, of.productId),
        inArray(orders.status, ["new", "confirmed", "packed"]),
        isNull(orders.dispatchedAt),
        isNull(orderItems.backState),
      ),
    )
    .groupBy(orderItems.variantId);
  for (const row of rows) held.set(row.variantId, row.pieces);
  return held;
}
