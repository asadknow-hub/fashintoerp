import { count, desc, eq, ilike, or, sql } from "drizzle-orm";
import Link from "next/link";
import { Empty, PageHeader, pageNumber, Pager } from "@/components/ui";
import { db } from "@/db";
import { products, stockPurchases, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { getPrefs } from "@/lib/settings";

const PAGE_SIZE = 50;

// Every lot of stock that was bought, across all products.
export default async function PurchasesPage({ searchParams }: PageProps<"/purchases">) {
  const [, params, { currency, timezone }] = await Promise.all([
    requireUser(),
    searchParams,
    getPrefs(),
  ]);
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const page = pageNumber(params.page);
  const where = q
    ? or(ilike(products.name, `%${q}%`), ilike(stockPurchases.note, `%${q}%`))
    : undefined;

  const [[totals], rows] = await Promise.all([
    db
      .select({
        lots: count(),
        units: sql<number>`coalesce(sum(${stockPurchases.units}), 0)::int`,
        paid: sql<string>`coalesce(sum(${stockPurchases.totalCost}), 0)`,
        unpriced: sql<number>`count(*) filter (where ${stockPurchases.totalCost} is null)::int`,
      })
      .from(stockPurchases)
      .innerJoin(products, eq(products.id, stockPurchases.productId))
      .where(where),
    db
      .select({
        id: stockPurchases.id,
        productId: products.id,
        product: products.name,
        note: stockPurchases.note,
        units: stockPurchases.units,
        totalCost: stockPurchases.totalCost,
        createdAt: stockPurchases.createdAt,
        by: users.name,
      })
      .from(stockPurchases)
      .innerJoin(products, eq(products.id, stockPurchases.productId))
      .leftJoin(users, eq(users.id, stockPurchases.createdBy))
      .where(where)
      .orderBy(desc(stockPurchases.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);

  return (
    <>
      <PageHeader
        title="Purchases"
        subtitle="Every batch of stock you bought, and what you paid for it."
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <dl
          data-totals
          className="card grid min-w-0 flex-1 grid-cols-3 gap-px overflow-hidden bg-stone-200 text-sm"
        >
          {[
            ["Batches", String(totals.lots)],
            ["Units purchased", String(totals.units)],
            ["Total paid", formatMoney(totals.paid, currency)],
          ].map(([label, text]) => (
            <div key={label} className="bg-white px-3 py-2">
              <dt className="text-xs text-stone-500">{label}</dt>
              <dd className="font-bold tabular-nums">{text}</dd>
            </div>
          ))}
        </dl>
        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={q}
            placeholder="Search product or supplier"
            className="input w-56"
          />
          <button className="btn-secondary">Search</button>
        </form>
      </div>

      {totals.unpriced > 0 && (
        <p className="card mb-3 border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {totals.unpriced} {totals.unpriced === 1 ? "batch has" : "batches have"} no cost yet. Open
          the product and click the batch to type what you paid.
        </p>
      )}

      {rows.length === 0 ? (
        <Empty title={q ? "Nothing found" : "No purchases yet"}>
          {!q && "A batch is recorded each time you add a product with stock or receive stock."}
        </Empty>
      ) : (
        <div className="card overflow-x-auto p-3">
          <table className="w-full tabular-nums">
            <thead>
              <tr>
                <th className="th rounded-l-lg">Date</th>
                <th className="th">Product</th>
                <th className="th">Supplier / Batch</th>
                <th className="th text-center">Units Purchased</th>
                <th className="th text-right">Unit Cost</th>
                <th className="th rounded-r-lg text-right">Total Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-stone-50">
                  <td className="td whitespace-nowrap text-stone-600">
                    {formatDate(row.createdAt, timezone)}
                  </td>
                  <td className="td font-semibold">
                    <Link href={`/inventory/${row.productId}`} className="hover:text-brand hover:underline">
                      {row.product}
                    </Link>
                  </td>
                  <td className="td text-stone-600">{row.note ?? "—"}</td>
                  <td className="td text-center font-bold">{row.units}</td>
                  <td className="td text-right">
                    {row.totalCost === null
                      ? "—"
                      : formatMoney(Number(row.totalCost) / row.units, currency)}
                  </td>
                  <td className="td text-right">
                    {row.totalCost === null ? (
                      <Link
                        href={`/inventory/${row.productId}`}
                        className="font-semibold text-amber-700 hover:underline"
                      >
                        Add cost
                      </Link>
                    ) : (
                      formatMoney(row.totalCost, currency)
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager
        page={page}
        pageSize={PAGE_SIZE}
        total={totals.lots}
        href={(target) => {
          const query = new URLSearchParams();
          if (q) query.set("q", q);
          if (target > 1) query.set("page", String(target));
          const text = query.toString();
          return text ? `/purchases?${text}` : "/purchases";
        }}
      />
    </>
  );
}
