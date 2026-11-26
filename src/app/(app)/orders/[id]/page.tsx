import { eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, orderStatusTone } from "@/components/ui";
import { db } from "@/db";
import { customers, orderItems, orders, products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatMoney, isUuid, variantLabel } from "@/lib/format";
import { getPrefs } from "@/lib/settings";
import { updateOrder } from "../actions";

const statusLabel = {
  new: "New",
  confirmed: "Confirmed",
  packed: "Packed",
  shipped: "Shipped",
  delivered: "Delivered",
  cancelled: "Cancelled (puts stock back)",
  returned: "Returned (puts stock back)",
} as const;

export default async function OrderPage({ params }: PageProps<"/orders/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [row] = await db
    .select({ order: orders, customer: customers })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(eq(orders.id, id));
  if (!row) notFound();
  const { order, customer } = row;

  const { currency, timezone } = await getPrefs();
  const items = await db
    .select({
      id: orderItems.id,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice,
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
    (sum, item) => sum + item.quantity * Number(item.unitPrice),
    0,
  );
  const closed = order.status === "cancelled" || order.status === "returned";

  return (
    <div className="space-y-3">
      <div>
        <Link href="/orders" className="text-sm text-stone-500 hover:underline">
          ← Orders
        </Link>
        <h1 className="mt-1 flex items-center gap-3 text-xl font-semibold tracking-tight">
          Order #{order.number}
          <Badge tone={orderStatusTone[order.status]}>{order.status}</Badge>
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
                      {formatMoney(item.quantity * Number(item.unitPrice), currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <dl className="space-y-1 border-t border-stone-200 px-3 py-1.5 text-sm">
              <Line label="Subtotal" value={formatMoney(subtotal, currency)} />
              <Line label="Delivery" value={formatMoney(order.shippingFee, currency)} />
              {Number(order.discount) > 0 && (
                <Line label="Discount" value={"− " + formatMoney(order.discount, currency)} />
              )}
              <Line label="Total" value={formatMoney(order.total, currency)} bold />
            </dl>
          </section>

          <ActionForm
            action={updateOrder.bind(null, order.id)}
            submit="Save"
            className="card space-y-3 p-3"
          >
            <h2 className="text-[11px] font-bold tracking-wider text-stone-700 uppercase">Update order</h2>
            <div className="grid gap-4 sm:grid-cols-2">
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
              <Field label="Tracking number">
                <input
                  name="trackingNumber"
                  defaultValue={order.trackingNumber ?? ""}
                  className="input"
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea name="notes" rows={2} defaultValue={order.notes ?? ""} className="input" />
            </Field>
          </ActionForm>
        </div>

        <aside className="card h-fit space-y-2 p-3 text-sm">
          <h2 className="text-[11px] font-bold tracking-wider text-stone-700 uppercase">Customer</h2>
          <p>
            {customer.name}
            {customer.phone && <span className="block text-stone-600">{customer.phone}</span>}
          </p>
          <div>
            <p className="label">Deliver to</p>
            <p>{order.shippingAddress ?? "No address given"}</p>
          </div>
          <div>
            <p className="label">Payment</p>
            <p>{order.payment === "cod" ? "Cash on delivery" : "Already paid"}</p>
          </div>
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
