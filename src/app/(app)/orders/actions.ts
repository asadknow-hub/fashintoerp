"use server";

import { type AnyColumn, and, count, eq, gt, inArray, ne, sql } from "drizzle-orm";
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
import { audit, orderSubject } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import {
  amount,
  cleanPhone,
  formatMoney,
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

// A day picked in a form: empty, or a real day that is not in the future.
function readDay(form: FormData, field: string, what: string, timezone: string) {
  const typed = text(form, field);
  if (typed === "") return { date: null };
  const real =
    /^\d{4}-\d{2}-\d{2}$/.test(typed) &&
    new Date(typed + "T00:00:00Z").toISOString().slice(0, 10) === typed;
  if (!real) return { error: `Choose a real ${what}.` };
  if (typed > todayIn(timezone)) return { error: `The ${what} can't be in the future.` };
  return { date: typed };
}

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
          cost: variants.cost,
          name: products.name,
          archived: products.archived,
        })
        .from(variants)
        .innerJoin(products, eq(products.id, variants.productId))
        .where(inArray(variants.id, [...wanted.keys()]))
        // Always in the same order, so two orders can't wait on each other.
        .orderBy(variants.id)
        .for("update", { of: variants });
      if (found.length !== wanted.size) {
        throw new StockError("One of the items no longer exists.");
      }
      for (const item of found) {
        if (item.archived) {
          throw new StockError(`${item.name} is no longer on sale. Take it off the order.`);
        }
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
          // A description left as written from the items is not kept: the
          // list and the order page write it from the items themselves.
          notes: form.get("notesAuto") === "1" ? null : optional(form, "notes"),
          trackingNumber: shipperRef,
          exchangeOfId: exchangeOf || null,
          refundBase,
          deliveryCompanyId: exchangeCompany,
          createdBy: user.id,
          ...(createdAt && { createdAt }),
        })
        .returning({ id: orders.id, number: orders.number });

      // What each piece cost the business today is kept on the line, so
      // profit can be worked out later whatever stock costs by then.
      const costNow = new Map(found.map((item) => [item.id, item.cost]));
      await tx.insert(orderItems).values(
        lines.map((line) => ({
          ...line,
          orderId: order.id,
          unitCost: Number(costNow.get(line.variantId)) > 0 ? costNow.get(line.variantId) : null,
        })),
      );
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

  const pieces = lines.reduce((sum, line) => sum + line.quantity, 0);
  await audit(user, {
    area: "orders",
    action: "order.created",
    subject: `Order ${shipperRef}`,
    summary:
      `Created the order for ${name}: ${pieces} ${pieces === 1 ? "piece" : "pieces"}, COD ${formatMoney(codAmount)}` +
      (exchangeOf ? " (an exchange)" : ""),
    orderId,
  });
  // The screen clears its saved draft, then opens the new order.
  // Lists opened before now (and reached again with the Back button) are
  // fetched afresh, so the new order is on them.
  refresh();
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
  const user = await requireUser();
  if (!isUuid(orderId)) return { error: "Order not found." };
  const note = optional(form, "notes");
  await db.update(orders).set({ notes: note }).where(eq(orders.id, orderId));
  await audit(user, {
    area: "orders",
    action: "order.note",
    subject: await orderSubject(orderId),
    summary: note ? `Changed the note to: ${note.slice(0, 200)}` : "Removed the note",
    orderId,
  });
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
  if (full && user.role === "staff") return { error: "Only an Owner or the System Admin can change these details." };
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

  // What was changed, for the activity log: "COD AED 69.00 → AED 75.00".
  const changes: string[] = [];
  const changed = (label: string, before: string | null, after: string | null) => {
    if ((before ?? "") !== (after ?? "")) changes.push(`${label} ${before || "empty"} → ${after || "empty"}`);
  };
  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          ref: orders.trackingNumber,
          customerId: orders.customerId,
          exchangeOfId: orders.exchangeOfId,
          createdAt: orders.createdAt,
          phone2: orders.phone2,
          country: orders.country,
          city: orders.city,
          area: orders.area,
          street: orders.street,
          codAmount: orders.codAmount,
          shippingFee: orders.shippingFee,
          instruction: orders.instruction,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!order) throw new StockError("Order not found.");
      if (ref !== cleanRef(order.ref ?? "")) await refuseUsedRef(tx, ref, orderId);
      changed("FO number", order.ref, ref);
      const dayWas = new Intl.DateTimeFormat("en-CA", {
        timeZone: timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(order.createdAt);
      if (picked.date) changed("date", dayWas, picked.date);

      let details = {};
      // What the customer pays for the goods, when that was edited.
      let paidNow: string | null = null;
      if (full) {
        // The order follows the mobile number: if it now belongs to another
        // customer the order moves to them, otherwise this customer is corrected.
        const [other] = await tx
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.phone, phone!), ne(customers.id, order.customerId)))
          .limit(1);
        const customerId = other?.id ?? order.customerId;
        const [person] = await tx
          .select({ name: customers.name, phone: customers.phone })
          .from(customers)
          .where(eq(customers.id, order.customerId));
        changed("receiver", person?.name ?? null, name);
        changed("mobile 1", person?.phone ?? null, phone);
        changed("mobile 2", order.phone2, phone2);
        changed("country", order.country, country);
        changed("city", order.city, city);
        changed("area", order.area, area);
        changed("street", order.street, street);
        changed("COD", formatMoney(order.codAmount), formatMoney(codAmount));
        changed("delivery fee", formatMoney(order.shippingFee), formatMoney(shippingFee));
        changed("instruction", order.instruction, optional(form, "instruction"));
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
        paidNow =
          Number(codAmount) > 0 || order.exchangeOfId
            ? codAmount
            : (Number(items.net) + Number(shippingFee)).toFixed(2);
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
      // What the customer paid here is what a return of the order that
      // replaced it (and of any further exchange) gives back.
      if (paidNow !== null && !order.exchangeOfId) {
        const paid = paidNow;
        await tx.execute(sql`
          with recursive chain as (
            select x.id from orders x where x.exchange_of_id = ${orderId}
            union all
            select y.id from orders y join chain c on y.exchange_of_id = c.id
          )
          update orders set refund_base = ${paid} where id in (select id from chain)`);
      }
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    if (isDuplicate(err)) return { error: `${ref} is already used on another order.` };
    throw err;
  }
  if (changes.length > 0) {
    await audit(user, {
      area: "orders",
      action: "order.edited",
      subject: `Order ${ref}`,
      summary: `Edited: ${changes.join("; ")}`,
      orderId,
    });
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
  if (user.role === "staff") return { error: "Only an Owner or the System Admin can delete an order." };
  if (!isUuid(orderId)) return { error: "Order not found." };
  const restock = form.get("restock") === "on";
  // The state the pop-up was opened on.
  const was = text(form, "was");

  let gone = { subject: "An order", summary: "Deleted the order" };
  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          number: orders.number,
          ref: orders.trackingNumber,
          status: orders.status,
          codAmount: orders.codAmount,
          customer: customers.name,
        })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(eq(orders.id, orderId))
        .for("update", { of: orders });
      if (!order) throw new StockError("Order not found.");
      // Whether to put the pieces back was decided looking at an older state.
      if (was && was !== order.status) {
        throw new StockError(
          "Someone else changed this order a moment ago. Close this, check the order, and try again.",
        );
      }
      // Its old pieces are still coming back through the order that replaced it.
      const swapped = await liveExchange(tx, orderId);
      if (swapped) {
        throw new StockError(
          `This order was exchanged with ${swapped}. Delete (or cancel) that order first.`,
        );
      }
      gone = {
        subject: `Order ${orderName(order.ref, order.number)}`,
        summary:
          `Deleted the order (${order.customer}, ${order.status}, COD ${formatMoney(order.codAmount)})` +
          (restock ? "; its pieces that were still out went back into stock" : "; stock was not changed"),
      };
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
  await audit(user, { area: "orders", action: "order.deleted", ...gone, orderId });
  // (The list is refreshed by the screen once it has left this order's
  // page: refreshing here would redraw a page whose order is gone.)
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
  const user = await requireUser();
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

  let moved: { from: Status; to: Status; company: string | null } | null = null;
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
      let companyName: string | null = null;
      if (portal) {
        const [company] = await tx
          .select({ id: deliveryCompanies.id, name: deliveryCompanies.name })
          .from(deliveryCompanies)
          .where(eq(deliveryCompanies.id, companyId));
        if (!company) throw new StockError("That delivery company no longer exists.");
        companyName = company.name;
      }
      const status = delivered ? "delivered" : dispatched ? "shipped" : portal ? "confirmed" : "new";
      // Back on its way: nothing of it is "not coming back" any more.
      if (order.status === "delivered" && !delivered) {
        await tx
          .update(orderItems)
          .set({ backState: null, backAt: null })
          .where(and(eq(orderItems.orderId, orderId), eq(orderItems.backState, "none")));
      }
      moved = { from: order.status, to: status, company: companyName };
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
  // One line per step that was newly reached, so each has its own "by whom".
  const change = moved as { from: Status; to: Status; company: string | null } | null;
  if (change) {
    const subject = await orderSubject(orderId);
    const before = steps[change.from] ?? 0;
    const after = steps[change.to] ?? 0;
    const names = ["New", "In portal", "Dispatched", "Delivered"];
    const line = (action: string, summary: string) =>
      audit(user, { area: "orders", action, subject, summary, orderId });
    if (after > before) {
      if (before < 1) {
        await line("order.portal", `Created in the delivery portal${change.company ? ` (${change.company})` : ""}`);
      }
      if (before < 2 && after >= 2) await line("order.dispatched", "Marked as dispatched");
      if (after >= 3) {
        await line("order.delivered", `Marked as delivered, delivery charge ${formatMoney(charge)}`);
      }
    } else if (after < before) {
      await line("order.steps_undone", `Moved back from ${names[before]} to ${names[after]}`);
    } else {
      await line(
        "order.delivery_updated",
        "Updated the delivery details" +
          (change.company ? `: ${change.company}` : "") +
          (charge !== null ? `, delivery charge ${formatMoney(charge)}` : ""),
      );
    }
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

  let wasOut = false;
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
      await tx
        .update(orderItems)
        .set({ backState: null, backAt: null })
        .where(and(eq(orderItems.orderId, orderId), eq(orderItems.backState, "none")));
      wasOut = isOut(order);
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  await audit(user, {
    area: "orders",
    action: "order.cancelled",
    subject: await orderSubject(orderId),
    summary:
      "Cancelled the order" +
      (opened ? ` after the customer opened the parcel, ${formatMoney(fee)} charged` : "") +
      (wasOut ? "; its pieces are on their way back" : "; its pieces went back into stock"),
    orderId,
  });
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
  const user = await requireUser();
  if (!isUuid(orderId)) return { error: "Order not found." };
  const fee = amount(form, "returnFee");
  if (text(form, "returnFee") === "" || fee === null) {
    return { error: "Enter how much of the delivery cost the customer covers (0 if none)." };
  }
  const charge = amount(form, "returnCharge");
  if (text(form, "returnCharge") === "" || charge === null) {
    return { error: "Enter what the delivery company charges for collecting the return." };
  }

  let refund = 0;
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
      refund = Math.max(paid - Number(fee), 0);
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
      // A piece marked "not coming back" during an earlier exchange is on
      // its way back now.
      await tx
        .update(orderItems)
        .set({ backState: null, backAt: null })
        .where(and(eq(orderItems.orderId, orderId), eq(orderItems.backState, "none")));
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  await audit(user, {
    area: "orders",
    action: "order.returned",
    subject: await orderSubject(orderId),
    summary: `Created a return: the customer covers ${formatMoney(fee)} of the delivery, return charge ${formatMoney(charge)}, refund ${formatMoney(refund)}`,
    orderId,
  });
  refresh();
  return { ok: "Return created." };
}

// Ticked on a returned order once the customer's money has been sent back
// by bank transfer (and unticked if that was a mistake).
export async function markRefund(orderId: string, sent: boolean): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(orderId)) return { error: "Order not found." };
  const [order] = await db
    .update(orders)
    .set({ refundSentAt: sent ? sql`now()` : null })
    .where(and(eq(orders.id, orderId), eq(orders.status, "returned")))
    .returning({ id: orders.id });
  if (!order) return { error: "Only a returned order has a refund." };
  await audit(user, {
    area: "orders",
    action: "order.refund",
    subject: await orderSubject(orderId),
    summary: sent ? "Marked the refund as sent to the customer" : "Marked the refund as not sent yet",
    orderId,
  });
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
  let settled: { orderId: string; subject: string; piece: string } | null = null;

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
      const [piece] = await tx
        .select({ size: variants.size, color: variants.color })
        .from(variants)
        .where(eq(variants.id, item.variantId));
      settled = {
        orderId: order.id,
        subject: `Order ${orderName(order.ref, order.number)}`,
        piece: `${item.quantity} × ${[piece?.size, piece?.color].filter(Boolean).join(" ")}`,
      };
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  const done = settled as { orderId: string; subject: string; piece: string } | null;
  if (done) {
    await audit(user, {
      area: "orders",
      action: "order.item_" + state,
      subject: done.subject,
      summary:
        done.piece +
        (state === "stock"
          ? " received back into stock"
          : state === "discarded"
            ? " received and discarded"
            : state === "none"
              ? " marked as not coming back"
              : " marked as awaited again"),
      orderId: done.orderId,
    });
  }
  refresh();
  return { ok: "Saved." };
}

// "Correct journey" on the order page, for the System Admin only: when an
// audit shows an order was marked wrongly (delivered when it was really
// cancelled, returned when it was really delivered, and so on), set what
// really happened in one go. Any state can be reached from any other.
//
// Stock follows what is physically true:
//   - an order that is (back) on its way or with the customer has its pieces
//     out, so pieces that were put back into stock for it are taken out again;
//   - cancelled before the parcel was sent out: its pieces go back now;
//   - cancelled after it was sent out, or returned: the pieces are on their
//     way back and are settled one by one on the order page, as always.
const journeyTargets = ["new", "portal", "dispatched", "delivered", "cancelled", "returned"] as const;
type JourneyTarget = (typeof journeyTargets)[number];
const journeyStatus: Record<JourneyTarget, Status> = {
  new: "new",
  portal: "confirmed",
  dispatched: "shipped",
  delivered: "delivered",
  cancelled: "cancelled",
  returned: "returned",
};
const statusName: Record<Status, string> = {
  new: "New",
  confirmed: "In portal",
  packed: "In portal",
  shipped: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled",
  returned: "Returned",
};

export async function correctJourney(
  orderId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (user.role !== "admin") {
    return { error: "Only the System Admin can correct an order's journey." };
  }
  if (!isUuid(orderId)) return { error: "Order not found." };
  const target = journeyTargets.find((one) => one === text(form, "target"));
  if (!target) return { error: "Choose what really happened to the order." };
  // The state the pop-up was opened on.
  const was = text(form, "was");

  // Did the parcel leave the building? Always for a dispatched, delivered or
  // returned order; for a cancelled one it is asked.
  const sentOut =
    target === "cancelled"
      ? form.get("sentOut") === "on"
      : target === "dispatched" || target === "delivered" || target === "returned";
  const withCompany = target === "portal" || sentOut;
  const companyId = text(form, "companyId");
  if (withCompany && !isUuid(companyId)) return { error: "Choose the delivery company." };
  const reached = target === "delivered" || target === "returned";
  const charge = reached ? amount(form, "deliveryCharge") : null;
  if (reached && (text(form, "deliveryCharge") === "" || charge === null)) {
    return { error: "Enter the delivery charge of this order." };
  }
  const opened = target === "cancelled" && form.get("opened") === "on";
  if (opened && !sentOut) {
    return { error: "A parcel that was not sent out can't have been opened by the customer." };
  }
  const cancelFee = opened ? amount(form, "cancelFee") : null;
  if (opened && (text(form, "cancelFee") === "" || cancelFee === null)) {
    return { error: "Enter what the delivery company charges for the opened parcel." };
  }
  const returnFee = target === "returned" ? amount(form, "returnFee") : null;
  const returnCharge = target === "returned" ? amount(form, "returnCharge") : null;
  if (target === "returned") {
    if (text(form, "returnFee") === "" || returnFee === null) {
      return { error: "Enter how much of the delivery cost the customer covers (0 if none)." };
    }
    if (text(form, "returnCharge") === "" || returnCharge === null) {
      return { error: "Enter what the delivery company charges for collecting the return." };
    }
  }

  // The real day of each step can be given; left alone, a step keeps the
  // date it has, and a new step is dated now.
  const { timezone } = await getPrefs();
  const days: Record<"deliveredOn" | "returnedOn" | "cancelledOn", string | null> = {
    deliveredOn: null,
    returnedOn: null,
    cancelledOn: null,
  };
  for (const [field, what, used] of [
    ["deliveredOn", "delivery date", reached],
    ["returnedOn", "return date", target === "returned"],
    ["cancelledOn", "cancellation date", target === "cancelled"],
  ] as const) {
    if (!used) continue;
    const picked = readDay(form, field, what, timezone);
    if ("error" in picked) return { error: picked.error };
    days[field] = picked.date;
  }
  if (days.deliveredOn && days.returnedOn && days.returnedOn < days.deliveredOn) {
    return { error: "The return date can't be before the delivery date." };
  }

  let log: { subject: string; from: Status; pieces: string } | null = null;
  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          status: orders.status,
          number: orders.number,
          ref: orders.trackingNumber,
          dispatchedAt: orders.dispatchedAt,
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
      if (was && was !== order.status) {
        throw new StockError(
          "Someone else changed this order a moment ago. Close this, check the order, and try again.",
        );
      }
      const name = orderName(order.ref, order.number);
      // What happened next is on the order that replaced this one.
      const swapped = await liveExchange(tx, orderId);
      if (swapped) {
        throw new StockError(
          `This order was exchanged with ${swapped}. Correct (or cancel) that order first.`,
        );
      }
      // A cancelled exchange can only come back while the order it replaces
      // is still delivered and was not exchanged again.
      if (order.exchangeOfId && order.status === "cancelled" && target !== "cancelled") {
        const [original] = await tx
          .select({ status: orders.status })
          .from(orders)
          .where(eq(orders.id, order.exchangeOfId))
          // Held still, so it can't be returned or reopened at this very moment.
          .for("update");
        const again = await liveExchange(tx, order.exchangeOfId);
        if (!original || original.status !== "delivered" || again) {
          throw new StockError(
            again
              ? `The order this one replaces was exchanged again with ${again}, so this exchange has to stay cancelled.`
              : "The order this one replaces is no longer delivered, so this exchange has to stay cancelled.",
          );
        }
      }
      if (withCompany) {
        const [company] = await tx
          .select({ id: deliveryCompanies.id })
          .from(deliveryCompanies)
          .where(eq(deliveryCompanies.id, companyId));
        if (!company) throw new StockError("That delivery company no longer exists.");
      }
      if (target === "returned") {
        const paid = Number(
          order.refundBase ??
            (order.payment === "cod" || order.exchangeOfId ? order.codAmount : order.total),
        );
        if (Number(returnFee) > paid + 0.005) {
          throw new StockError("The customer can't cover more than they paid for the order.");
        }
      }

      const items = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId))
        .for("update");
      const wasClosed = closed.includes(order.status);
      const open = target !== "cancelled" && target !== "returned";
      let takenOut = 0;
      let putBack = 0;
      if (open && (wasClosed || target !== "delivered")) {
        // The pieces are out with the order again.
        for (const item of items) {
          if (item.backState !== "stock") continue;
          try {
            await changeStock(tx, {
              variantId: item.variantId,
              change: -item.quantity,
              reason: "sale",
              note: `Order ${name}: journey corrected`,
              orderId,
              userId: user.id,
            });
          } catch (err) {
            if (!(err instanceof StockError)) throw err;
            throw new StockError(
              `Pieces of this order were put back into stock and have been sold since. ${err.message}`,
            );
          }
          takenOut += item.quantity;
        }
        await tx
          .update(orderItems)
          .set({ backState: null, backAt: null })
          .where(eq(orderItems.orderId, orderId));
      } else if (!open && sentOut && order.dispatchedAt === null) {
        // It was recorded as never sent out, so its pieces were put straight
        // back into stock; in truth the parcel left. They come out again and
        // are awaited back like any other parcel on its way home.
        for (const item of items) {
          if (item.backState !== "stock") continue;
          try {
            await changeStock(tx, {
              variantId: item.variantId,
              change: -item.quantity,
              reason: "sale",
              note: `Order ${name}: journey corrected`,
              orderId,
              userId: user.id,
            });
          } catch (err) {
            if (!(err instanceof StockError)) throw err;
            throw new StockError(
              `Pieces of this order were put back into stock and have been sold since. ${err.message}`,
            );
          }
          takenOut += item.quantity;
          await tx
            .update(orderItems)
            .set({ backState: null, backAt: null })
            .where(eq(orderItems.id, item.id));
        }
      } else if (!open && !sentOut) {
        // Cancelled before it left: the pieces never went anywhere.
        for (const item of items) {
          if (item.backState === "stock" || item.backState === "discarded") continue;
          await changeStock(tx, {
            variantId: item.variantId,
            change: item.quantity,
            reason: "cancelled",
            note: `Order ${name}: journey corrected`,
            orderId,
            userId: user.id,
          });
          await tx
            .update(orderItems)
            .set({ backState: "stock", backAt: sql`now()` })
            .where(eq(orderItems.id, item.id));
          putBack += item.quantity;
        }
      }

      // A step that already has its date keeps it; a new one is dated now.
      const kept = (column: AnyColumn) => sql`coalesce(${column}, now())`;
      // With a day given: that day (at noon, in the business's time zone),
      // unless the step already has a time on that very day.
      const dated = (column: AnyColumn, day: string | null) =>
        day === null
          ? kept(column)
          : sql`case
              when (${column} at time zone ${timezone})::date = ${day}::date then ${column}
              else ((${day}::date + time '12:00') at time zone ${timezone})
            end`;
      await tx
        .update(orders)
        .set({
          status: journeyStatus[target],
          // Cancelled before it was sent out: whether it had reached the
          // portal stays as it was recorded.
          ...(target === "cancelled" && !sentOut
            ? {}
            : { portalAt: withCompany ? kept(orders.portalAt) : null }),
          dispatchedAt: sentOut ? kept(orders.dispatchedAt) : null,
          deliveredAt: reached ? dated(orders.deliveredAt, days.deliveredOn) : null,
          ...(withCompany
            ? { deliveryCompanyId: companyId }
            : target === "new"
              ? { deliveryCompanyId: null }
              : {}),
          deliveryCharge: charge,
          returnedAt: target === "returned" ? dated(orders.returnedAt, days.returnedOn) : null,
          returnFee,
          returnCharge,
          // A refund already sent stays sent while the order stays returned.
          ...(target === "returned" && order.status === "returned" ? {} : { refundSentAt: null }),
          cancelledAt: target === "cancelled" ? dated(orders.cancelledAt, days.cancelledOn) : null,
          cancelFee,
        })
        .where(eq(orders.id, orderId));

      const count = (n: number) => `${n} ${n === 1 ? "piece" : "pieces"}`;
      log = {
        subject: `Order ${name}`,
        from: order.status,
        pieces:
          takenOut > 0
            ? `; ${count(takenOut)} taken out of stock again`
            : putBack > 0
              ? `; ${count(putBack)} put back into stock`
              : "",
      };
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  const entry = log as { subject: string; from: Status; pieces: string } | null;
  if (entry) {
    const to = journeyStatus[target];
    const numbers = [
      charge !== null ? `delivery charge ${formatMoney(charge)}` : "",
      target === "returned"
        ? `the customer covers ${formatMoney(returnFee)} of the delivery, return charge ${formatMoney(returnCharge)}`
        : "",
      target === "cancelled"
        ? sentOut
          ? opened
            ? `the parcel was sent out and opened, ${formatMoney(cancelFee)} charged`
            : "the parcel was sent out"
          : "the parcel was never sent out"
        : "",
    ]
      .filter(Boolean)
      .join(", ");
    await audit(user, {
      area: "orders",
      action: "order.corrected",
      subject: entry.subject,
      summary:
        (entry.from === to
          ? `Corrected the journey details (${statusName[to]})`
          : `Corrected the journey: ${statusName[entry.from]} → ${statusName[to]}`) +
        (numbers ? `: ${numbers}` : "") +
        entry.pieces,
      orderId,
    });
  }
  refresh();
  return { ok: "Journey corrected." };
}

// "Edit items" on the order page, for a System Admin: change what is in an
// order. Lines can be added, removed, and have their quantity and price
// changed. Stock follows: pieces added are taken out of stock, pieces removed
// go back. Not allowed once the order is closed, was exchanged, or has pieces
// that already came back, since its stock and money are settled then.
export async function editOrderItems(
  orderId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (user.role === "staff") return { error: "Only an Owner or the System Admin can change an order's items." };
  if (!isUuid(orderId)) return { error: "Order not found." };
  const lines = readLines(form);
  if (!lines) return { error: "Something is wrong with the items. Please check them." };
  if (lines.length === 0) return { error: "An order needs at least one item. Delete the order instead." };
  const codTyped = text(form, "cod");
  const codAmount = amount(form, "cod");
  if (codTyped === "" || codAmount === null) return { error: "The COD must be a number." };

  let log: { subject: string; before: string; after: string; cod: string } | null = null;
  try {
    await db.transaction(async (tx) => {
      const [order] = await tx
        .select({
          status: orders.status,
          number: orders.number,
          ref: orders.trackingNumber,
          shippingFee: orders.shippingFee,
          codAmount: orders.codAmount,
          exchangeOfId: orders.exchangeOfId,
        })
        .from(orders)
        .where(eq(orders.id, orderId))
        .for("update");
      if (!order) throw new StockError("Order not found.");
      if (closed.includes(order.status)) {
        throw new StockError(`This order is ${order.status}, so its items can't be changed.`);
      }
      const swapped = await liveExchange(tx, orderId);
      if (swapped) {
        throw new StockError(`This order was exchanged with ${swapped}, so its items can't be changed.`);
      }
      const before = await tx
        .select()
        .from(orderItems)
        .where(eq(orderItems.orderId, orderId))
        .for("update");
      if (before.some((item) => item.backState !== null)) {
        throw new StockError("Pieces of this order have already been settled, so its items can't be changed.");
      }

      // How many of each item the order takes now, against what it took.
      const had = new Map<string, number>();
      for (const item of before) had.set(item.variantId, (had.get(item.variantId) ?? 0) + item.quantity);
      const wants = new Map<string, number>();
      for (const line of lines) wants.set(line.variantId, (wants.get(line.variantId) ?? 0) + line.quantity);
      const touched = [...new Set([...had.keys(), ...wants.keys()])];
      const found = await tx
        .select({
          id: variants.id,
          size: variants.size,
          color: variants.color,
          stock: variants.stock,
          cost: variants.cost,
          name: products.name,
        })
        .from(variants)
        .innerJoin(products, eq(products.id, variants.productId))
        .where(inArray(variants.id, touched))
        // Always in the same order, so two changes can't wait on each other.
        .orderBy(variants.id)
        .for("update", { of: variants });
      if (found.length !== touched.length) throw new StockError("One of the items no longer exists.");
      const name = orderName(order.ref, order.number);
      for (const item of found) {
        const more = (wants.get(item.id) ?? 0) - (had.get(item.id) ?? 0);
        if (more > item.stock) {
          throw new StockError(
            `Only ${item.stock} more of ${item.name} · ${variantLabel(item)} in stock, so ${more} more can't be added.`,
          );
        }
        // Counted as part of the sale either way, so "units sold" stays right.
        await changeStock(tx, {
          variantId: item.id,
          change: -more,
          reason: "sale",
          note: `Order ${name} edited`,
          orderId,
          userId: user.id,
        });
      }

      await tx.delete(orderItems).where(eq(orderItems.orderId, orderId));
      // A piece that was already on the order keeps the cost it had then; a
      // newly added one takes today's.
      const costWas = new Map(before.map((item) => [item.variantId, item.unitCost]));
      const costNow = new Map(found.map((item) => [item.id, item.cost]));
      await tx.insert(orderItems).values(
        lines.map((line) => ({
          ...line,
          orderId,
          unitCost: costWas.has(line.variantId)
            ? costWas.get(line.variantId)
            : Number(costNow.get(line.variantId)) > 0
              ? costNow.get(line.variantId)
              : null,
        })),
      );
      const subtotal = lines.reduce((sum, line) => sum + lineTotal(line), 0);
      await tx
        .update(orders)
        .set({
          total: (subtotal + Number(order.shippingFee)).toFixed(2),
          codAmount,
          payment: Number(codAmount) > 0 || order.exchangeOfId ? "cod" : "prepaid",
        })
        .where(eq(orders.id, orderId));

      // In the order the lines were on the order, not the order the database
      // happened to return them.
      const byId = new Map(found.map((item) => [item.id, item]));
      const said = (list: Map<string, number>) =>
        [...list]
          .filter(([, quantity]) => quantity > 0)
          .map(([id, quantity]) => {
            const item = byId.get(id);
            return `${quantity} ${[item?.size, item?.color].filter(Boolean).join(" ")}`;
          })
          .join(", ");
      log = {
        subject: `Order ${name}`,
        before: said(had),
        after: said(wants),
        cod:
          Number(order.codAmount) === Number(codAmount)
            ? ""
            : `; COD ${formatMoney(order.codAmount)} → ${formatMoney(codAmount)}`,
      };
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  const entry = log as { subject: string; before: string; after: string; cod: string } | null;
  if (entry) {
    await audit(user, {
      area: "orders",
      action: "order.items",
      subject: entry.subject,
      summary: `Changed the items from "${entry.before}" to "${entry.after}"${entry.cod}`,
      orderId,
    });
  }
  refresh();
  return { ok: "Items saved." };
}
