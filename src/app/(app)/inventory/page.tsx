import { and, desc, eq, exists, ilike, or, sql } from "drizzle-orm";
import Link from "next/link";
import { Badge, Empty, PageHeader } from "@/components/ui";
import { db } from "@/db";
import { products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { getPrefs } from "@/lib/settings";

const views = [
  { key: "", label: "Active" },
  { key: "low", label: "Low stock" },
  { key: "archived", label: "Archived" },
];

export default async function InventoryPage({
  searchParams,
}: PageProps<"/inventory">) {
  await requireUser();
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const view = typeof params.view === "string" ? params.view : "";
  const { currency } = await getPrefs();

  const low = sql<boolean>`coalesce(bool_or(${variants.stock} <= ${variants.lowStockAt}), false)`;
  const rows = await db
    .select({
      id: products.id,
      name: products.name,
      category: products.category,
      variantCount: sql<number>`count(${variants.id})::int`,
      stock: sql<number>`coalesce(sum(${variants.stock}), 0)::int`,
      minPrice: sql<string | null>`min(${variants.price})`,
      maxPrice: sql<string | null>`max(${variants.price})`,
      low,
    })
    .from(products)
    .leftJoin(variants, eq(variants.productId, products.id))
    .where(
      and(
        eq(products.archived, view === "archived"),
        q
          ? or(
              ilike(products.name, `%${q}%`),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(variants)
                  .where(
                    and(
                      eq(variants.productId, products.id),
                      ilike(variants.sku, `%${q}%`),
                    ),
                  ),
              ),
            )
          : undefined,
      ),
    )
    .groupBy(products.id)
    .having(view === "low" ? low : undefined)
    .orderBy(desc(products.createdAt))
    .limit(300);

  return (
    <>
      <PageHeader
        title="Inventory"
        subtitle="Your products and how many of each you have."
        action={{ href: "/inventory/new", label: "Add product" }}
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex gap-1">
          {views.map((v) => (
            <Link
              key={v.key}
              href={v.key ? `/inventory?view=${v.key}` : "/inventory"}
              className={
                "rounded-full px-3 py-1.5 text-xs font-medium " +
                (view === v.key
                  ? "bg-stone-900 text-white"
                  : "bg-stone-200/70 text-stone-700 hover:bg-stone-200")
              }
            >
              {v.label}
            </Link>
          ))}
        </div>
        <form className="ml-auto flex gap-2">
          {view && <input type="hidden" name="view" value={view} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name or SKU"
            className="input w-56"
          />
          <button className="btn-secondary">Search</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty title={q || view ? "Nothing found" : "No products yet"}>
          {!q && !view && "Add your first product to start tracking stock."}
        </Empty>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-stone-200">
              <tr>
                <th className="th">Product</th>
                <th className="th">Category</th>
                <th className="th">Options</th>
                <th className="th">Price</th>
                <th className="th text-right">In stock</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((row) => (
                <tr key={row.id} className="hover:bg-stone-50">
                  <td className="td font-medium">
                    <Link href={`/inventory/${row.id}`} className="hover:underline">
                      {row.name}
                    </Link>
                  </td>
                  <td className="td text-stone-600">{row.category ?? "—"}</td>
                  <td className="td text-stone-600">{row.variantCount}</td>
                  <td className="td text-stone-600">
                    {row.minPrice === null
                      ? "—"
                      : row.minPrice === row.maxPrice
                        ? formatMoney(row.minPrice, currency)
                        : `${formatMoney(row.minPrice, currency)} – ${formatMoney(row.maxPrice, currency)}`}
                  </td>
                  <td className="td text-right">
                    <span className="mr-2 font-medium tabular-nums">{row.stock}</span>
                    {row.stock === 0 ? (
                      <Badge tone="red">Out</Badge>
                    ) : row.low ? (
                      <Badge tone="amber">Low</Badge>
                    ) : (
                      <Badge tone="green">OK</Badge>
                    )}
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
