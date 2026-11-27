"use server";

import { and, count, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import {
  conversations,
  customers,
  deliveryCompanies,
  orderItems,
  orders,
  products,
  shipperRefClaims,
  users,
  variants,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  amount,
  cleanPhone,
  isUuid,
  optional,
  orderName,
  text,
  variantLabel,
} from "@/lib/format";
import { nextRefNumber } from "@/lib/order-ref";
import { getPrefs } from "@/lib/settings";
import { changeStock, StockError } from "@/lib/stock";
import type { Tx } from "@/db";

// The database refuses a second order with the same FO number.
const isDuplicate = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  ((err as { code?: string }).code === "23505" ||
    (err as { cause?: { code?: string } }).cause?.code === "23505");

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

// The name of the order that replaced this one in an exchange, if there is
// one that was not cancelled.
async function liveExchange(tx: Tx, orderId: string) {
  const [next] = await tx
    .select({ number: orders.number, ref: orders.trackingNumber })
    .from(orders)
    .where(and(eq(orders.exchangeOfId, orderId), ne(orders.status, "cancelled")))
    .limit(1);
  return next ? orderName(next.ref, next.number) : null;
}

// One shipper ref belongs to one order. Taking a lock on the ref first means
// two people saving the same one at the same moment can't both get through.
async function refuseUsedRef(tx: Tx, ref: string, exceptOrderId?: string) {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ref}))`);
  const [taken] = await tx
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        sql`upper(${orders.trackingNumber}) = ${ref}`,
        exceptOrderId ? ne(orders.id, exceptOrderId) : undefined,
      ),
    )
    .limit(1);
  if (taken) throw new StockError(`${ref} is already used on another order.`);
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
    // The same item twice at the same price is one line; at different
    // prices (one of them a gift, say) it stays two.
    const key = `${variantId}|${price.toFixed(2)}`;
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += quantity;
      existing.discount = (Number(existing.discount) + discount).toFixed(2);
    } else {
      merged.set(key, {
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
  // Set when this order replaces an earlier one (an exchange).
  const exchangeOf = text(form, "exchangeOf");
  if (exchangeOf && !isUuid(exchangeOf)) return { error: "The order being exchanged was not found." };
  const { timezone } = await getPrefs();
  const picked = readOrderDate(form, timezone);

  if (!name) return { error: "Enter the receiver's name." };
  if (!phone) return { error: "Enter the receiver's mobile number." };
  if (!country || !city || !area) return { error: "Choose the country, city and area." };
  if (!lines) return { error: "Something is wrong with the items. Please re-add them." };
  if (lines.length === 0) return { error: "Add at least one item." };
  if (shippingFee === null) return { error: "Delivery must be a number." };
  if (codTyped === "" || codAmount === null) return { error: "Enter the COD amount (0 if already paid)." };
  // The FO number is how the business knows an order, so every order has one.
  if (!shipperRef) return { error: "Enter the FO number." };
  if (!/^FO\d{1,12}$/.test(shipperRef)) {
    return { error: "The FO number is FO followed by its number." };
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
  // Nothing to collect on delivery means it was paid already. Not on an
  // exchange though: there the goods were paid for on the first order, and a
  // COD of zero means the business covers the delivery charge.
  const payment = Number(codAmount) > 0 || exchangeOf ? "cod" : "prepaid";
  const where = { country, city, area, address: street };

  let orderId: string;
  try {
    orderId = await db.transaction(async (tx) => {
      await refuseUsedRef(tx, shipperRef);
      // An exchange goes out with the same delivery company as the order
      // it replaces, unless another one is picked later.
      let exchangeCompany: string | null = null;
      let refundBase: string | null = null;
      if (exchangeOf) {
        const [original] = await tx
          .select({
            id: orders.id,
            status: orders.status,
            number: orders.number,
            ref: orders.trackingNumber,
            companyId: orders.deliveryCompanyId,
            payment: orders.payment,
            codAmount: orders.codAmount,
            total: orders.total,
            exchangeOfId: orders.exchangeOfId,
            refundBase: orders.refundBase,
          })
          .from(orders)
          .where(eq(orders.id, exchangeOf))
          .for("update");
        if (!original) throw new StockError("The order being exchanged was not found.");
        if (original.status !== "delivered") {
          throw new StockError("Only a delivered order can be exchanged.");
        }
        const swapped = await liveExchange(tx, original.id);
        if (swapped) {
          throw new StockError(
            `Order ${orderName(original.ref, original.number)} was already exchanged with ${swapped}. Exchange that order instead.`,
          );
        }
        exchangeCompany = original.companyId;
        // What the customer paid for the goods, carried along a chain of exchanges.
        refundBase =
          original.refundBase ??
          (original.payment === "cod" || original.exchangeOfId
            ? original.codAmount
            : original.total);
      }
      // Check stock first (and hold it) so a refused order never uses up
      // an order number.
      // How many of each item the order takes, over all its lines.
      const wanted = new Map<string, number>();
      for (const line of lines) {
        wanted.set(line.variantId, (wanted.get(line.variantId) ?? 0) + line.quantity);
      }
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
        .where(inArray(variants.id, [...wanted.keys()]))
        .for("update", { of: variants });
      if (found.length !== wanted.size) {
        throw new StockError("One of the items no longer exists.");
      }
      for (const item of found) {
        const quantity = wanted.get(item.id)!;
        if (quantity > item.stock) {
          const what = `${item.name} · ${variantLabel(item)}`;
          throw new StockError(
            item.stock <= 0
              ? `${what} is out of stock and can't be ordered. Someone may have just sold the last one.`
              : `Only ${item.stock} left of ${what}, so ${quantity} can't be ordered.`,
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
          exchangeOfId: exchangeOf || null,
          refundBase,
          deliveryCompanyId: exchangeCompany,
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
          note: `Order ${orderName(shipperRef, order.number)}`,
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
    if (isDuplicate(err)) return { error: `${shipperRef} is already used on another order.` };
    throw err;
  }

  // The screen clears its saved draft, then opens the new order.
  return { go: `/orders/${orderId}` };
}

type Status = (typeof orders.status.enumValues)[number];

// The step dates that go with a status: reaching a step keeps the date it
// was first reached, and going back clears the dates of the steps undone.
const steps: Partial<Record<Status, number>> = {
  new: 0,
  confirmed: 1,
  packed: 1,
  shipped: 2,
  delivered: 3,
};
function stamps(status: Status) {
  const step = steps[status];
  // A cancelled or returned order keeps the dates of what happened before.
  if (step === undefined) return {};
  return {
    portalAt: step >= 1 ? sql`coalesce(${orders.portalAt}, now())` : null,
    dispatchedAt: step >= 2 ? sql`coalesce(${orders.dispatchedAt}, now())` : null,
    deliveredAt: step >= 3 ? sql`coalesce(${orders.deliveredAt}, now())` : null,
  };
}
const closed = ["cancelled", "returned"];

// "Save Note" on the order page.
export async function saveOrderNote(
  orderId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireUser();
  if (!isUuid(orderId)) return { error: "Order not found." };
  await db
    .update(orders)
    .set({ notes: optional(form, "notes") })
    .where(eq(orders.id, orderId));
  refresh();
  return { ok: "Note saved." };
}

// The pencil on the order page. Anyone can correct the date and the FO
// number. A System Admin can also correct everything else that was typed
// when the order was taken: the receiver, the mobiles, the address, the COD,
// the delivery fee and the instruction.
export async function editOrder(
  orderId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(orderId)) return { error: "Order not found." };
  const ref = cleanRef(text(form, "ref"));
  if (!ref) return { error: "An order must have an FO number." };
  if (!/^FO\d{1,12}$/.test(ref)) return { error: "The FO number is FO followed by its number." };
  const { timezone } = await getPrefs();
  const picked = readOrderDate(form, timezone);
  if ("error" in picked) return { error: picked.error };

  // The rest of the details: only sent by, and only taken from, an admin.
  const full = form.has("name");
  if (full && user.role !== "owner") return { error: "Only a System Admin can change these details." };
  const name = text(form, "name");
  const phone = cleanPhone(text(form, "phone")) || null;
  const phone2 = cleanPhone(text(form, "phone2")) || null;
  const country = optional(form, "country");
  const city = optional(form, "city");
  const area = optional(form, "area");
  const street = optional(form, "street");
  const codAmount = amount(form, "cod");
  const shippingFee = amount(form, "shippingFee");
  if (full) {
    if (!name) return { error: "Enter the receiver's name." };
    if (!phone) return { error: "Enter the receiver's mobile number." };
    if (!country || !city || !area) return { error: "Enter the country, city and area." };
    if (text(form, "cod") === "" || codAmount === null) return { error: "The COD must be a number." };
    if (text(form, "shippingFee") === "" || shippingFee === null) {
      return { error: "The delivery fee must be a number." };
    }
  }

  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          ref: orders.trackingNumber,
          customerId: orders.customerId,
          exchangeOfId: orders.exchangeOfId,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!order) throw new StockError("Order not found.");
      if (ref !== cleanRef(order.ref ?? "")) await refuseUsedRef(tx, ref, orderId);

      let details = {};
      if (full) {
        // The order follows the mobile number: if it now belongs to another
        // customer the order moves to them, otherwise this customer is corrected.
        const [other] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.phone, phone!), ne(customers.id, order.customerId)))
          .limit(1);
        const customerId = other?.id ?? order.customerId;
        await tx
          .update(customers)
          .set({ name, phone, phone2, country, city, area, address: street })
          .where(eq(customers.id, customerId));
        const [items] = await tx
          .select({
            net: sql<string>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitPrice} - ${orderItems.discount}), 0)`,
          })
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId));
        details = {
          customerId,
          phone2,
          country,
          city,
          area,
          street,
          shippingAddress: [street, area, city, country].filter(Boolean).join(", "),
          codAmount,
          // Nothing to collect on delivery means it was paid already.
          payment:
            Number(codAmount) > 0 || order.exchangeOfId ? ("cod" as const) : ("prepaid" as const),
          shippingFee,
          total: (Number(items.net) + Number(shippingFee)).toFixed(2),
          instruction: optional(form, "instruction"),
        };
      }

      await tx
        .update(orders)
        .set({
          ...details,
          trackingNumber: ref,
          // A changed date keeps the order's time of day.
          ...(picked.date && {
            createdAt: sql`((${picked.date}::date + (${orders.createdAt} at time zone ${timezone})::time) at time zone ${timezone})`,
          }),
        })
        .where(eq(orders.id, orderId));
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    if (isDuplicate(err)) return { error: `${ref} is already used on another order.` };
    throw err;
  }
  refresh();
  return { ok: "Saved." };
}

// Deletes an order for good. Only a System Admin can. Its pieces that are
// still out (not already put back into stock, and not discarded) go back
// into stock if asked: right for an order entered by mistake, wrong for one
// whose pieces really are with a customer.
export async function deleteOrder(
  orderId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "owner") return { error: "Only a System Admin can delete an order." };
  if (!isUuid(orderId)) return { error: "Order not found." };
  const restock = form.get("restock") === "on";

  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({ number: orders.number, ref: orders.trackingNumber })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!order) throw new StockError("Order not found.");
      if (restock) {
        const items = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId))
          .for("update");
        for (const item of items) {
          if (item.backState === "stock" || item.backState === "discarded") continue;
          await changeStock(tx, {
            variantId: item.variantId,
            change: item.quantity,
            reason: "cancelled",
            note: `Order ${orderName(order.ref, order.number)} deleted`,
            orderId,
            userId: user.id,
          });
        }
      }
      // An exchange made for this order stands on its own from now on.
      await tx.update(orders).set({ exchangeOfId: null }).where(eq(orders.exchangeOfId, orderId));
      await tx.delete(orders).where(eq(orders.id, orderId));
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  return { go: "/orders" };
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
      .select({ id: orders.id })
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
          // Their screen checks in every 15 seconds while it is open.
          gt(shipperRefClaims.seenAt, sql`now() - interval '40 seconds'`),
        ),
      ),
  ]);
  return {
    ref,
    usedBy: usedBy ?? null,
    others: others.map((other) => other.name),
    // Only needed when this one is taken: the number to move on to.
    next: usedBy ? await nextRefNumber(user.id) : null,
  };
}

// The ref was cleared or the order was abandoned.
export async function releaseShipperRef() {
  const user = await requireUser();
  await db.delete(shipperRefClaims).where(eq(shipperRefClaims.userId, user.id));
}

// The ticks in the Actions pop-up of the orders list: entered in the delivery
// company's portal (and with which company), dispatched, delivered. Marking
// an order delivered also records what the company charged for it.
export async function setOrderProgress(
  orderId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireUser();
  if (!isUuid(orderId)) return { error: "Order not found." };
  // A later step means the earlier ones happened too.
  const delivered = form.get("delivered") === "on";
  const dispatched = delivered || form.get("dispatched") === "on";
  const portal = dispatched || form.get("portal") === "on";
  const companyId = text(form, "companyId");
  if (portal && !isUuid(companyId)) return { error: "Choose the delivery company." };
  const charge = delivered ? amount(form, "deliveryCharge") : null;
  if (delivered && (text(form, "deliveryCharge") === "" || charge === null)) {
    return { error: "Confirm the delivery charge for this order." };
  }
  // The state the pop-up was opened on.
  const was = text(form, "was");

  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({ status: orders.status })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!order) throw new StockError("Order not found.");
      if (closed.includes(order.status)) {
        throw new StockError(`This order is ${order.status}, so its steps can't be changed.`);
      }
      // Someone else moved the order while this pop-up was open: saving
      // these ticks would undo what they did.
      if (was && was !== order.status) {
        throw new StockError(
          "Someone else changed this order a moment ago. Close this, check the order, and try again.",
        );
      }
      // A delivered order that was exchanged, or whose pieces have started
      // coming back, can't be un-delivered: its money and stock are settled.
      if (order.status === "delivered" && !delivered) {
        const swapped = await liveExchange(tx, orderId);
        const [settledItem] = await tx
          .select({ id: orderItems.id })
          .from(orderItems)
          .where(
            and(eq(orderItems.orderId, orderId), inArray(orderItems.backState, ["stock", "discarded"])),
          )
          .limit(1);
        if (swapped || settledItem) {
          throw new StockError(
            swapped
              ? `This order was exchanged with ${swapped}, so it has to stay delivered.`
              : "Pieces of this order have already come back, so it has to stay delivered.",
          );
        }
      }
      if (portal) {
        const [company] = await tx
          .select({ id: deliveryCompanies.id })
          .from(deliveryCompanies)
          .where(eq(deliveryCompanies.id, companyId));
        if (!company) throw new StockError("That delivery company no longer exists.");
      }
      const status = delivered ? "delivered" : dispatched ? "shipped" : portal ? "confirmed" : "new";
      await tx
        .update(orders)
        .set({
          status,
          ...stamps(status),
          deliveryCompanyId: portal ? companyId : null,
          deliveryCharge: charge,
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

// The dates set while an order is on its way: is the parcel out of the
// building (handed to the delivery company)?
const isOut = (order: { dispatchedAt: Date | null }) => order.dispatchedAt !== null;

// "Cancel Order". Before the parcel was handed over, its pieces never left
// and go straight back into stock. After that it is on its way back with the
// driver: each piece is put back (or thrown away) on the order page once it
// has arrived. The delivery company bills a cancellation only when the
// customer opened the parcel first; that amount comes off the payout.
export async function cancelOrder(
  orderId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(orderId)) return { error: "Order not found." };
  const opened = form.get("opened") === "on";
  const fee = opened ? amount(form, "cancelFee") : null;
  if (opened && (text(form, "cancelFee") === "" || fee === null)) {
    return { error: "Enter what the delivery company charges for the opened parcel." };
  }

  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          status: orders.status,
          number: orders.number,
          ref: orders.trackingNumber,
          dispatchedAt: orders.dispatchedAt,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!order) throw new StockError("Order not found.");
      if (closed.includes(order.status)) throw new StockError(`This order is already ${order.status}.`);
      if (order.status === "delivered") {
        throw new StockError("This order was delivered. Create a return or an exchange instead.");
      }
      if (opened && !isOut(order)) {
        throw new StockError("The parcel has not been dispatched, so it can't have been opened.");
      }
      if (!isOut(order)) {
        const items = await tx
          .select()
          .from(orderItems)
          .where(eq(orderItems.orderId, orderId))
          .for("update");
        for (const item of items) {
          // A piece that was already put back or thrown away is settled.
          if (item.backState === "stock" || item.backState === "discarded") continue;
          await changeStock(tx, {
            variantId: item.variantId,
            change: item.quantity,
            reason: "cancelled",
            note: `Order ${orderName(order.ref, order.number)}`,
            orderId,
            userId: user.id,
          });
          await tx
            .update(orderItems)
            .set({ backState: "stock", backAt: sql`now()` })
            .where(eq(orderItems.id, item.id));
        }
      }
      await tx
        .update(orders)
        .set({ status: "cancelled", cancelledAt: sql`now()`, cancelFee: fee })
        .where(eq(orders.id, orderId));
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Order cancelled." };
}

// "Create Return" on a delivered order. The delivery company collects the
// parcel and charges for the trip; that comes off the payout. The customer
// is paid back by bank transfer, less the part of that delivery cost they
// agreed to cover: normally all of it, less if they argued, nothing if they
// insisted on everything back. The pieces go back into stock one by one on
// the order page, once they have arrived.
export async function createReturn(
  orderId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireUser();
  if (!isUuid(orderId)) return { error: "Order not found." };
  const fee = amount(form, "returnFee");
  if (text(form, "returnFee") === "" || fee === null) {
    return { error: "Enter how much of the delivery cost the customer covers (0 if none)." };
  }
  const charge = amount(form, "returnCharge");
  if (text(form, "returnCharge") === "" || charge === null) {
    return { error: "Enter what the delivery company charges for collecting the return." };
  }

  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          status: orders.status,
          payment: orders.payment,
          codAmount: orders.codAmount,
          total: orders.total,
          exchangeOfId: orders.exchangeOfId,
          refundBase: orders.refundBase,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!order) throw new StockError("Order not found.");
      if (closed.includes(order.status)) throw new StockError(`This order is already ${order.status}.`);
      if (order.status !== "delivered") {
        throw new StockError("Only a delivered order can be returned. Cancel this one instead.");
      }
      // The customer now holds the pieces of the order that replaced this one.
      const swapped = await liveExchange(tx, orderId);
      if (swapped) {
        throw new StockError(
          `This order was exchanged with ${swapped}. Create the return on that order instead.`,
        );
      }
      const paid = Number(
        order.refundBase ??
          (order.payment === "cod" || order.exchangeOfId ? order.codAmount : order.total),
      );
      if (Number(fee) > paid + 0.005) {
        throw new StockError("The customer can't cover more than they paid for the order.");
      }
      await tx
        .update(orders)
        .set({
          status: "returned",
          returnedAt: sql`now()`,
          returnFee: fee,
          returnCharge: charge,
          refundSentAt: null,
        })
        .where(eq(orders.id, orderId));
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Return created." };
}

// Ticked on a returned order once the customer's money has been sent back
// by bank transfer (and unticked if that was a mistake).
export async function markRefund(orderId: string, sent: boolean): Promise<ActionState> {
  await requireUser();
  if (!isUuid(orderId)) return { error: "Order not found." };
  const [order] = await db
    .update(orders)
    .set({ refundSentAt: sent ? sql`now()` : null })
    .where(and(eq(orders.id, orderId), eq(orders.status, "returned")))
    .returning({ id: orders.id });
  if (!order) return { error: "Only a returned order has a refund." };
  refresh();
  return { ok: "Saved." };
}

// What happened to a piece that was on its way back, picked on the order
// page once it arrived: put back into stock, thrown away, or not coming back
// after all. "Back into stock" and "thrown away" are final, so a piece can
// never be counted in twice.
export async function settleItem(
  itemId: string,
  state: "stock" | "discarded" | "none" | "waiting",
): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(itemId)) return { error: "That item was not found." };
  if (!["stock", "discarded", "none", "waiting"].includes(state)) {
    return { error: "Choose what happened to the item." };
  }

  try {
    await db.transaction(async (tx) => {
      // The order is locked before its item, the same way round as
      // everywhere else, so two people can't block each other.
      const [which] = await tx
        .select({ orderId: orderItems.orderId })
        .from(orderItems)
        .where(eq(orderItems.id, itemId));
      if (!which) throw new StockError("That item was not found.");
      const [order] = await tx
        .select({
          id: orders.id,
          status: orders.status,
          number: orders.number,
          ref: orders.trackingNumber,
          dispatchedAt: orders.dispatchedAt,
        })
        .from(orders)
        .where(eq(orders.id, which.orderId))
        .for("update");
      const [item] = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.id, itemId))
        .for("update");
      if (!order || !item) throw new StockError("That item was not found.");
      // Only an exchange that was not cancelled brings the old pieces back.
      const exchange = (await liveExchange(tx, order.id)) ?? undefined;
      // Pieces only come back from a return, a parcel refused after it was
      // sent out, or an order that was exchanged.
      const comingBack =
        order.status === "returned" ||
        (order.status === "cancelled" && isOut(order)) ||
        exchange !== undefined;
      if (!comingBack) throw new StockError("Nothing is coming back from this order.");
      if (item.backState === "stock" || item.backState === "discarded") {
        throw new StockError(
          item.backState === "stock"
            ? "This item was already put back into stock."
            : "This item was already marked as discarded.",
        );
      }
      if (state === "stock") {
        await changeStock(tx, {
          variantId: item.variantId,
          change: item.quantity,
          reason: order.status === "cancelled" ? "cancelled" : "return",
          note: `Order ${orderName(order.ref, order.number)}: received back`,
          orderId: order.id,
          userId: user.id,
        });
      }
      await tx
        .update(orderItems)
        .set({
          backState: state === "waiting" ? null : state,
          backAt: state === "waiting" ? null : sql`now()`,
        })
        .where(eq(orderItems.id, itemId));
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Saved." };
}
