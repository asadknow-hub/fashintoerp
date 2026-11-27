import { and, asc, count, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import Link from "next/link";
import {
  Badge,
  Empty,
  orderStatusLabel,
  orderStatusTone,
  PageHeader,
  pageNumber,
  Pager,
} from "@/components/ui";
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
import { formatDate, formatDateTime, formatMoney, isUuid } from "@/lib/format";
import { getPrefs } from "@/lib/settings";
import { OrderActions } from "./order-actions";

type Status = (typeof orders.status.enumValues)[number];

const PAGE_SIZE = 50;

const filters: { key: string; label: string; statuses?: Status[] }[] = [
  { key: "", label: "All" },
  {
    key: "open",
    label: "To send out",
    statuses: ["new", "confirmed", "packed"],
  },
  { key: "shipped", label: "Dispatched", statuses: ["shipped"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "cancelled", label: "Cancelled", statuses: ["cancelled"] },
  { key: "returned", label: "Returns", statuses: ["returned"] },
];

export default async function OrdersPage({
  searchParams,
}: PageProps<"/orders">) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const status = typeof params.status === "string" ? params.status : "";
  const filter = filters.find((f) => f.key === status) ?? filters[0];
  const { currency, timezone } = await getPrefs();
  const number = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;

  // Opened from a product page: only the orders that contain that product.
  const productId =
    typeof params.product === "string" && isUuid(params.product) ? params.product : null;
  const [only] = productId
    ? await db.select({ name: products.name }).from(products).where(eq(products.id, productId))
    : [];

  const page = pageNumber(params.page);
  const where = and(
    filter.statuses ? inArray(orders.status, filter.statuses) : undefined,
    only
      ? exists(
          db
            .select({ one: sql`1` })
            .from(orderItems)
            .innerJoin(variants, eq(variants.id, orderItems.variantId))
            .where(and(eq(orderItems.orderId, orders.id), eq(variants.productId, productId!))),
        )
      : undefined,
    q
      ? or(
          ilike(customers.name, `%${q}%`),
          ilike(customers.phone, `%${q}%`),
          ilike(orders.trackingNumber, `%${q}%`),
          number !== null && number < 2 ** 31
            ? eq(orders.number, number)
            : undefined,
        )
      : undefined,
  );
  const [[{ total }], rows, companies] = await Promise.all([
    db
      .select({ total: count() })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where),
    db
      .select({
        id: orders.id,
        number: orders.number,
        status: orders.status,
        payment: orders.payment,
        codAmount: orders.codAmount,
        ref: orders.trackingNumber,
        instruction: orders.instruction,
        notes: orders.notes,
        city: orders.city,
        area: orders.area,
        street: orders.street,
        shippingAddress: orders.shippingAddress,
        phone2: orders.phone2,
        companyId: orders.deliveryCompanyId,
        company: deliveryCompanies.name,
        portalAt: orders.portalAt,
        dispatchedAt: orders.dispatchedAt,
        deliveredAt: orders.deliveredAt,
        deliveryCharge: orders.deliveryCharge,
        createdAt: orders.createdAt,
        customer: customers.name,
        phone: customers.phone,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .leftJoin(deliveryCompanies, eq(deliveryCompanies.id, orders.deliveryCompanyId))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({
        id: deliveryCompanies.id,
        name: deliveryCompanies.name,
        rate: deliveryCompanies.rate,
        active: deliveryCompanies.active,
      })
      .from(deliveryCompanies)
      .orderBy(asc(deliveryCompanies.name)),
  ]);

  // What is in each order on this page: "1 M Black, 2 XL Grey" per product.
  const lines = rows.length
    ? await db
        .select({
          orderId: orderItems.orderId,
          quantity: orderItems.quantity,
          product: products.name,
          size: variants.size,
          color: variants.color,
        })
        .from(orderItems)
        .innerJoin(variants, eq(variants.id, orderItems.variantId))
        .innerJoin(products, eq(products.id, variants.productId))
        .where(
          inArray(
            orderItems.orderId,
            rows.map((row) => row.id),
          ),
        )
        .orderBy(asc(products.name), asc(variants.createdAt))
    : [];
  const contents = new Map<string, { pieces: number; products: Map<string, string[]> }>();
  for (const line of lines) {
    const entry = contents.get(line.orderId) ?? { pieces: 0, products: new Map() };
    entry.pieces += line.quantity;
    const what = [line.quantity, line.size, line.color].filter(Boolean).join(" ");
    entry.products.set(line.product, [...(entry.products.get(line.product) ?? []), what]);
    contents.set(line.orderId, entry);
  }
  const when = (date: Date | null) => (date ? formatDateTime(date, timezone) : null);

  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (filter.key) query.set("status", filter.key);
    if (only) query.set("product", productId!);
    if (q) query.set("q", q);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/orders?${text}` : "/orders";
  };

  // Tight cells: this list is worked from all day.
  const head = "px-2.5 py-2 text-left text-xs font-semibold whitespace-nowrap text-stone-600";
  const cell = "px-2.5 py-2";

  return (
    <>
      <PageHeader
        title={filter.key === "returned" ? "Order Returns" : "Orders"}
        subtitle={
          filter.key === "returned"
            ? "Orders that came back. Their items were put back in stock."
            : undefined
        }
        action={{ href: "/orders/new", label: "Create Order" }}
      />

      {only && (
        <p
          data-product-filter
          className="card mb-3 flex flex-wrap items-center gap-2 border-brand-100 bg-brand-50 px-3 py-2 text-sm"
        >
          Showing only orders that contain <b>{only.name}</b>.
          <Link href={`/inventory/${productId}`} className="font-semibold text-brand hover:underline">
            Back to the product
          </Link>
          <Link href="/orders" className="ml-auto font-semibold text-brand hover:underline">
            Show all orders
          </Link>
        </p>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <Link
              key={f.key}
              href={
                "/orders" +
                (f.key || only
                  ? "?" +
                    new URLSearchParams({
                      ...(f.key && { status: f.key }),
                      ...(only && { product: productId! }),
                    })
                  : "")
              }
              className={
                "rounded-full px-3 py-1.5 text-xs font-medium " +
                (filter.key === f.key
                  ? "bg-brand text-white"
                  : "bg-stone-200/70 text-stone-700 hover:bg-stone-200")
              }
            >
              {f.label}
            </Link>
          ))}
        </div>
        <form className="ml-auto flex gap-2">
          {filter.key && (
            <input type="hidden" name="status" value={filter.key} />
          )}
          <input
            name="q"
            defaultValue={q}
            placeholder="Order #, name, phone or shipper ref"
            className="input w-56"
          />
          <button className="btn-secondary">Search</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty
          title={
            filter.key === "returned" && !q
              ? "No returns"
              : q || filter.key
                ? "Nothing found"
                : "No orders yet"
          }
        >
          {filter.key === "returned" &&
            !q &&
            "To record a return, open the order and set its status to Returned."}
          {!q && !filter.key && "Orders you create will show up here."}
        </Empty>
      ) : (
        <div className="card overflow-x-auto" data-orders>
          <table className="w-full text-[13px] leading-snug">
            <thead className="border-b border-stone-200">
              <tr>
                <th className={head + " w-px"}>Date</th>
                <th className={head + " w-px"}>Order</th>
                <th className={head}>Customer</th>
                <th className={head + " w-px text-center"}>Items</th>
                <th className={head}>Instruction</th>
                <th className={head}>Description</th>
                <th className={head}>Address</th>
                <th className={head + " w-px text-right"}>COD</th>
                <th className={head + " w-px"}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((row) => {
                const inside = contents.get(row.id);
                const shut = row.status === "cancelled" || row.status === "returned";
                return (
                  <tr key={row.id} data-order={row.number} className="align-top hover:bg-stone-50">
                    <td className={cell + " whitespace-nowrap text-stone-600"}>
                      {formatDate(row.createdAt, timezone)}
                    </td>
                    <td className={cell + " whitespace-nowrap"}>
                      <Link
                        href={`/orders/${row.id}`}
                        className="font-bold tabular-nums hover:text-brand hover:underline"
                      >
                        #{row.number}
                      </Link>
                      {row.ref && <span className="block text-xs text-stone-500">{row.ref}</span>}
                      <span className="mt-0.5 block">
                        <Badge tone={orderStatusTone[row.status]}>
                          {orderStatusLabel[row.status]}
                        </Badge>
                      </span>
                    </td>
                    <td className={cell}>
                      <span className="font-semibold">{row.customer}</span>
                      {row.phone && (
                        <span className="block text-xs whitespace-nowrap text-stone-500">
                          {row.phone}
                        </span>
                      )}
                      {row.phone2 && (
                        <span className="block text-xs whitespace-nowrap text-stone-500">
                          {row.phone2}
                        </span>
                      )}
                    </td>
                    <td className={cell + " text-center font-bold tabular-nums"}>
                      {inside?.pieces ?? 0}
                    </td>
                    <td className={cell + " max-w-44 text-stone-700"}>{row.instruction ?? "—"}</td>
                    <td className={cell + " max-w-56"} data-order-contents>
                      {inside
                        ? [...inside.products].map(([product, what]) => (
                            <span key={product} className="block">
                              <span className="block text-xs text-stone-500">{product}</span>
                              <span className="font-semibold">{what.join(", ")}</span>
                            </span>
                          ))
                        : "—"}
                      {row.notes && (
                        <span className="mt-0.5 block text-xs text-stone-500 italic">{row.notes}</span>
                      )}
                    </td>
                    <td className={cell + " max-w-52"} data-order-address>
                      {row.city || row.area || row.street ? (
                        <>
                          {row.city && <span className="block font-semibold">{row.city}</span>}
                          {row.area && <span className="block">{row.area}</span>}
                          {row.street && <span className="block text-stone-600">{row.street}</span>}
                        </>
                      ) : (
                        (row.shippingAddress ?? "—")
                      )}
                    </td>
                    <td className={cell + " text-right font-bold whitespace-nowrap tabular-nums"}>
                      {row.payment === "cod" ? formatMoney(row.codAmount, currency) : "Paid"}
                    </td>
                    <td className={cell}>
                      {shut ? (
                        <Link href={`/orders/${row.id}`} className="btn-secondary btn-sm">
                          Open
                        </Link>
                      ) : (
                        <OrderActions
                          currency={currency}
                          // The company this order went with stays choosable
                          // even after it was taken off the list.
                          companies={companies
                            .filter((company) => company.active || company.id === row.companyId)
                            .map((company) => ({
                              id: company.id,
                              name: company.name,
                              rate: Number(company.rate),
                            }))}
                          order={{
                            id: row.id,
                            number: row.number,
                            customer: row.customer,
                            companyId: row.companyId,
                            portalAt: when(row.portalAt),
                            dispatchedAt: when(row.dispatchedAt),
                            deliveredAt: when(row.deliveredAt),
                            deliveryCharge:
                              row.deliveryCharge === null ? null : Number(row.deliveryCharge),
                          }}
                        />
                      )}
                      {row.company && (
                        <span className="mt-1 block text-xs whitespace-nowrap text-stone-500">
                          {row.company}
                          {row.deliveryCharge !== null &&
                            ` · ${formatMoney(row.deliveryCharge, currency)}`}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pageSize={PAGE_SIZE} total={total} href={pageHref} />
    </>
  );
}
