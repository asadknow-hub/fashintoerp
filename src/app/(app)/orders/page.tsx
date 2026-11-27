import { and, count, desc, eq, exists, ilike, inArray, or, sql } from "drizzle-orm";
import Link from "next/link";
import {
  Badge,
  Empty,
  orderStatusTone,
  PageHeader,
  pageNumber,
  Pager,
} from "@/components/ui";
import { db } from "@/db";
import { customers, orderItems, orders, products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, isUuid } from "@/lib/format";
import { getPrefs } from "@/lib/settings";

type Status = (typeof orders.status.enumValues)[number];

const PAGE_SIZE = 50;

const filters: { key: string; label: string; statuses?: Status[] }[] = [
  { key: "", label: "All" },
  {
    key: "open",
    label: "To send out",
    statuses: ["new", "confirmed", "packed"],
  },
  { key: "shipped", label: "Shipped", statuses: ["shipped"] },
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
  const [[{ total }], rows] = await Promise.all([
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
        city: orders.city,
        total: orders.total,
        createdAt: orders.createdAt,
        customer: customers.name,
        phone: customers.phone,
        items: sql<number>`(select coalesce(sum(quantity), 0)::int from order_items where order_id = ${orders.id})`,
      })
      .from(orders)
      .innerJoin(customers, eq(customers.id, orders.customerId))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (filter.key) query.set("status", filter.key);
    if (only) query.set("product", productId!);
    if (q) query.set("q", q);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/orders?${text}` : "/orders";
  };

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
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-stone-200">
              <tr>
                <th className="th">Order</th>
                <th className="th">Date</th>
                <th className="th">Customer</th>
                <th className="th">Items</th>
                <th className="th">COD</th>
                <th className="th">Status</th>
                <th className="th text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-stone-50">
                  <td className="td font-medium tabular-nums">
                    <Link
                      href={`/orders/${row.id}`}
                      className="hover:underline"
                    >
                      #{row.number}
                    </Link>
                  </td>
                  <td className="td whitespace-nowrap text-stone-600">
                    {formatDate(row.createdAt, timezone)}
                  </td>
                  <td className="td">
                    {row.customer}
                    {row.phone && (
                      <span className="block text-xs text-stone-500">
                        {row.phone}
                      </span>
                    )}
                  </td>
                  <td className="td text-stone-600">{row.items}</td>
                  <td className="td text-stone-600">
                    {row.payment === "cod" ? formatMoney(row.codAmount, currency) : "Paid"}
                  </td>
                  <td className="td">
                    <Badge tone={orderStatusTone[row.status]}>
                      {row.status}
                    </Badge>
                  </td>
                  <td className="td text-right tabular-nums">
                    {formatMoney(row.total, currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} pageSize={PAGE_SIZE} total={total} href={pageHref} />
    </>
  );
}
