import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, orders, products } from "@/db/schema";
import { orderName } from "./format";

export type AuditArea = "orders" | "stock" | "products" | "staff" | "settings" | "account";

// Writes one line into the record of who did what. It is called after a
// change has been saved. A problem writing the line must never undo or block
// the change itself, so it is only reported.
export async function audit(
  by: { id: string; name: string },
  entry: {
    area: AuditArea;
    action: string;
    subject: string;
    summary: string;
    orderId?: string | null;
    productId?: string | null;
  },
) {
  try {
    await db.insert(auditLog).values({
      userId: by.id,
      userName: by.name,
      area: entry.area,
      action: entry.action,
      subject: entry.subject.slice(0, 200),
      summary: entry.summary.slice(0, 1000),
      orderId: entry.orderId ?? null,
      productId: entry.productId ?? null,
    });
  } catch (err) {
    console.error("Could not write to the activity log:", err);
  }
}

// "Order FO003", for the subject of a line about an order.
export async function orderSubject(orderId: string) {
  const [order] = await db
    .select({ number: orders.number, ref: orders.trackingNumber })
    .from(orders)
    .where(eq(orders.id, orderId));
  return order ? `Order ${orderName(order.ref, order.number)}` : "An order";
}

// The product's name, for the subject of a line about a product.
export async function productSubject(productId: string) {
  const [product] = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, productId));
  return product?.name ?? "A product";
}
