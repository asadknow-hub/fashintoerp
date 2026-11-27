import { and, desc, eq, exists, ilike, or, sql } from "drizzle-orm";
import Link from "next/link";
import {
  Badge,
  Block,
  Empty,
  OrderBadge,
  PageHeader,
} from "@/components/ui";
import { db } from "@/db";
import { customers, orders, productMedia, products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, orderName } from "@/lib/format";
import { getPrefs } from "@/lib/settings";

// Results for the search box at the top of every page.
export default async function SearchPage({ searchParams }: PageProps<"/search">) {
  const [, params, { currency, timezone }] = await Promise.all([
    requireUser(),
    searchParams,
    getPrefs(),
  ]);
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const like = `%${q}%`;
  const number = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;

  const [foundProducts, foundOrders, foundCustomers] = q
    ? await Promise.all([
        db
          .select({
            id: products.id,
            name: products.name,
            sku: products.sku,
            category: products.category,
            archived: products.archived,
            stock: sql<number>`(select coalesce(sum(${variants.stock}), 0)::int from ${variants} where ${variants.productId} = ${products.id})`,
            photo: sql<string | null>`(
              select coalesce(${productMedia.thumbUrl}, ${productMedia.url}) from ${productMedia}
              where ${productMedia.productId} = ${products.id}
                and (${productMedia.kind} = 'image' or ${productMedia.thumbUrl} is not null)
              order by (${productMedia.tag} = 'Main photo') desc, ${productMedia.createdAt}
              limit 1
            )`,
          })
          .from(products)
          .where(
            or(
              ilike(products.name, like),
              ilike(products.sku, like),
              ilike(products.category, like),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(variants)
                  .where(and(eq(variants.productId, products.id), ilike(variants.sku, like))),
              ),
            ),
          )
          .orderBy(products.archived, desc(products.createdAt))
          .limit(25),
        db
          .select({
            id: orders.id,
            number: orders.number,
            ref: orders.trackingNumber,
            exchanged: sql<boolean>`exists (
          select 1 from orders x where x.exchange_of_id = ${orders.id} and x.status <> 'cancelled'
        )`,
            status: orders.status,
            payment: orders.payment,
            codAmount: orders.codAmount,
            createdAt: orders.createdAt,
            customer: customers.name,
            phone: customers.phone,
          })
          .from(orders)
          .innerJoin(customers, eq(customers.id, orders.customerId))
          .where(
            or(
              ilike(customers.name, like),
              ilike(customers.phone, like),
              ilike(orders.trackingNumber, like),
              number !== null && number < 2 ** 31 ? eq(orders.number, number) : undefined,
            ),
          )
          .orderBy(desc(orders.createdAt))
          .limit(25),
        db
          .select({
            id: customers.id,
            name: customers.name,
            phone: customers.phone,
            city: customers.city,
            orders: sql<number>`(select count(*)::int from orders where orders.customer_id = customers.id)`,
          })
          .from(customers)
          .where(
            or(
              ilike(customers.name, like),
              ilike(customers.phone, like),
              ilike(customers.phone2, like),
            ),
          )
          .orderBy(desc(customers.createdAt))
          .limit(25),
      ])
    : [[], [], []];

  return (
    <>
      <PageHeader
        title="Search"
        subtitle={q ? `Results for “${q}”` : "Type in the box at the top to search."}
      />
      {q && foundProducts.length + foundOrders.length + foundCustomers.length === 0 && (
        <Empty title="Nothing found">
          Try a product name, a SKU, an order number, or a customer&apos;s name or phone.
        </Empty>
      )}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {foundProducts.length > 0 && (
          <Block title={`Products (${foundProducts.length})`} flush>
            <ul className="divide-y divide-stone-100 pb-2" data-found-products>
              {foundProducts.map((product) => (
                <li key={product.id}>
                  <Link
                    href={`/inventory/${product.id}`}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-stone-50"
                  >
                    <span className="size-10 shrink-0 overflow-hidden rounded-lg border border-stone-200 bg-stone-100">
                      {product.photo && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={product.photo} alt="" className="size-full object-cover" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{product.name}</span>
                      <span className="block truncate text-xs text-stone-500">
                        {[product.sku, product.category].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    {product.archived && <Badge>Archived</Badge>}
                    <span className="shrink-0 font-bold tabular-nums">{product.stock} in stock</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Block>
        )}
        {foundOrders.length > 0 && (
          <Block title={`Orders (${foundOrders.length})`} flush>
            <ul className="divide-y divide-stone-100 pb-2" data-found-orders>
              {foundOrders.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/orders/${order.id}`}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-stone-50"
                  >
                    <span className="font-bold tabular-nums">{orderName(order.ref, order.number)}</span>
                    <span className="min-w-0 flex-1 truncate text-stone-600">
                      {order.customer}
                      {order.phone ? ` · ${order.phone}` : ""} · {formatDate(order.createdAt, timezone)}
                    </span>
                    <OrderBadge status={order.status} exchanged={order.exchanged} />
                    <span className="shrink-0 tabular-nums">{order.payment === "cod" ? formatMoney(order.codAmount, currency) : "Paid"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Block>
        )}
        {foundCustomers.length > 0 && (
          <Block title={`Customers (${foundCustomers.length})`} flush>
            <ul className="divide-y divide-stone-100 pb-2" data-found-customers>
              {foundCustomers.map((customer) => (
                <li key={customer.id}>
                  <Link
                    href={`/customers?q=${encodeURIComponent(customer.phone ?? customer.name)}`}
                    className="flex items-center gap-3 px-4 py-2 text-sm hover:bg-stone-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">{customer.name}</span>
                      <span className="block truncate text-xs text-stone-500">
                        {[customer.phone, customer.city].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </span>
                    <span className="shrink-0 tabular-nums text-stone-600">
                      {customer.orders} {customer.orders === 1 ? "order" : "orders"}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Block>
        )}
      </div>
    </>
  );
}
