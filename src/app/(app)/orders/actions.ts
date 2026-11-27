"use server";

import { and, count, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import {
  conversations,
  customers,
  orderItems,
  orders,
  products,
  shipperRefClaims,
  users,
  variants,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { amount, cleanPhone, isUuid, optional, text, variantLabel } from "@/lib/format";
import { getPrefs } from "@/lib/settings";
import { changeStock, StockError } from "@/lib/stock";
import type { Tx } from "@/db";

// "fo 002" and "FO002" are the same reference.
const cleanRef = (value: string) => value.toUpperCase().replace(/\s+/g, "").slice(0, 40);

// Today's date where the business is, as 2026-11-27.
const todayIn = (timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

// A date picked for an order: empty, or a real day that is not in the future.
function readOrderDate(form: FormData, timezone: string) {
  const typed = text(form, "orderDate");
  if (typed === "") return { date: null };
  const real =
    /^\d{4}-\d{2}-\d{2}$/.test(typed) &&
    new Date(typed + "T00:00:00Z").toISOString().slice(0, 10) === typed;
  if (!real) return { error: "Choose a real order date." };
  if (typed > todayIn(timezone)) return { error: "The order date can't be in the future." };
  return { date: typed };
}

// One shipper ref belongs to one order. Taking a lock on the ref first means
// two people saving the same one at the same moment can't both get through.
async function refuseUsedRef(tx: Tx, ref: string, exceptOrderId?: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ref}))`);
  const [taken] = await tx
    .select({ number: orders.number })
    .from(orders)
    .where(
      and(
        sql`upper(${orders.trackingNumber}) = ${ref}`,
        exceptOrderId ? ne(orders.id, exceptOrderId) : undefined,
      ),
    )
    .limit(1);
  if (taken) throw new StockError(`${ref} is already used on Order #${taken.number}.`);
}

type Line = { variantId: string; quantity: number; unitPrice: string; discount: string };
const lineTotal = (line: Line) =>
  line.quantity * Number(line.unitPrice) - Number(line.discount);

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
    // A multi-piece price takes some off the line; never more than the line.
    const discount = Number(item?.discount ?? 0);
    if (!Number.isFinite(discount) || discount < 0 || discount > quantity * price + 0.005) {
      return null;
    }
    const existing = merged.get(variantId);
    if (existing) {
      existing.quantity += quantity;
      existing.discount = (Number(existing.discount) + discount).toFixed(2);
    } else {
      merged.set(variantId, {
        variantId,
        quantity,
        unitPrice: price.toFixed(2),
        discount: discount.toFixed(2),
      });
    }
  }
  return [...merged.values()];
}

export async function createOrder(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const name = text(form, "name");
  const phone = cleanPhone(text(form, "phone")) || null;
  const phone2 = cleanPhone(text(form, "phone2")) || null;
  const country = optional(form, "country");
  const city = optional(form, "city");
  const area = optional(form, "area");
  const street = optional(form, "street");
  const shippingFee = amount(form, "shippingFee");
  const codTyped = text(form, "cod");
  const codAmount = amount(form, "cod");
  const conversationId = text(form, "conversationId");
  const lines = readLines(form);
  const shipperRef = cleanRef(text(form, "shipperRef")) || null;
  const { timezone } = await getPrefs();
  const picked = readOrderDate(form, timezone);

  if (!name) return { error: "Enter the receiver's name." };
  if (!phone) return { error: "Enter the receiver's mobile number." };
  if (!country || !city || !area) return { error: "Choose the country, city and area." };
  if (!lines) return { error: "Something is wrong with the items. Please re-add them." };
  if (lines.length === 0) return { error: "Add at least one item." };
  if (shippingFee === null) return { error: "Delivery must be a number." };
  if (codTyped === "" || codAmount === null) return { error: "Enter the COD amount (0 if already paid)." };
  if (shipperRef && !/^FO\d{1,12}$/.test(shipperRef)) {
    return { error: "The shipper ref is FO followed by its number." };
  }
  if ("error" in picked) return { error: picked.error };
  // An order dated today is saved with this moment; an earlier day keeps
  // the time of day it was typed in.
  const createdAt =
    picked.date && picked.date !== todayIn(timezone)
      ? sql<Date>`((${picked.date}::date + (now() at time zone ${timezone})::time) at time zone ${timezone})`
      : undefined;

  const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
  const total = subtotal + Number(shippingFee);
  // Nothing to collect on delivery means it was paid already.
  const payment = Number(codAmount) > 0 ? "cod" : "prepaid";
  const where = { country, city, area, address: street };

  let orderId: string;
  try {
    orderId = await db.transaction(async (tx) => {
      if (shipperRef) await refuseUsedRef(tx, shipperRef);
      // Check stock first (and hold it) so a refused order never uses up
      // an order number.
      const found = await tx
        .select({
          id: variants.id,
          size: variants.size,
          color: variants.color,
          stock: variants.stock,
          name: products.name,
        })
        .from(variants)
        .innerJoin(products, eq(products.id, variants.productId))
        .where(
          inArray(
            variants.id,
            lines.map((l) => l.variantId),
          ),
        )
        .for("update", { of: variants });
      if (found.length !== lines.length) {
        throw new StockError("One of the items no longer exists.");
      }
      for (const line of lines) {
        const item = found.find((v) => v.id === line.variantId)!;
        if (line.quantity > item.stock) {
          const what = `${item.name} · ${variantLabel(item)}`;
          throw new StockError(
            item.stock <= 0
              ? `${what} is out of stock and can't be ordered. Someone may have just sold the last one.`
              : `Only ${item.stock} left of ${what}, so ${line.quantity} can't be ordered.`,
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
        // A returning customer's details follow their latest order.
        await tx
          .update(customers)
          .set({ name, ...where, ...(phone2 && { phone2 }) })
          .where(eq(customers.id, customerId));
      } else {
        const [created] = await tx
          .insert(customers)
          .values({ name, phone, phone2, ...where })
          .returning({ id: customers.id });
        customerId = created.id;
      }

      const [order] = await tx
        .insert(orders)
        .values({
          customerId,
          payment,
          source: optional(form, "source"),
          shippingAddress: [street, area, city, country].filter(Boolean).join(", "),
          country,
          city,
          area,
          street,
          phone2,
          shippingFee,
          codAmount,
          total: total.toFixed(2),
          instruction: optional(form, "instruction"),
          notes: optional(form, "notes"),
          trackingNumber: shipperRef,
          createdBy: user.id,
          ...(createdAt && { createdAt }),
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

      // This person is done typing; their hold on the ref is no longer needed.
      await tx.delete(shipperRefClaims).where(eq(shipperRefClaims.userId, user.id));

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

  // The screen clears its saved draft, then opens the new order.
  return { go: `/orders/${orderId}` };
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
  const typedRef = optional(form, "trackingNumber");
  const { timezone } = await getPrefs();
  const picked = readOrderDate(form, timezone);
  if ("error" in picked) return { error: picked.error };

  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          status: orders.status,
          number: orders.number,
          trackingNumber: orders.trackingNumber,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!order) throw new StockError("Order not found.");
      if (typedRef && cleanRef(typedRef) !== cleanRef(order.trackingNumber ?? "")) {
        await refuseUsedRef(tx, cleanRef(typedRef), orderId);
      }
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
          trackingNumber: typedRef,
          notes: optional(form, "notes"),
          // A changed date keeps the order's time of day.
          ...(picked.date && {
            createdAt: sql`((${picked.date}::date + (${orders.createdAt} at time zone ${timezone})::time) at time zone ${timezone})`,
          }),
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

// Looks up a returning customer by phone so their details can be filled in.
export async function lookupCustomer(phoneTyped: string) {
  await requireUser();
  const phone = cleanPhone(String(phoneTyped ?? ""));
  if (phone.replace("+", "").length < 6) return null;
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.phone, phone))
    .limit(1);
  if (!customer) return null;
  const [{ total }] = await db
    .select({ total: count() })
    .from(orders)
    .where(eq(orders.customerId, customer.id));
  return {
    name: customer.name,
    phone2: customer.phone2 ?? "",
    country: customer.country ?? "",
    city: customer.city ?? "",
    area: customer.area ?? "",
    street: customer.address ?? "",
    orders: total,
  };
}

// Called by the Create Order screen while a shipper ref is in the box. It
// notes that this person is working on that ref, and answers two questions:
// is the ref already on an order, and is anyone else typing the same one
// right now?
export async function watchShipperRef(typed: string) {
  const user = await requireUser();
  const ref = cleanRef(String(typed ?? ""));
  if (!/^FO\d{1,12}$/.test(ref)) return null;

  // One person works on one order at a time: drop their older holds, and
  // anything left behind from long ago.
  await db
    .delete(shipperRefClaims)
    .where(
      sql`(${shipperRefClaims.userId} = ${user.id} and ${shipperRefClaims.ref} <> ${ref})
        or ${shipperRefClaims.seenAt} < now() - interval '1 day'`,
    );
  await db
    .insert(shipperRefClaims)
    .values({ ref, userId: user.id })
    .onConflictDoUpdate({
      target: [shipperRefClaims.ref, shipperRefClaims.userId],
      set: { seenAt: sql`now()` },
    });

  const [[usedBy], others] = await Promise.all([
    db
      .select({ id: orders.id, number: orders.number })
      .from(orders)
      .where(sql`upper(${orders.trackingNumber}) = ${ref}`)
      .limit(1),
    db
      .select({ name: users.name })
      .from(shipperRefClaims)
      .innerJoin(users, eq(users.id, shipperRefClaims.userId))
      .where(
        and(
          eq(shipperRefClaims.ref, ref),
          ne(shipperRefClaims.userId, user.id),
          // Their screen checks in every few seconds while it is open.
          gt(shipperRefClaims.seenAt, sql`now() - interval '30 seconds'`),
        ),
      ),
  ]);
  return { ref, usedBy: usedBy ?? null, others: others.map((other) => other.name) };
}

// The ref was cleared or the order was abandoned.
export async function releaseShipperRef() {
  const user = await requireUser();
  await db.delete(shipperRefClaims).where(eq(shipperRefClaims.userId, user.id));
}
