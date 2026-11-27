import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, orderStatusLabel, orderStatusTone } from "@/components/ui";
import { db } from "@/db";
import {
  customers,
  deliveryCompanies,
  orderItems,
  orders,
  products,
  variants,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatMoney, isUuid, orderName, variantLabel } from "@/lib/format";
import { getPrefs } from "@/lib/settings";
import { updateOrder } from "../actions";

const statusLabel = {
  new: "New",
  confirmed: "In delivery portal",
  packed: "Packed",
  shipped: "Dispatched",
  delivered: "Delivered",
  cancelled: "Cancelled (puts stock back)",
  returned: "Returned (puts stock back)",
} as const;

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [row] = await db
    .select({ order: orders, customer: customers, company: deliveryCompanies.name })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .leftJoin(deliveryCompanies, eq(deliveryCompanies.id, orders.deliveryCompanyId))
    .where(eq(orders.id, id));
  if (!row) notFound();
  const { order, customer, company } = row;

  const { currency, timezone } = await getPrefs();
  const items = await db
    .select({
      id: orderItems.id,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
      discount: orderItems.discount,
      name: products.name,
      productId: products.id,
      sku: variants.sku,
      size: variants.size,
      color: variants.color,
    })
    .from(orderItems)
    .innerJoin(variants, eq(variants.id, orderItems.variantId))
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(orderItems.orderId, id));

  const subtotal = items.reduce(
    (sum, item) => sum + item.quantity * Number(item.unitPrice) - Number(item.discount),
    0,
  );
  const closed = order.status === "cancelled" || order.status === "returned";
  // The order this one replaces, and any orders made to replace this one.
  const [[replaces], replacedBy] = await Promise.all([
    order.exchangeOfId
      ? db
          .select({ id: orders.id, number: orders.number, ref: orders.trackingNumber })
          .from(orders)
          .where(eq(orders.id, order.exchangeOfId))
      : Promise.resolve([]),
    db
      .select({ id: orders.id, number: orders.number, ref: orders.trackingNumber })
      .from(orders)
      .where(eq(orders.exchangeOfId, order.id)),
  ]);

  return (
    <div className="space-y-3">
      <div>
        <Link href="/orders" className="text-sm text-stone-500 hover:underline">
          ← Orders
        </Link>
        <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold tracking-tight">
          Order {orderName(order.trackingNumber, order.number)}
          <Badge tone={orderStatusTone[order.status]}>{orderStatusLabel[order.status]}</Badge>
        </h1>
        <p className="text-sm text-stone-500">{formatDateTime(order.createdAt, timezone)}</p>
      </div>

      <div className="grid gap-3 lg:grid-cols-[1fr_20rem]">
        <div className="space-y-3">
          <section className="card">
            <table className="w-full">
              <thead className="border-b border-stone-200">
                <tr>
                  <th className="th">Item</th>
                  <th className="th text-right">Qty</th>
                  <th className="th text-right">Price</th>
                  <th className="th text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {items.map((item) => (
                  <tr key={item.id}>
                    <td className="td">
                      <Link
                        href={`/inventory/${item.productId}`}
                        className="font-medium hover:underline"
                      >
                        {item.name}
                      </Link>
                      <span className="block text-xs text-stone-500">
                        {variantLabel(item)} · {item.sku}
                      </span>
                    </td>
                    <td className="td text-right tabular-nums">{item.quantity}</td>
                    <td className="td text-right tabular-nums">
                      {formatMoney(item.unitPrice, currency)}
                    </td>
                    <td className="td text-right tabular-nums">
                      {formatMoney(
                        item.quantity * Number(item.unitPrice) - Number(item.discount),
                        currency,
                      )}
                      {Number(item.discount) > 0 && (
                        <span className="block text-xs text-stone-500">
                          multi-piece price, {formatMoney(item.discount, currency)} off
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="space-y-1 border-t border-stone-200 px-3 py-1.5 text-sm">
              <Line label="Items" value={formatMoney(subtotal, currency)} />
              {Number(order.shippingFee) > 0 && (
                <Line label="Delivery" value={formatMoney(order.shippingFee, currency)} />
              )}
              <Line
                label="COD (to collect on delivery)"
                value={formatMoney(order.codAmount, currency)}
                bold
              />
            </dl>
          </section>

          <ActionForm
            action={updateOrder.bind(null, order.id)}
            submit="Save"
            className="card space-y-3 p-3"
          >
            <h2 className="text-sm font-bold text-stone-900">Update order</h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Status">
                <select
                  name="status"
                  defaultValue={order.status}
                  disabled={closed}
                  className="input"
                >
                  {orders.status.enumValues.map((status) => (
                    <option key={status} value={status}>
                      {statusLabel[status]}
                    </option>
                  ))}
                </select>
                {closed && <input type="hidden" name="status" value={order.status} />}
              </Field>
              <Field label="Order date">
                <input
                  type="date"
                  name="orderDate"
                  defaultValue={new Intl.DateTimeFormat("en-CA", {
                    timeZone: timezone,
                    year: "numeric",
                    month: "2-digit",
                    day: "2-digit",
                  }).format(order.createdAt)}
                  className="input"
                />
              </Field>
              <Field label="Shipper Ref">
                <input
                  name="trackingNumber"
                  defaultValue={order.trackingNumber ?? ""}
                  className="input"
                />
              </Field>
            </div>
            <Field label="Description">
              <textarea name="notes" rows={2} defaultValue={order.notes ?? ""} className="input" />
            </Field>
          </ActionForm>
        </div>

        <aside data-order-side className="card h-fit space-y-2 p-3 text-sm">
          <h2 className="text-sm font-bold text-stone-900">Customer &amp; Shipping</h2>
          <div>
            <p className="label">Receiver</p>
            <p className="font-semibold">{customer.name}</p>
          </div>
          <div>
            <p className="label">Mobile</p>
            <p>{customer.phone ?? "—"}</p>
            {order.phone2 && <p className="text-stone-600">{order.phone2} (second)</p>}
          </div>
          <div>
            <p className="label">Deliver to</p>
            {order.city || order.area || order.street ? (
              <p>
                {order.street && <span className="block">{order.street}</span>}
                <span className="block">{[order.area, order.city].filter(Boolean).join(", ")}</span>
                {order.country && <span className="block">{order.country}</span>}
              </p>
            ) : (
              <p>{order.shippingAddress ?? "No address given"}</p>
            )}
          </div>
          <div>
            <p className="label">COD</p>
            <p>
              {order.payment === "cod"
                ? `Collect ${formatMoney(order.codAmount, currency)} on delivery`
                : "Already paid — nothing to collect"}
            </p>
          </div>
          {order.trackingNumber && (
            <div>
              <p className="label">Shipper Ref</p>
              <p>{order.trackingNumber}</p>
            </div>
          )}
          {(replaces || replacedBy.length > 0) && (
            <div data-order-exchange>
              <p className="label">Exchange</p>
              {replaces && (
                <p>
                  This order is an exchange for{" "}
                  <Link href={`/orders/${replaces.id}`} className="font-semibold text-brand underline">
                    Order {orderName(replaces.ref, replaces.number)}
                  </Link>
                </p>
              )}
              {replacedBy.map((next) => (
                <p key={next.id}>
                  Exchanged with{" "}
                  <Link href={`/orders/${next.id}`} className="font-semibold text-brand underline">
                    Order {orderName(next.ref, next.number)}
                  </Link>
                </p>
              ))}
            </div>
          )}
          {order.status === "returned" && (
            <div data-order-return>
              <p className="label">Return</p>
              {order.returnedAt && (
                <p className="text-stone-600">
                  Returned: {formatDateTime(order.returnedAt, timezone)}
                </p>
              )}
              <p>
                {order.returnFee === null
                  ? "Customer is not covering the delivery cost"
                  : `Customer pays ${formatMoney(order.returnFee, currency)} of the delivery cost`}
              </p>
            </div>
          )}
          {(order.portalAt || company) && (
            <div data-order-delivery>
              <p className="label">Delivery</p>
              {company && <p className="font-semibold">{company}</p>}
              {order.portalAt && (
                <p className="text-stone-600">
                  In portal: {formatDateTime(order.portalAt, timezone)}
                </p>
              )}
              {order.dispatchedAt && (
                <p className="text-stone-600">
                  Dispatched: {formatDateTime(order.dispatchedAt, timezone)}
                </p>
              )}
              {order.deliveredAt && (
                <p className="text-stone-600">
                  Delivered: {formatDateTime(order.deliveredAt, timezone)}
                </p>
              )}
              {order.deliveryCharge !== null && (
                <>
                  <p>Delivery charge: {formatMoney(order.deliveryCharge, currency)}</p>
                  {order.status === "delivered" && (
                    <p className="font-semibold">
                      You receive:{" "}
                      {formatMoney(
                        Number(order.codAmount) - Number(order.deliveryCharge),
                        currency,
                      )}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
          {order.instruction && (
            <div>
              <p className="label">Instruction</p>
              <p>{order.instruction}</p>
            </div>
          )}
          {order.source && (
            <div>
              <p className="label">Came from</p>
              <p>{order.source}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function Line({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={"flex justify-between " + (bold ? "pt-1 font-semibold" : "text-stone-600")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
