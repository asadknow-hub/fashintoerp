"use server";

import { eq, inArray } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import {
  conversations,
  customers,
  orderItems,
  orders,
  variants,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { amount, isUuid, optional, text } from "@/lib/format";
import { changeStock, StockError } from "@/lib/stock";

type Line = { variantId: string; quantity: number; unitPrice: string };

function readLines(form: FormData): Line[] | null {
  let raw: unknown;
  try {
    raw = JSON.parse(text(form, "items"));
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const merged = new Map<string, Line>();
  for (const item of raw) {
    const variantId = String(item?.variantId ?? "");
    const quantity = Number(item?.quantity);
    const price = Number(item?.unitPrice);
    if (!isUuid(variantId)) return null;
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) return null;
    if (!Number.isFinite(price) || price < 0) return null;
    const existing = merged.get(variantId);
    if (existing) existing.quantity += quantity;
    else merged.set(variantId, { variantId, quantity, unitPrice: price.toFixed(2) });
  }
  return [...merged.values()];
}

export async function createOrder(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const name = text(form, "name");
  const phone = optional(form, "phone");
  const address = optional(form, "address");
  const city = optional(form, "city");
  const payment = text(form, "payment") === "prepaid" ? "prepaid" : "cod";
  const shippingFee = amount(form, "shippingFee");
  const discount = amount(form, "discount");
  const conversationId = text(form, "conversationId");
  const lines = readLines(form);

  if (!name) return { error: "Enter the customer's name." };
  if (!lines) return { error: "Something is wrong with the items. Please re-add them." };
  if (lines.length === 0) return { error: "Add at least one item." };
  if (shippingFee === null || discount === null) {
    return { error: "Delivery fee and discount must be numbers." };
  }

  const subtotal = lines.reduce(
    (sum, line) => sum + line.quantity * Number(line.unitPrice),
    0,
  );
  const total = subtotal + Number(shippingFee) - Number(discount);
  if (total < 0) return { error: "Discount is bigger than the order total." };

  let orderId: string;
  try {
    orderId = await db.transaction(async (tx) => {
      // Check stock first (and hold it) so a refused order never uses up
      // an order number.
      const found = await tx
        .select({ id: variants.id, sku: variants.sku, stock: variants.stock })
        .from(variants)
        .where(
          inArray(
            variants.id,
            lines.map((l) => l.variantId),
          ),
        )
        .for("update");
      if (found.length !== lines.length) {
        throw new StockError("One of the items no longer exists.");
      }
      for (const line of lines) {
        const item = found.find((v) => v.id === line.variantId)!;
        if (line.quantity > item.stock) {
          throw new StockError(
            `Not enough stock for ${item.sku} (only ${item.stock} left).`,
          );
        }
      }

      // Reuse the customer if we already know this phone number.
      const [existing] = phone
        ? await tx
            .select({ id: customers.id })
            .from(customers)
            .where(eq(customers.phone, phone))
            .limit(1)
        : [];
      let customerId = existing?.id;
      if (customerId) {
        await tx
          .update(customers)
          .set({ name, ...(address && { address }), ...(city && { city }) })
          .where(eq(customers.id, customerId));
      } else {
        const [created] = await tx
          .insert(customers)
          .values({ name, phone, address, city })
          .returning({ id: customers.id });
        customerId = created.id;
      }

      const [order] = await tx
        .insert(orders)
        .values({
          customerId,
          payment,
          source: optional(form, "source"),
          shippingAddress: [address, city].filter(Boolean).join(", ") || null,
          shippingFee,
          discount,
          total: total.toFixed(2),
          notes: optional(form, "notes"),
          createdBy: user.id,
        })
        .returning({ id: orders.id, number: orders.number });

      await tx
        .insert(orderItems)
        .values(lines.map((line) => ({ ...line, orderId: order.id })));
      for (const line of lines) {
        await changeStock(tx, {
          variantId: line.variantId,
          change: -line.quantity,
          reason: "sale",
          note: `Order #${order.number}`,
          orderId: order.id,
          userId: user.id,
        });
      }

      if (isUuid(conversationId)) {
        await tx
          .update(conversations)
          .set({ customerId })
          .where(eq(conversations.id, conversationId));
      }
      return order.id;
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }

  redirect(`/orders/${orderId}`);
}

const statuses = orders.status.enumValues;
const closed = ["cancelled", "returned"];

export async function updateOrder(
  orderId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const status = text(form, "status") as (typeof statuses)[number];
  if (!statuses.includes(status)) return { error: "Choose a status." };

  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({ status: orders.status, number: orders.number })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!order) throw new StockError("Order not found.");
      if (closed.includes(order.status) && order.status !== status) {
        throw new StockError(
          `This order is ${order.status} and its stock was put back. Create a new order instead.`,
        );
      }

      // Cancelling or returning puts the items back on the shelf.
      if (closed.includes(status) && order.status !== status) {
        const items = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId));
        for (const item of items) {
          await changeStock(tx, {
            variantId: item.variantId,
            change: item.quantity,
            reason: status === "returned" ? "return" : "cancelled",
            note: `Order #${order.number}`,
            orderId,
            userId: user.id,
          });
        }
      }

      await tx
        .update(orders)
        .set({
          status,
          trackingNumber: optional(form, "trackingNumber"),
          notes: optional(form, "notes"),
        })
        .where(eq(orders.id, orderId));
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Saved." };
}
