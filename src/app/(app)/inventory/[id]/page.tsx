import { asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Block, Field } from "@/components/ui";
import { db } from "@/db";
import { productMedia, products, stockMovements, users, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatMoney, isUuid, sortSizes } from "@/lib/format";
import { mediaMode, mediaOffReason } from "@/lib/media";
import { getPrefs } from "@/lib/settings";
import {
  addVariants,
  adjustStockGrid,
  setArchived,
  updateProduct,
  updateVariants,
} from "../actions";
import { MediaBlock } from "./media-block";
import { StockGrid } from "./stock-grid";

const reasonLabel = {
  opening: "Opening stock",
  purchase: "Stock received",
  sale: "Order",
  return: "Customer return",
  cancelled: "Order cancelled",
  damage: "Damaged / lost",
  adjustment: "Recount",
} as const;

export default async function ProductPage({
  params,
}: PageProps<"/inventory/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const [product] = await db.select().from(products).where(eq(products.id, id));
  if (!product) notFound();

  const { currency, timezone } = await getPrefs();
  const [rows, media] = await Promise.all([
    db
      .select()
      .from(variants)
      .where(eq(variants.productId, id))
      .orderBy(asc(variants.createdAt), asc(variants.sku)),
    db
      .select({
        id: productMedia.id,
        kind: productMedia.kind,
        url: productMedia.url,
        tag: productMedia.tag,
        fileName: productMedia.fileName,
      })
      .from(productMedia)
      .where(eq(productMedia.productId, id))
      .orderBy(asc(productMedia.createdAt)),
  ]);

  // Colors in the order they were added, sizes in S-M-L order.
  const colors = [...new Set(rows.map((v) => v.color))];
  const sizes = sortSizes([...new Set(rows.map((v) => v.size))]);
  const items = [...rows].sort(
    (a, b) =>
      colors.indexOf(a.color) - colors.indexOf(b.color) ||
      sizes.indexOf(a.size) - sizes.indexOf(b.size),
  );

  const units = items.reduce((sum, v) => sum + v.stock, 0);
  const costValue = items.reduce((sum, v) => sum + v.stock * Number(v.cost), 0);
  const retailValue = items.reduce((sum, v) => sum + v.stock * Number(v.price), 0);
  const out = items.filter((v) => v.stock <= 0).length;
  const low = items.filter((v) => v.stock > 0 && v.stock <= v.lowStockAt).length;

  const history = items.length
    ? await db
        .select({
          id: stockMovements.id,
          change: stockMovements.change,
          reason: stockMovements.reason,
          note: stockMovements.note,
          createdAt: stockMovements.createdAt,
          sku: variants.sku,
          userName: users.name,
        })
        .from(stockMovements)
        .innerJoin(variants, eq(variants.id, stockMovements.variantId))
        .leftJoin(users, eq(users.id, stockMovements.userId))
        .where(
          inArray(
            stockMovements.variantId,
            items.map((v) => v.id),
          ),
        )
        .orderBy(desc(stockMovements.createdAt))
        .limit(40)
    : [];

  const stats = [
    { label: "In stock", value: `${units} units` },
    { label: "Stock value (cost)", value: formatMoney(costValue, currency) },
    { label: "Stock value (selling)", value: formatMoney(retailValue, currency) },
    {
      label: "Needs attention",
      value: out || low ? `${out} out · ${low} low` : "All good",
      tone: out ? "text-rose-700" : low ? "text-amber-700" : "text-emerald-700",
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <Link href="/inventory" className="text-xs text-stone-500 hover:underline">
            ← Inventory
          </Link>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
            <span className="truncate">{product.name}</span>
            {product.archived && <Badge>Archived</Badge>}
          </h1>
          <p className="text-sm text-stone-500">
            {[
              product.category,
              `${colors.length} ${colors.length === 1 ? "color" : "colors"}`,
              `${sizes.length} ${sizes.length === 1 ? "size" : "sizes"}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <form action={setArchived.bind(null, product.id, !product.archived)}>
          <button className="btn-secondary btn-sm">
            {product.archived ? "Restore product" : "Archive product"}
          </button>
        </form>
      </div>

      <dl className="card grid grid-cols-2 gap-px overflow-hidden bg-stone-200 lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-white px-4 py-3">
            <dt className="text-xs text-stone-500">{stat.label}</dt>
            <dd className={"mt-0.5 text-base font-semibold tabular-nums " + (stat.tone ?? "")}>
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-4">
          <StockGrid
            variants={items.map((v) => ({
              id: v.id,
              size: v.size,
              color: v.color,
              stock: v.stock,
              lowStockAt: v.lowStockAt,
            }))}
            sizes={sizes}
            colors={colors}
            action={adjustStockGrid.bind(null, product.id)}
          />

          <Block title="Prices & codes" flush>
            <ActionForm
              action={updateVariants.bind(null, product.id)}
              submit="Save changes"
              submitClassName="btn btn-sm"
              footerClassName="flex flex-row-reverse items-center justify-between gap-3 border-t border-stone-200 px-4 py-2.5"
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-stone-200 text-left text-xs text-stone-500">
                      <th className="py-2 pr-2 pl-4 font-medium">Color</th>
                      <th className="px-2 py-2 font-medium">Size</th>
                      <th className="px-2 py-2 font-medium">SKU</th>
                      <th className="px-2 py-2 text-right font-medium">Price</th>
                      <th className="px-2 py-2 text-right font-medium">Cost</th>
                      <th className="px-2 py-2 text-right font-medium whitespace-nowrap">Alert at</th>
                      <th className="py-2 pr-4 pl-2 text-right font-medium">Stock</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-100">
                    {items.map((v) => (
                      <tr key={v.id}>
                        <td className="w-28 py-0.5 pr-0.5 pl-2">
                          <input
                            name={`color:${v.id}`}
                            defaultValue={v.color ?? ""}
                            aria-label="Color"
                            placeholder="—"
                            className="cell font-medium"
                          />
                        </td>
                        <td className="w-16 p-0.5">
                          <input
                            name={`size:${v.id}`}
                            defaultValue={v.size ?? ""}
                            aria-label="Size"
                            placeholder="—"
                            className="cell"
                          />
                        </td>
                        <td className="min-w-36 p-0.5">
                          <input
                            name={`sku:${v.id}`}
                            defaultValue={v.sku}
                            aria-label="SKU"
                            required
                            className="cell font-mono text-xs"
                          />
                        </td>
                        <td className="w-20 p-0.5">
                          <input
                            name={`price:${v.id}`}
                            defaultValue={Number(v.price)}
                            aria-label="Price"
                            inputMode="decimal"
                            className="cell text-right tabular-nums"
                          />
                        </td>
                        <td className="w-20 p-0.5">
                          <input
                            name={`cost:${v.id}`}
                            defaultValue={Number(v.cost)}
                            aria-label="Cost"
                            inputMode="decimal"
                            className="cell text-right tabular-nums"
                          />
                        </td>
                        <td className="w-16 p-0.5">
                          <input
                            name={`low:${v.id}`}
                            defaultValue={v.lowStockAt}
                            aria-label="Low stock alert"
                            inputMode="numeric"
                            className="cell text-right tabular-nums"
                          />
                        </td>
                        <td className="w-16 py-1.5 pr-4 pl-2 text-right tabular-nums">{v.stock}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-stone-200 bg-stone-50 font-semibold">
                      <td className="py-2 pr-2 pl-4" colSpan={6}>
                        Total · {items.length} {items.length === 1 ? "item" : "items"}
                      </td>
                      <td className="py-2 pr-4 pl-2 text-right tabular-nums">{units}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </ActionForm>
          </Block>

          <Block title="Add a size or color">
            <ActionForm
              action={addVariants.bind(null, product.id)}
              submit="Add"
              submitClassName="btn btn-sm"
              className="grid grid-cols-3 items-end gap-3 sm:grid-cols-[1fr_1fr_6rem_auto]"
              footerClassName="max-sm:col-span-3 flex flex-wrap items-center gap-3 sm:flex-row-reverse sm:pb-0.5"
            >
              <Field label="New size">
                <input name="size" placeholder="XL" className="input py-1.5" />
              </Field>
              <Field label="New color">
                <input name="color" placeholder="Navy" className="input py-1.5" />
              </Field>
              <Field label="Stock each">
                <input name="stock" inputMode="numeric" defaultValue="0" className="input py-1.5" />
              </Field>
            </ActionForm>
            <p className="mt-2 text-xs text-stone-500">
              A new size is added to every color, and a new color gets every
              size. Fill in both to add just that one.
            </p>
          </Block>
        </div>

        <div className="min-w-0 space-y-4">
          <MediaBlock
            productId={product.id}
            items={media}
            mode={mediaMode()}
            offReason={mediaOffReason()}
          />

          <Block title="Details">
            <ActionForm
              action={updateProduct.bind(null, product.id)}
              submit="Save"
              submitClassName="btn-secondary btn-sm"
              className="space-y-3"
            >
              <Field label="Name">
                <input name="name" defaultValue={product.name} required className="input py-1.5" />
              </Field>
              <Field label="Category">
                <input
                  name="category"
                  defaultValue={product.category ?? ""}
                  className="input py-1.5"
                />
              </Field>
              <Field label="Description">
                <textarea
                  name="description"
                  defaultValue={product.description ?? ""}
                  rows={3}
                  className="input py-1.5"
                />
              </Field>
            </ActionForm>
          </Block>

          <Block title="Stock history" flush>
            <div className="max-h-80 divide-y divide-stone-100 overflow-y-auto">
              {history.length === 0 && (
                <p className="p-4 text-sm text-stone-500">No stock changes yet.</p>
              )}
              {history.map((h) => (
                <div key={h.id} className="flex items-start gap-2 px-4 py-2 text-xs">
                  <span
                    className={
                      "w-9 shrink-0 text-sm font-semibold tabular-nums " +
                      (h.change > 0 ? "text-emerald-700" : "text-rose-700")
                    }
                  >
                    {h.change > 0 ? "+" : ""}
                    {h.change}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-sm">{reasonLabel[h.reason]}</span>
                    <span className="block truncate font-mono text-stone-500">{h.sku}</span>
                    {h.note && <span className="block text-stone-500">{h.note}</span>}
                  </span>
                  <span className="shrink-0 text-right text-stone-500">
                    {formatDateTime(h.createdAt, timezone)}
                    {h.userName && <span className="block">{h.userName}</span>}
                  </span>
                </div>
              ))}
            </div>
          </Block>
        </div>
      </div>
    </div>
  );
}
