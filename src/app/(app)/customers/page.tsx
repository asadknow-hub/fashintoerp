import { count, desc, eq, ilike, or, sql } from "drizzle-orm";
import Link from "next/link";
import { Empty, PageHeader, pageNumber, Pager } from "@/components/ui";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney, likeTerm, phoneTerms } from "@/lib/format";
import { orderAmount } from "@/lib/order-amount";
import { getPrefs } from "@/lib/settings";

const PAGE_SIZE = 50;

export default async function CustomersPage({
  searchParams,
}: PageProps<"/customers">) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 80) : "";
  const { currency, timezone } = await getPrefs();

  const page = pageNumber(params.page);
  const where = q
    ? or(
        ilike(customers.name, likeTerm(q)),
        ilike(customers.phone, likeTerm(q)),
        ...phoneTerms(q).map((term) => ilike(customers.phone, term)),
      )
    : undefined;
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(customers).where(where),
    db
      .select({
        id: customers.id,
        name: customers.name,
        phone: customers.phone,
        city: customers.city,
        area: customers.area,
        createdAt: customers.createdAt,
        orderCount: sql<number>`count(${orders.id})::int`,
        spent: sql<string>`coalesce(sum(${orderAmount}) filter (where ${orders.status} not in ('cancelled', 'returned')), 0)`,
      })
      .from(customers)
      .leftJoin(orders, eq(orders.customerId, customers.id))
      .where(where)
      .groupBy(customers.id)
      .orderBy(desc(customers.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);
  const pageHref = (target: number) => {
    const query = new URLSearchParams();
    if (q) query.set("q", q);
    if (target > 1) query.set("page", String(target));
    const text = query.toString();
    return text ? `/customers?${text}` : "/customers";
  };

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle="Added automatically when you create an order."
      />
      <form className="mb-2 flex gap-2">
        <input
          name="q"
          defaultValue={q}
          placeholder="Search name or phone"
          className="input w-64"
        />
        <button className="btn-secondary">Search</button>
      </form>

      {rows.length === 0 ? (
        <Empty title={q ? "Nothing found" : "No customers yet"} />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-stone-200">
              <tr>
                <th className="th">Name</th>
                <th className="th">Phone</th>
                <th className="th">City</th>
                <th className="th">Customer since</th>
                <th className="th text-right">Orders</th>
                <th className="th text-right">Spent</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-stone-50">
                  <td className="td font-medium">
                    <Link
                      href={`/orders?q=${encodeURIComponent(row.phone ?? row.name)}`}
                      className="hover:underline"
                    >
                      {row.name}
                    </Link>
                  </td>
                  <td className="td text-stone-600">{row.phone ?? "—"}</td>
                  <td className="td text-stone-600">{[row.area, row.city].filter(Boolean).join(", ") || "—"}</td>
                  <td className="td text-stone-600">
                    {formatDate(row.createdAt, timezone)}
                  </td>
                  <td className="td text-right tabular-nums">
                    {row.orderCount}
                  </td>
                  <td className="td text-right tabular-nums">
                    {formatMoney(row.spent, currency)}
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
