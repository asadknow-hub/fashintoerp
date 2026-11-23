import { and, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import Link from "next/link";
import { Badge, Empty, orderStatusTone, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { getPrefs } from "@/lib/settings";

type Status = (typeof orders.status.enumValues)[number];

const filters: { key: string; label: string; statuses?: Status[] }[] = [
  { key: "", label: "All" },
  { key: "open", label: "To send out", statuses: ["new", "confirmed", "packed"] },
  { key: "shipped", label: "Shipped", statuses: ["shipped"] },
  { key: "delivered", label: "Delivered", statuses: ["delivered"] },
  { key: "closed", label: "Cancelled / returned", statuses: ["cancelled", "returned"] },
];

export default async function OrdersPage({ searchParams }: PageProps<"/orders">) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const status = typeof params.status === "string" ? params.status : "";
  const filter = filters.find((f) => f.key === status) ?? filters[0];
  const { currency, timezone } = await getPrefs();
  const number = /^#?\d+$/.test(q) ? Number(q.replace("#", "")) : null;

  const rows = await db
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      payment: orders.payment,
      total: orders.total,
      createdAt: orders.createdAt,
      customer: customers.name,
      phone: customers.phone,
      items: sql<number>`(select coalesce(sum(quantity), 0)::int from order_items where order_id = ${orders.id})`,
    })
    .from(orders)
    .innerJoin(customers, eq(customers.id, orders.customerId))
    .where(
      and(
        filter.statuses ? inArray(orders.status, filter.statuses) : undefined,
        q
          ? or(
              ilike(customers.name, `%${q}%`),
              ilike(customers.phone, `%${q}%`),
              number !== null && number < 2 ** 31 ? eq(orders.number, number) : undefined,
            )
          : undefined,
      ),
    )
    .orderBy(desc(orders.createdAt))
    .limit(200);

  return (
    <>
      <PageHeader
        title="Orders"
        action={{ href: "/orders/new", label: "New order" }}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1">
          {filters.map((f) => (
            <Link
              key={f.key}
              href={f.key ? `/orders?status=${f.key}` : "/orders"}
              className={
                "rounded-full px-3 py-1.5 text-xs font-medium " +
                (filter.key === f.key
                  ? "bg-stone-900 text-white"
                  : "bg-stone-200/70 text-stone-700 hover:bg-stone-200")
              }
            >
              {f.label}
            </Link>
          ))}
        </div>
        <form className="ml-auto flex gap-2">
          {filter.key && <input type="hidden" name="status" value={filter.key} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Order #, name or phone"
            className="input w-56"
          />
          <button className="btn-secondary">Search</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty title={q || filter.key ? "Nothing found" : "No orders yet"}>
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
                <th className="th">Payment</th>
                <th className="th">Status</th>
                <th className="th text-right">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-stone-50">
                  <td className="td font-medium tabular-nums">
                    <Link href={`/orders/${row.id}`} className="hover:underline">
                      #{row.number}
                    </Link>
                  </td>
                  <td className="td whitespace-nowrap text-stone-600">
                    {formatDate(row.createdAt, timezone)}
                  </td>
                  <td className="td">
                    {row.customer}
                    {row.phone && (
                      <span className="block text-xs text-stone-500">{row.phone}</span>
                    )}
                  </td>
                  <td className="td text-stone-600">{row.items}</td>
                  <td className="td text-stone-600">
                    {row.payment === "cod" ? "Cash on delivery" : "Paid"}
                  </td>
                  <td className="td">
                    <Badge tone={orderStatusTone[row.status]}>{row.status}</Badge>
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
    </>
  );
}
