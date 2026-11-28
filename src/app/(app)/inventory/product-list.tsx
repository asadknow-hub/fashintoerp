import { and, count, desc, eq, exists, ilike, or, sql } from "drizzle-orm";
import Link from "next/link";
import { Badge, Empty, PageHeader, pageNumber, Pager } from "@/components/ui";
import { db } from "@/db";
import { productMedia, products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatMoney, likeTerm } from "@/lib/format";
import { getPrefs } from "@/lib/settings";

const PAGE_SIZE = 48;

const views = [
  { key: "", label: "Active" },
  { key: "low", label: "Low stock" },
  { key: "archived", label: "Archived" },
];

type Params = Record<string, string | string[] | undefined>;

// The list of products, shown two ways: "Products" is the photo gallery and
// "Inventory" is the stock table. Both have the same tabs, search and totals.
export async function ProductList({
  params,
  layout,
}: {
  params: Params;
  layout: "gallery" | "table";
}) {
  await requireUser();
  const q = typeof params.q === "string" ? params.q.trim() : "";
  const view = typeof params.view === "string" ? params.view : "";
  const { currency } = await getPrefs();

  const page = pageNumber(params.page);
  const low = sql<boolean>`coalesce(bool_or(${variants.stock} <= ${variants.lowStockAt}), false)`;
  // Every product that matches the tab and search, with its stock summed up.
  const matching = db
    .select({
      id: products.id,
      name: products.name,
      category: products.category,
      createdAt: products.createdAt,
      stock: sql<number>`coalesce(sum(${variants.stock}), 0)::int`.as("stock"),
      value: sql<string>`coalesce(sum(${variants.stock} * ${variants.cost}), 0)`.as("value"),
      colors: sql<number>`count(distinct ${variants.color})::int`.as("colors"),
      sizes: sql<number>`count(distinct ${variants.size})::int`.as("sizes"),
      // The small version of the "Main photo" if there is one, otherwise the
      // first photo, otherwise a frame from a video.
      photo: sql<string | null>`(
        select coalesce(${productMedia.thumbUrl}, ${productMedia.url}) from ${productMedia}
        where ${productMedia.productId} = ${products.id}
          and (${productMedia.kind} = 'image' or ${productMedia.thumbUrl} is not null)
        order by (${productMedia.tag} = 'Main photo') desc,
          (${productMedia.kind} = 'image') desc, ${productMedia.createdAt}
        limit 1
      )`.as("photo"),
      minPrice: sql<string | null>`min(${variants.price})`.as("min_price"),
      maxPrice: sql<string | null>`max(${variants.price})`.as("max_price"),
      low: low.as("low"),
    })
    .from(products)
    .leftJoin(variants, eq(variants.productId, products.id))
    .where(
      and(
        eq(products.archived, view === "archived"),
        q
          ? or(
              ilike(products.name, likeTerm(q)),
              exists(
                db
                  .select({ one: sql`1` })
                  .from(variants)
                  .where(
                    and(
                      eq(variants.productId, products.id),
                      ilike(variants.sku, likeTerm(q)),
                    ),
                  ),
              ),
            )
          : undefined,
      ),
    )
    .groupBy(products.id)
    .having(view === "low" ? low : undefined)
    .as("matching");

  // Totals cover everything that matches, not just the page on screen.
  const [[totals], rows] = await Promise.all([
    db
      .select({
        products: count(),
        units: sql<number>`coalesce(sum(${matching.stock}), 0)::int`,
        value: sql<string>`coalesce(sum(${matching.value}), 0)`,
      })
      .from(matching),
    db
      .select()
      .from(matching)
      .orderBy(desc(matching.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ]);

  // Keeps the current filters when switching tab, layout or searching.
  const href = (changes: { view?: string; layout?: string; page?: number }) => {
    const query = new URLSearchParams();
    const nextView = changes.view ?? view;
    const base = (changes.layout ?? layout) === "table" ? "/inventory" : "/products";
    if (nextView) query.set("view", nextView);
    if (q) query.set("q", q);
    if (changes.page && changes.page > 1) query.set("page", String(changes.page));
    const text = query.toString();
    return text ? `${base}?${text}` : base;
  };

  const units = totals.units;
  const value = Number(totals.value);
  const price = (row: (typeof rows)[number]) =>
    row.minPrice === null
      ? "—"
      : row.minPrice === row.maxPrice
        ? formatMoney(row.minPrice, currency)
        : `From ${formatMoney(row.minPrice, currency)}`;
  const status = (row: (typeof rows)[number]) =>
    row.stock === 0 ? (
      <Badge tone="red">Out</Badge>
    ) : row.low ? (
      <Badge tone="amber">Low</Badge>
    ) : (
      <Badge tone="green">OK</Badge>
    );
  const pill = (active: boolean) =>
    "rounded-full px-3 py-1.5 text-xs font-medium " +
    (active ? "bg-brand text-white" : "bg-stone-200/70 text-stone-700 hover:bg-stone-200");

  return (
    <>
      <PageHeader
        title={layout === "table" ? "Inventory" : "Products"}
        subtitle={
          layout === "table"
            ? "How many of each product you have, and what it is worth."
            : "Your products at a glance."
        }
        action={{ href: "/inventory/new", label: "Add product" }}
      />

      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex gap-1">
          {views.map((v) => (
            <Link key={v.key} href={href({ view: v.key })} className={pill(view === v.key)}>
              {v.label}
            </Link>
          ))}
        </div>
        <div className="flex gap-1 border-l border-stone-300 pl-3" aria-label="Layout">
          <Link href={href({ layout: "gallery" })} className={pill(layout === "gallery")}>
            Gallery
          </Link>
          <Link href={href({ layout: "table" })} className={pill(layout === "table")}>
            Table
          </Link>
        </div>
        <form className="ml-auto flex gap-2">
          {view && <input type="hidden" name="view" value={view} />}
          <input
            name="q"
            defaultValue={q}
            placeholder="Search name or SKU"
            className="input w-52 py-1.5"
          />
          <button className="btn-secondary btn-sm">Search</button>
        </form>
      </div>

      {rows.length === 0 ? (
        <Empty title={q || view ? "Nothing found" : "No products yet"}>
          {!q && !view && "Add your first product to start tracking stock."}
        </Empty>
      ) : (
        <>
          <dl
            data-totals
            className="card mb-2 grid grid-cols-3 gap-px overflow-hidden bg-stone-300 text-sm"
          >
            {[
              ["Products", String(totals.products)],
              ["Units in stock", String(units)],
              ["Stock value (cost)", formatMoney(value, currency)],
            ].map(([label, text]) => (
              <div key={label} className="bg-white px-3 py-1.5">
                <dt className="text-xs text-stone-500">{label}</dt>
                <dd className="font-semibold tabular-nums">{text}</dd>
              </div>
            ))}
          </dl>

          {layout === "gallery" ? (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-8">
              {rows.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/inventory/${row.id}`}
                    className="card group block overflow-hidden hover:border-stone-400"
                  >
                    <div className="relative aspect-[4/5] bg-stone-100">
                      {row.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={row.photo}
                          alt={row.name}
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      ) : (
                        <span className="flex size-full items-center justify-center text-xs text-stone-400">
                          No photo
                        </span>
                      )}
                      <span className="absolute top-2 right-2">{status(row)}</span>
                    </div>
                    <div className="px-2.5 py-2">
                      <p className="truncate text-sm font-medium group-hover:underline">
                        {row.name}
                      </p>
                      <p className="truncate text-xs text-stone-500">
                        {[
                          row.category,
                          row.colors ? `${row.colors} ${row.colors === 1 ? "color" : "colors"}` : null,
                          row.sizes ? `${row.sizes} ${row.sizes === 1 ? "size" : "sizes"}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "One item"}
                      </p>
                      <p className="flex flex-wrap items-baseline justify-between gap-x-2 pt-1 text-sm tabular-nums">
                        <span>{price(row)}</span>
                        <span className="font-semibold">{row.stock} in stock</span>
                      </p>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="card overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-stone-200">
                  <tr>
                    <th className="th">Product</th>
                    <th className="th">Category</th>
                    <th className="th">Colors</th>
                    <th className="th">Sizes</th>
                    <th className="th text-right">Price</th>
                    <th className="th text-right">Stock value</th>
                    <th className="th text-right">In stock</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {rows.map((row) => (
                    <tr key={row.id} className="hover:bg-stone-50">
                      <td className="px-4 py-2 text-sm font-medium">
                        <Link
                          href={`/inventory/${row.id}`}
                          className="flex items-center gap-3 hover:underline"
                        >
                          <span className="size-10 shrink-0 overflow-hidden rounded-md border border-stone-200 bg-stone-100">
                            {row.photo && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={row.photo}
                                alt=""
                                loading="lazy"
                                className="size-full object-cover"
                              />
                            )}
                          </span>
                          {row.name}
                        </Link>
                      </td>
                      <td className="px-4 py-2 text-sm text-stone-600">{row.category ?? "—"}</td>
                      <td className="px-4 py-2 text-sm text-stone-600 tabular-nums">
                        {row.colors || "—"}
                      </td>
                      <td className="px-4 py-2 text-sm text-stone-600 tabular-nums">
                        {row.sizes || "—"}
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-stone-600 tabular-nums">
                        {price(row)}
                      </td>
                      <td className="px-4 py-2 text-right text-sm text-stone-600 tabular-nums">
                        {formatMoney(row.value, currency)}
                      </td>
                      <td className="px-4 py-2 text-right text-sm whitespace-nowrap">
                        <span className="mr-2 font-medium tabular-nums">{row.stock}</span>
                        {status(row)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-stone-200 bg-stone-50 text-sm font-semibold">
                    <td className="px-4 py-2.5" colSpan={5}>
                      Total · {totals.products} {totals.products === 1 ? "product" : "products"}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">
                      {formatMoney(value, currency)}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{units} units</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <Pager
            page={page}
            pageSize={PAGE_SIZE}
            total={totals.products}
            href={(target) => href({ page: target })}
          />
        </>
      )}
    </>
  );
}
