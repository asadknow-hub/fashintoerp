import { asc, desc, eq } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Block, Field } from "@/components/ui";
import { db } from "@/db";
import {
  productMedia,
  products,
  stockCountLines,
  stockCounts,
  stockMovements,
  stockPurchases,
  users,
  variants,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatMoney, isUuid, sortSizes } from "@/lib/format";
import { mediaMode, mediaOffReason } from "@/lib/media";
import { getPrefs } from "@/lib/settings";
import {
  addPurchase,
  addVariants,
  deletePurchase,
  setArchived,
  updateProduct,
  updatePurchase,
  updateVariants,
} from "../actions";
import { MediaBlock } from "./media-block";
import { StockGrid } from "./stock-grid";
import { SubmitButton } from "@/components/submit-button";

const reasonLabel = {
  opening: "Opening stock",
  purchase: "Stock received",
  sale: "Order",
  return: "Customer return",
  cancelled: "Order cancelled",
  damage: "Damaged / lost",
  adjustment: "Stock set from a count",
} as const;

export default async function ProductPage({
  params,
}: PageProps<"/inventory/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!isUuid(id)) notFound();

  // Everything this page needs, fetched at the same time.
  const [
    [product],
    { currency, timezone },
    rows,
    media,
    history,
    countRows,
    countLines,
    purchases,
  ] = await Promise.all([
    db.select().from(products).where(eq(products.id, id)),
    getPrefs(),
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
        thumbUrl: productMedia.thumbUrl,
        tag: productMedia.tag,
        fileName: productMedia.fileName,
      })
      .from(productMedia)
      .where(eq(productMedia.productId, id))
      .orderBy(asc(productMedia.createdAt)),
    db
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
      .where(eq(variants.productId, id))
      .orderBy(desc(stockMovements.createdAt))
      .limit(40),
    // Saved fresh counts, newest first, and what was counted in each.
    db
      .select({
        id: stockCounts.id,
        note: stockCounts.note,
        createdAt: stockCounts.createdAt,
        appliedAt: stockCounts.appliedAt,
        by: users.name,
      })
      .from(stockCounts)
      .leftJoin(users, eq(users.id, stockCounts.createdBy))
      .where(eq(stockCounts.productId, id))
      .orderBy(desc(stockCounts.createdAt))
      .limit(20),
    db
      .select({
        countId: stockCountLines.countId,
        variantId: stockCountLines.variantId,
        counted: stockCountLines.counted,
        system: stockCountLines.systemStock,
      })
      .from(stockCountLines)
      .innerJoin(stockCounts, eq(stockCounts.id, stockCountLines.countId))
      .where(eq(stockCounts.productId, id)),
    // What each lot of stock was bought for, newest first.
    db
      .select({
        id: stockPurchases.id,
        units: stockPurchases.units,
        totalCost: stockPurchases.totalCost,
        note: stockPurchases.note,
        createdAt: stockPurchases.createdAt,
        by: users.name,
      })
      .from(stockPurchases)
      .leftJoin(users, eq(users.id, stockPurchases.createdBy))
      .where(eq(stockPurchases.productId, id))
      .orderBy(desc(stockPurchases.createdAt))
      .limit(100),
  ]);
  if (!product) notFound();

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
  const retailValue = items.reduce(
    (sum, v) => sum + v.stock * Number(v.price),
    0,
  );
  const out = items.filter((v) => v.stock <= 0).length;
  const low = items.filter(
    (v) => v.stock > 0 && v.stock <= v.lowStockAt,
  ).length;

  const priced = purchases.filter((purchase) => purchase.totalCost !== null);
  const paidTotal = priced.reduce((sum, purchase) => sum + Number(purchase.totalCost), 0);
  const paidPieces = priced.reduce((sum, purchase) => sum + purchase.units, 0);
  const unpriced = purchases.length - priced.length;

  const stats = [
    { label: "In stock", value: `${units} units` },
    {
      label: "Paid for stock (total)",
      value: priced.length ? formatMoney(paidTotal, currency) : "Not recorded",
      tone: priced.length ? "" : "text-stone-400",
    },
    { label: "Stock value (cost)", value: formatMoney(costValue, currency) },
    {
      label: "Stock value (selling)",
      value: formatMoney(retailValue, currency),
    },
    {
      label: "Needs attention",
      value: out || low ? `${out} out · ${low} low` : "All good",
      tone: out ? "text-rose-700" : low ? "text-amber-700" : "text-emerald-700",
    },
  ];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-stone-900 pb-2">
        <div className="min-w-0">
          <Link
            href="/inventory"
            className="text-xs text-stone-500 hover:underline"
          >
            ← Inventory
          </Link>
          <h1 className="flex items-center gap-2 text-xl leading-tight font-bold tracking-tight">
            <span className="truncate">{product.name}</span>
            {product.archived && <Badge>Archived</Badge>}
          </h1>
          <p className="text-xs text-stone-500">
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
          <SubmitButton>
            {product.archived ? "Restore product" : "Archive product"}
          </SubmitButton>
        </form>
      </div>

      <dl className="card grid grid-cols-2 gap-px overflow-hidden bg-stone-300 lg:grid-cols-5">
        {stats.map((stat) => (
          <div
            key={stat.label}
            className="bg-white px-3 py-1.5 max-lg:last:col-span-2"
          >
            <dt className="text-xs text-stone-500">{stat.label}</dt>
            <dd
              className={
                "mt-0.5 text-base font-semibold tabular-nums " +
                (stat.tone ?? "")
              }
            >
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_19rem] 2xl:grid-cols-[19rem_minmax(0,1fr)_21rem]">
        <div className="min-w-0 space-y-3 lg:col-start-1 lg:row-span-2 lg:row-start-1 2xl:col-start-2 2xl:row-span-1">
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
            productId={product.id}
            currency={currency}
            counts={countRows.map((count) => ({
              id: count.id,
              note: count.note,
              when: formatDateTime(count.createdAt, timezone),
              by: count.by,
              applied: count.appliedAt
                ? formatDateTime(count.appliedAt, timezone)
                : null,
              lines: countLines
                .filter((line) => line.countId === count.id)
                .map(({ variantId, counted, system }) => ({
                  variantId,
                  counted,
                  system,
                })),
            }))}
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
                      <th className="px-2 py-2 text-right font-medium">
                        Price
                      </th>
                      <th className="px-2 py-2 text-right font-medium">Cost</th>
                      <th className="px-2 py-2 text-right font-medium whitespace-nowrap">
                        Alert at
                      </th>
                      <th className="py-2 pr-4 pl-2 text-right font-medium">
                        Stock
                      </th>
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
                        <td className="w-16 py-1.5 pr-4 pl-2 text-right tabular-nums">
                          {v.stock}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-stone-200 bg-stone-50 font-semibold">
                      <td className="py-2 pr-2 pl-4" colSpan={6}>
                        Total · {items.length}{" "}
                        {items.length === 1 ? "item" : "items"}
                      </td>
                      <td className="py-2 pr-4 pl-2 text-right tabular-nums">
                        {units}
                      </td>
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
                <input
                  name="color"
                  placeholder="Navy"
                  className="input py-1.5"
                />
              </Field>
              <Field label="Stock each">
                <input
                  name="stock"
                  inputMode="numeric"
                  defaultValue="0"
                  className="input py-1.5"
                />
              </Field>
            </ActionForm>
            <p className="mt-2 text-xs text-stone-500">
              A new size is added to every color, and a new color gets every
              size. Fill in both to add just that one.
            </p>
          </Block>
        </div>

        <div className="min-w-0 lg:col-start-2 lg:row-start-1 2xl:col-start-1">
          <MediaBlock
            productId={product.id}
            items={media}
            mode={mediaMode()}
            offReason={mediaOffReason()}
          />
        </div>

        <div className="min-w-0 space-y-3 lg:col-start-2 lg:row-start-2 2xl:col-start-3 2xl:row-start-1">
          <Block title="Details">
            <ActionForm
              action={updateProduct.bind(null, product.id)}
              submit="Save"
              submitClassName="btn-secondary btn-sm"
              className="space-y-3"
            >
              <Field label="Name">
                <input
                  name="name"
                  defaultValue={product.name}
                  required
                  className="input py-1.5"
                />
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

          <Block
            title="What the stock was bought for"
            flush
            aside={
              <span className="text-xs text-stone-600 tabular-nums">
                {priced.length
                  ? `${formatMoney(paidTotal, currency)} for ${paidPieces} pieces`
                  : "Nothing recorded yet"}
              </span>
            }
          >
            <div className="divide-y divide-stone-100" data-purchases>
              {unpriced > 0 && (
                <p className="bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
                  {unpriced} {unpriced === 1 ? "lot has" : "lots have"} no amount yet. Open it and
                  type what you paid.
                </p>
              )}
              {purchases.map((purchase) => (
                <details key={purchase.id} data-purchase className="group">
                  <summary className="flex cursor-pointer list-none items-start gap-2 px-3 py-1.5 text-xs hover:bg-stone-50">
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm">{purchase.note ?? "Stock"}</span>
                      <span className="text-stone-500">
                        {formatDateTime(purchase.createdAt, timezone)}
                        {purchase.by ? ` · ${purchase.by}` : ""}
                      </span>
                    </span>
                    <span className="shrink-0 text-right tabular-nums">
                      {purchase.totalCost === null ? (
                        <span className="text-sm font-semibold text-amber-700">Not recorded</span>
                      ) : (
                        <span className="block text-sm font-semibold">
                          {formatMoney(purchase.totalCost, currency)}
                        </span>
                      )}
                      <span className="text-stone-500">
                        {purchase.units} pcs
                        {purchase.totalCost !== null &&
                          ` · ${formatMoney(Number(purchase.totalCost) / purchase.units, currency)} each`}
                      </span>
                    </span>
                    <span className="mt-0.5 shrink-0 text-stone-400 group-open:hidden">Edit</span>
                    <span className="mt-0.5 hidden shrink-0 text-stone-400 group-open:inline">
                      Close
                    </span>
                  </summary>
                  <div className="space-y-2 bg-stone-50 px-3 py-2">
                    <ActionForm
                      action={updatePurchase.bind(null, purchase.id)}
                      submit="Save"
                      submitClassName="btn btn-sm"
                      className="grid grid-cols-2 gap-2"
                      footerClassName="col-span-2 flex items-center gap-2"
                    >
                      <Field label="Total paid">
                        <input
                          name="totalPaid"
                          inputMode="decimal"
                          defaultValue={
                            purchase.totalCost === null ? "" : Number(purchase.totalCost)
                          }
                          className="input"
                        />
                      </Field>
                      <Field label="Pieces">
                        <input
                          name="units"
                          inputMode="numeric"
                          defaultValue={purchase.units}
                          className="input"
                        />
                      </Field>
                      <Field label="Note" className="col-span-2">
                        <input name="note" defaultValue={purchase.note ?? ""} className="input" />
                      </Field>
                    </ActionForm>
                    <ActionForm
                      action={deletePurchase.bind(null, purchase.id)}
                      submit="Delete this record"
                      submitClassName="cursor-pointer text-xs text-rose-700 underline"
                      confirm="Delete this cost record? Stock will not change."
                    />
                  </div>
                </details>
              ))}
              <details className="group">
                <summary className="cursor-pointer list-none px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50">
                  + Record what stock cost
                </summary>
                <ActionForm
                  action={addPurchase.bind(null, product.id)}
                  submit="Save"
                  submitClassName="btn btn-sm"
                  className="grid grid-cols-2 gap-2 bg-stone-50 px-3 py-2"
                  footerClassName="col-span-2 flex items-center gap-2"
                >
                  <Field label="Total paid">
                    <input name="totalPaid" inputMode="decimal" required className="input" />
                  </Field>
                  <Field label="For how many pieces">
                    <input
                      name="units"
                      inputMode="numeric"
                      defaultValue={units || ""}
                      required
                      className="input"
                    />
                  </Field>
                  <Field label="Note" className="col-span-2">
                    <input name="note" placeholder="Supplier, invoice…" className="input" />
                  </Field>
                  <p className="col-span-2 text-[11px] text-stone-500">
                    This only records the money. It does not add or remove stock.
                  </p>
                </ActionForm>
              </details>
            </div>
          </Block>

          <Block title="Stock history" flush>
            <div className="max-h-96 divide-y divide-stone-100 overflow-y-auto">
              {history.length === 0 && (
                <p className="p-4 text-sm text-stone-500">
                  No stock changes yet.
                </p>
              )}
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-start gap-2 px-3 py-1.5 text-xs"
                >
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
                    <span className="block truncate font-mono text-stone-500">
                      {h.sku}
                    </span>
                    {h.note && (
                      <span className="block text-stone-500">{h.note}</span>
                    )}
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
