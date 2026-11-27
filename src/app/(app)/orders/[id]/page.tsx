import { asc, eq, sql } from "drizzle-orm";
import {
  ArrowLeft,
  ArrowLeftRight,
  Ban,
  Check,
  Clock,
  NotebookPen,
  Package,
  ReceiptText,
  Repeat,
  Undo2,
  UserRound,
  Wallet,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, orderStatusLabel, orderStatusTone } from "@/components/ui";
import { db } from "@/db";
import {
  customers,
  deliveryCompanies,
  orderItems,
  orders,
  productMedia,
  products,
  variants,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { colorDot } from "@/lib/colors";
import { formatDateTime, formatMoney, isUuid, orderName } from "@/lib/format";
import { getPrefs } from "@/lib/settings";
import { saveOrderNote } from "../actions";
import type { OrderCard } from "../order-actions";
import { type BackItem, EditOrder, ItemsBack, OutcomeActions, RefundSent } from "./order-parts";

// Everything about the lines of an order that this page shows.
function itemsOf(orderId: string) {
  return db
    .select({
      id: orderItems.id,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      discount: orderItems.discount,
      backState: orderItems.backState,
      backAt: orderItems.backAt,
      name: products.name,
      productId: products.id,
      sku: variants.sku,
      size: variants.size,
      color: variants.color,
      photo: sql<string | null>`(
        select coalesce(${productMedia.thumbUrl}, ${productMedia.url}) from ${productMedia}
        where ${productMedia.productId} = ${products.id}
          and (${productMedia.kind} = 'image' or ${productMedia.thumbUrl} is not null)
        order by (${productMedia.tag} = 'Main photo') desc,
          (${productMedia.kind} = 'image') desc, ${productMedia.createdAt}
        limit 1
      )`,
    })
    .from(orderItems)
    .innerJoin(variants, eq(variants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(orderItems.orderId, orderId))
    .orderBy(asc(products.name), asc(variants.createdAt));
}

const dayIn = (date: Date, timezone: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [row] = await db
    .select({ order: orders, customer: customers, company: deliveryCompanies })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(deliveryCompanies, eq(deliveryCompanies.id, orders.deliveryCompanyId))
    .where(eq(orders.id, id));
  if (!row) notFound();
  const { order, customer, company } = row;

  const [{ currency, timezone }, items, companies, [replaces], replacedBy] =
    await Promise.all([
      getPrefs(),
      itemsOf(id),
      db.select().from(deliveryCompanies).orderBy(asc(deliveryCompanies.name)),
      // The order this one replaces, and any orders made to replace this one.
      order.exchangeOfId
        ? db
            .select({ id: orders.id, number: orders.number, ref: orders.trackingNumber })
            .from(orders)
            .where(eq(orders.id, order.exchangeOfId))
        : Promise.resolve([]),
      db
        .select({
          id: orders.id,
          number: orders.number,
          ref: orders.trackingNumber,
          createdAt: orders.createdAt,
        })
        .from(orders)
        .where(eq(orders.exchangeOfId, order.id)),
    ]);
  // On an exchange: the pieces of the first order, which come back.
  const oldItems = replaces ? await itemsOf(replaces.id) : [];

  const name = orderName(order.trackingNumber, order.number);
  const money = (value: string | number | null) => formatMoney(value, currency);
  const when = (date: Date | null) => (date ? formatDateTime(date, timezone) : null);
  const what = (item: { quantity: number; size: string | null; color: string | null }) =>
    [item.size, item.color].filter(Boolean).join(" ");

  /* ---------- Money ---------- */

  const pieces = items.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = items.reduce((sum, item) => sum + item.quantity * Number(item.unitPrice), 0);
  const delivery = Number(order.shippingFee);
  const cod = Number(order.codAmount);
  const prepaid = order.payment !== "cod";
  // What came off the listed prices to arrive at the COD.
  const discount = prepaid ? 0 : subtotal + delivery - cod;
  // What the customer paid for the order: its COD, or its value when it was
  // paid beforehand.
  const paid = prepaid ? Number(order.total) : cod;

  // The delivery company's side: what it collected and what it keeps.
  const wasDelivered =
    order.deliveredAt !== null && (order.status === "delivered" || order.status === "returned");
  const payoutLines: { label: string; value: number }[] = [];
  if (wasDelivered) {
    payoutLines.push({ label: "COD collected", value: cod });
    payoutLines.push({ label: "Delivery charge", value: -Number(order.deliveryCharge ?? 0) });
  }
  if (order.status === "returned") {
    payoutLines.push({ label: "Return charge", value: -Number(order.returnCharge ?? 0) });
  }
  if (order.status === "cancelled" && order.cancelFee !== null) {
    payoutLines.push({ label: "Opened-parcel charge", value: -Number(order.cancelFee) });
  }
  const payout = payoutLines.reduce((sum, line) => sum + line.value, 0);

  // A return: the customer gets back what they paid, less the part of the
  // delivery cost they cover. The order then ends as a loss of both delivery
  // trips, less what the customer covered.
  const isReturn = order.status === "returned" && wasDelivered;
  const covered = Number(order.returnFee ?? 0);
  const refund = Math.max(paid - covered, 0);
  const firstTrip = Number(order.deliveryCharge ?? 0);
  const tripBack = Number(order.returnCharge ?? 0);
  const result = -firstTrip - tripBack + (paid - refund);

  /* ---------- Steps ---------- */

  const stage: OrderCard["stage"] =
    order.status === "new"
      ? "new"
      : order.status === "confirmed" || order.status === "packed"
        ? "portal"
        : order.status === "shipped"
          ? "dispatched"
          : order.status === "delivered"
            ? "delivered"
            : "closed";
  const card: OrderCard = {
    id: order.id,
    number: order.number,
    name,
    customer: customer.name,
    phone: customer.phone,
    stage,
    place: [order.city, order.area].filter(Boolean).join(" · "),
    contents: items.map((item) => `${item.quantity} ${what(item)}`).join(", "),
    cod: prepaid ? "Paid" : money(cod),
    paid,
    exchange: order.exchangeOfId !== null,
    company: company?.name ?? null,
    companyId: order.deliveryCompanyId,
    portalAt: when(order.portalAt),
    dispatchedAt: when(order.dispatchedAt),
    deliveredAt: when(order.deliveredAt),
    deliveryCharge: order.deliveryCharge === null ? null : Number(order.deliveryCharge),
  };

  // The last stop on the road: how the order ended, if it has.
  const ending =
    order.status === "returned"
      ? { label: "Returned", note: when(order.returnedAt) ?? "", tone: "rose" as const, icon: Undo2 }
      : order.status === "cancelled"
        ? { label: "Cancelled", note: when(order.cancelledAt) ?? "", tone: "rose" as const, icon: Ban }
        : replacedBy.length > 0
          ? {
              label: "Exchanged",
              note: `with ${replacedBy.map((next) => orderName(next.ref, next.number)).join(", ")}`,
              tone: "brand" as const,
              icon: Repeat,
            }
          : { label: "Return / Exchange", note: "Not initiated", tone: null, icon: ArrowLeftRight };
  const road = [
    { label: "Created in delivery system", at: order.portalAt },
    { label: "Dispatched", at: order.dispatchedAt },
    { label: "Delivered", at: order.deliveredAt },
  ];

  /* ---------- Pieces coming back ---------- */

  const asBack = (list: typeof items): BackItem[] =>
    list.map((item) => ({
      id: item.id,
      label: `${item.name} · ${what(item)}`,
      sku: item.sku,
      quantity: item.quantity,
      state: (item.backState as BackItem["state"]) ?? null,
      when: when(item.backAt),
    }));
  // This order's own pieces come back when it was returned, refused after it
  // was sent out, or exchanged for another order.
  const ownComeBack =
    order.status === "returned" ||
    (order.status === "cancelled" && order.dispatchedAt !== null) ||
    replacedBy.length > 0;

  /* ---------- What happened, in order ---------- */

  const events = [
    { label: "Order taken", at: order.createdAt },
    ...road.filter((step) => step.at !== null).map((step) => ({ label: step.label, at: step.at! })),
    ...(order.returnedAt ? [{ label: "Return created", at: order.returnedAt }] : []),
    ...(order.cancelledAt ? [{ label: "Cancelled", at: order.cancelledAt }] : []),
    ...replacedBy.map((next) => ({
      label: `Exchange created: ${orderName(next.ref, next.number)}`,
      at: next.createdAt,
    })),
    ...items
      .filter((item) => item.backAt && item.backState && item.backState !== "none")
      .map((item) => ({
        label: `${item.quantity} × ${what(item)} ${item.backState === "stock" ? "received back into stock" : "received and discarded"}`,
        at: item.backAt!,
      })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());

  const cardHead = "flex items-center gap-2.5 px-4 pt-4 pb-3";
  const detail = "grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 py-1.5 text-sm";

  return (
    <div className="space-y-4" data-order-page>
      {/* ---------- Title ---------- */}
      <div className="flex items-start gap-3">
        <Link
          href="/orders"
          aria-label="Back to orders"
          className="card mt-1 flex size-10 shrink-0 items-center justify-center text-stone-700 hover:text-brand"
        >
          <ArrowLeft className="size-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="flex flex-wrap items-center gap-3 text-2xl leading-tight font-extrabold tracking-tight">
            Order {name}
            <Badge tone={orderStatusTone[order.status]}>{orderStatusLabel[order.status]}</Badge>
            {replaces && (
              <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-bold text-violet-700">
                Exchange
              </span>
            )}
          </h1>
          <p className="flex items-center text-sm text-stone-500">
            {formatDateTime(order.createdAt, timezone)}
            <EditOrder
              orderId={order.id}
              name={name}
              date={dayIn(order.createdAt, timezone)}
            />
          </p>
        </div>
      </div>

      {replaces && (
        <p
          data-order-exchange
          className="card flex flex-wrap items-center gap-2 border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900"
        >
          <Repeat className="size-4 shrink-0" />
          This order is an exchange for{" "}
          <Link href={`/orders/${replaces.id}`} className="font-semibold underline">
            Order {orderName(replaces.ref, replaces.number)}
          </Link>
          . The customer pays the delivery charge as its COD; that stays with the delivery company.
        </p>
      )}
      {replacedBy.length > 0 && (
        <p
          data-order-exchange
          className="card flex flex-wrap items-center gap-2 border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900"
        >
          <Repeat className="size-4 shrink-0" />
          Exchanged with{" "}
          {replacedBy.map((next) => (
            <Link key={next.id} href={`/orders/${next.id}`} className="font-semibold underline">
              Order {orderName(next.ref, next.number)}
            </Link>
          ))}
        </p>
      )}

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_23rem]">
        <div className="min-w-0 space-y-4">
          {/* ---------- The road ---------- */}
          <section className="card px-2 py-5" data-order-road>
            <ol className="grid grid-cols-4">
              {road.map((step, index) => {
                const done = step.at !== null;
                const nextDone = index < 2 ? road[index + 1].at !== null : ending.tone !== null;
                return (
                  <li key={step.label} className="relative px-1 text-center" data-step={done ? "done" : "todo"}>
                    <span
                      className={
                        "absolute top-4 left-1/2 h-0.5 w-full " +
                        (nextDone ? "bg-brand" : "border-t-2 border-dashed border-stone-300")
                      }
                    />
                    <span
                      className={
                        "relative mx-auto flex size-9 items-center justify-center rounded-full " +
                        (done
                          ? "bg-brand text-white"
                          : "border-2 border-stone-300 bg-white text-stone-400")
                      }
                    >
                      <Check className="size-4" strokeWidth={3} />
                    </span>
                    <span
                      className={
                        "mt-2 block text-sm leading-tight font-bold " +
                        (done ? "" : "text-stone-500")
                      }
                    >
                      {step.label}
                    </span>
                    <span className="mt-0.5 block text-xs text-stone-500">
                      {when(step.at) ?? "Not yet"}
                    </span>
                  </li>
                );
              })}
              <li className="relative px-1 text-center" data-step={ending.tone ? "done" : "todo"}>
                <span
                  className={
                    "relative mx-auto flex size-9 items-center justify-center rounded-full " +
                    (ending.tone === "rose"
                      ? "bg-rose-600 text-white"
                      : ending.tone === "brand"
                        ? "bg-brand text-white"
                        : "border-2 border-stone-300 bg-white text-stone-400")
                  }
                >
                  <ending.icon className="size-4" />
                </span>
                <span
                  className={
                    "mt-2 block text-sm leading-tight font-bold " +
                    (ending.tone ? "" : "text-stone-500")
                  }
                >
                  {ending.label}
                </span>
                <span className="mt-0.5 block text-xs text-stone-500">{ending.note}</span>
              </li>
            </ol>
          </section>

          {/* ---------- Items ---------- */}
          <section className="card" data-order-items>
            <header className={cardHead}>
              <Package className="size-5 text-brand" />
              <h2 className="text-base font-bold">Order Items ({pieces})</h2>
            </header>
            <div className="overflow-x-auto px-4 pb-4">
              <table className="w-full min-w-[34rem] text-sm tabular-nums">
                <thead>
                  <tr>
                    <th className="th rounded-l-lg">Product</th>
                    <th className="th">Color</th>
                    <th className="th">Size</th>
                    <th className="th text-center">Qty</th>
                    <th className="th text-right">Unit Price</th>
                    <th className="th rounded-r-lg text-right">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="td">
                        <span className="flex items-center gap-3">
                          <span className="size-11 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
                            {item.photo && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={item.photo} alt="" className="size-full object-cover" />
                            )}
                          </span>
                          <span className="min-w-0">
                            <Link
                              href={`/inventory/${item.productId}`}
                              className="block font-semibold hover:text-brand hover:underline"
                            >
                              {item.name}
                            </Link>
                            <span className="block text-xs text-stone-500">{item.sku}</span>
                          </span>
                        </span>
                      </td>
                      <td className="td whitespace-nowrap">
                        <span className="flex items-center gap-2">
                          <span
                            className="size-3.5 shrink-0 rounded-full border border-stone-300"
                            style={{ backgroundColor: colorDot(item.color) }}
                          />
                          {item.color ?? "—"}
                        </span>
                      </td>
                      <td className="td">{item.size ?? "—"}</td>
                      <td className="td text-center">{item.quantity}</td>
                      <td className="td text-right">{money(item.unitPrice)}</td>
                      <td className="td text-right font-bold">
                        {money(item.quantity * Number(item.unitPrice))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {ownComeBack && (
            <ItemsBack
              title="Items coming back"
              subtitle="Mark each piece once it is back in your hands. Stock only changes then."
              items={asBack(items)}
            />
          )}
          {replaces && oldItems.length > 0 && (
            <ItemsBack
              title={`Old items from Order ${orderName(replaces.ref, replaces.number)}`}
              subtitle="The pieces the customer hands back to the driver. Mark each one once it reaches you."
              items={asBack(oldItems)}
            />
          )}

          <div className="grid items-start gap-4 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            {/* ---------- Timeline ---------- */}
            <section className="card" data-order-timeline>
              <header className={cardHead}>
                <Clock className="size-5 text-brand" />
                <h2 className="text-base font-bold">Activity Timeline</h2>
              </header>
              <ol className="px-4 pb-4">
                {events.map((event, index) => (
                  <li key={index} className="relative flex gap-3 pb-4 last:pb-0">
                    {index < events.length - 1 && (
                      <span className="absolute top-5 left-[9px] h-full w-0.5 bg-brand-200" />
                    )}
                    <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-brand text-white">
                      <Check className="size-3" strokeWidth={3.5} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm leading-tight font-bold">{event.label}</span>
                      <span className="block text-xs text-stone-500">
                        {formatDateTime(event.at, timezone)}
                      </span>
                    </span>
                  </li>
                ))}
              </ol>
            </section>

            {/* ---------- Notes ---------- */}
            <section className="card" data-order-notes>
              <header className={cardHead}>
                <NotebookPen className="size-5 text-brand" />
                <h2 className="text-base font-bold">Update Order / Notes</h2>
              </header>
              <ActionForm
                action={saveOrderNote.bind(null, order.id)}
                submit="Save Note"
                className="space-y-3 px-4 pb-4"
                submitClassName="btn-secondary border-brand-200 bg-brand-100 text-brand"
              >
                <textarea
                  name="notes"
                  rows={3}
                  defaultValue={order.notes ?? ""}
                  aria-label="Note"
                  placeholder="Add a note, update, or internal remark…"
                  className="input resize-y"
                />
              </ActionForm>
            </section>
          </div>
        </div>

        <div className="min-w-0 space-y-4">
          <OutcomeActions
            order={card}
            currency={currency}
            companies={companies
              .filter((option) => option.active || option.id === order.deliveryCompanyId)
              .map((option) => ({
                id: option.id,
                name: option.name,
                rate: Number(option.rate),
                openedFee: Number(option.openedFee),
              }))}
          />

          {/* ---------- Customer ---------- */}
          <section className="card" data-order-side>
            <header className={cardHead}>
              <UserRound className="size-5 text-brand" />
              <h2 className="text-base font-bold">Customer &amp; Shipping Details</h2>
            </header>
            <dl className="px-4 pb-4">
              <div className={detail}>
                <dt className="text-stone-500">Receiver</dt>
                <dd className="font-bold">{customer.name}</dd>
              </div>
              <div className={detail}>
                <dt className="text-stone-500">Mobile</dt>
                <dd>
                  {customer.phone ?? "—"}
                  {order.phone2 && <span className="block text-stone-600">{order.phone2}</span>}
                </dd>
              </div>
              <div className={detail}>
                <dt className="text-stone-500">Address</dt>
                <dd>
                  {[order.street, order.area, order.city, order.country]
                    .filter(Boolean)
                    .join(", ") ||
                    order.shippingAddress ||
                    "—"}
                </dd>
              </div>
              <div className={detail}>
                <dt className="text-stone-500">Shipper Ref</dt>
                <dd>{order.trackingNumber ?? "—"}</dd>
              </div>
              <div className={detail}>
                <dt className="text-stone-500">COD</dt>
                <dd>{prepaid ? "Already paid — nothing to collect" : money(cod)}</dd>
              </div>
              {order.instruction && (
                <div className={detail}>
                  <dt className="text-stone-500">Instruction</dt>
                  <dd>{order.instruction}</dd>
                </div>
              )}
              {company && (
                <div className={detail}>
                  <dt className="text-stone-500">Delivery by</dt>
                  <dd>{company.name}</dd>
                </div>
              )}
            </dl>
          </section>

          {/* ---------- Summary ---------- */}
          <section className="card" data-order-summary>
            <header className={cardHead}>
              <ReceiptText className="size-5 text-brand" />
              <h2 className="text-base font-bold">Order Summary</h2>
            </header>
            <dl className="px-4 pb-4 text-sm tabular-nums">
              <div className="flex justify-between border-b border-stone-100 py-2">
                <dt>
                  Subtotal ({pieces} {pieces === 1 ? "item" : "items"})
                </dt>
                <dd>{money(subtotal)}</dd>
              </div>
              <div className="flex justify-between border-b border-stone-100 py-2">
                <dt>Delivery</dt>
                <dd>{money(delivery)}</dd>
              </div>
              {prepaid ? (
                <div className="flex justify-between py-2">
                  <dt>Paid before delivery</dt>
                  <dd className="font-semibold text-emerald-700">− {money(subtotal + delivery)}</dd>
                </div>
              ) : discount > 0.004 ? (
                <div className="flex justify-between py-2">
                  <dt>Discount</dt>
                  <dd className="font-semibold text-emerald-700">− {money(discount)}</dd>
                </div>
              ) : discount < -0.004 ? (
                <div className="flex justify-between py-2">
                  <dt>Extra</dt>
                  <dd className="font-semibold">+ {money(-discount)}</dd>
                </div>
              ) : null}
              <div className="mt-1 flex items-center justify-between rounded-lg bg-brand-100 px-3 py-2.5 text-base font-extrabold text-brand-700">
                <dt>Total (COD)</dt>
                <dd>{money(cod)}</dd>
              </div>
            </dl>
          </section>

          {/* ---------- Payout ---------- */}
          {payoutLines.length > 0 && (
            <section className="card" data-order-payout>
              <header className={cardHead}>
                <Wallet className="size-5 text-brand" />
                <div>
                  <h2 className="text-base font-bold">Delivery Company Payout</h2>
                  <p className="text-xs text-stone-600">
                    {company?.name ?? "The delivery company"} collects the money and keeps its
                    charges.
                  </p>
                </div>
              </header>
              <dl className="px-4 pb-4 text-sm tabular-nums">
                {payoutLines.map((line) => (
                  <div key={line.label} className="flex justify-between border-b border-stone-100 py-2">
                    <dt>{line.label}</dt>
                    <dd>
                      {line.value < 0 ? "− " : ""}
                      {money(Math.abs(line.value))}
                    </dd>
                  </div>
                ))}
                <div
                  className={
                    "mt-1 flex items-center justify-between rounded-lg px-3 py-2.5 text-base font-extrabold " +
                    (payout < -0.004
                      ? "bg-rose-100 text-rose-700"
                      : "bg-emerald-100 text-emerald-700")
                  }
                >
                  <dt>{payout < -0.004 ? "Comes off your payout" : "You receive"}</dt>
                  <dd>{money(Math.abs(payout))}</dd>
                </div>
              </dl>
            </section>
          )}

          {/* ---------- Return: the refund and what it cost ---------- */}
          {isReturn && (
            <section className="card" data-order-return>
              <header className={cardHead}>
                <Undo2 className="size-5 text-brand" />
                <div>
                  <h2 className="text-base font-bold">Return Settlement</h2>
                  <p className="text-xs text-stone-600">
                    What goes back to the customer, and what this return cost you.
                  </p>
                </div>
              </header>
              <dl className="px-4 pb-4 text-sm tabular-nums">
                <p className="pb-1 text-xs font-bold text-stone-500 uppercase">Customer refund</p>
                <div className="flex justify-between border-b border-stone-100 py-2">
                  <dt>Customer paid</dt>
                  <dd>{money(paid)}</dd>
                </div>
                <div className="flex justify-between border-b border-stone-100 py-2">
                  <dt>
                    Delivery cost they cover
                    <span className="block text-xs text-stone-500">
                      {tripBack - covered > 0.004
                        ? `of the ${money(tripBack)} return charge; you pay the other ${money(tripBack - covered)}`
                        : `the whole ${money(tripBack)} return charge`}
                    </span>
                  </dt>
                  <dd className="shrink-0 pl-3 whitespace-nowrap">− {money(covered)}</dd>
                </div>
                <div className="mt-1 rounded-lg bg-brand-100 px-3 py-2.5 text-brand-700">
                  <div className="flex items-center justify-between text-base font-extrabold">
                    <dt>Refund by bank transfer</dt>
                    <dd data-refund>{money(refund)}</dd>
                  </div>
                  <RefundSent
                    orderId={order.id}
                    sentAt={when(order.refundSentAt)}
                    amount={money(refund)}
                  />
                </div>

                <p className="pt-4 pb-1 text-xs font-bold text-stone-500 uppercase">
                  What this order came to
                </p>
                <div className="flex justify-between border-b border-stone-100 py-2">
                  <dt>Delivery charge (to the customer)</dt>
                  <dd>− {money(firstTrip)}</dd>
                </div>
                <div className="flex justify-between border-b border-stone-100 py-2">
                  <dt>Return charge (back to you)</dt>
                  <dd>− {money(tripBack)}</dd>
                </div>
                <div className="flex justify-between border-b border-stone-100 py-2">
                  <dt>Covered by the customer</dt>
                  <dd>+ {money(paid - refund)}</dd>
                </div>
                <div
                  data-order-result
                  className={
                    "mt-1 flex items-center justify-between rounded-lg px-3 py-2.5 text-base font-extrabold " +
                    (result < -0.004 ? "bg-rose-100 text-rose-700" : "bg-emerald-100 text-emerald-700")
                  }
                >
                  <dt>{result < -0.004 ? "Loss on this order" : "Result of this order"}</dt>
                  <dd>{money(Math.abs(result))}</dd>
                </div>
                <p className="mt-2 text-xs text-stone-500">
                  This is the figure Reports counts for this order.
                </p>
              </dl>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
