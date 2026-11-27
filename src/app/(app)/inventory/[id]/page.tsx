import { and, asc, desc, eq, isNotNull, notInArray, sql } from "drizzle-orm";
import {
  Box,
  Calculator,
  ChartColumn,
  Coins,
  History,
  Package,
  PackageCheck,
  ShoppingCart,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Block, Field } from "@/components/ui";
import { db } from "@/db";
import {
  orderItems,
  orders,
  productMedia,
  products,
  stockCountLines,
  stockCounts,
  stockMovements,
  stockPurchaseLines,
  stockPurchases,
  users,
  variants,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDate, formatDateTime, formatMoney, isUuid, sortSizes, variantLabel } from "@/lib/format";
import { mediaMode, mediaOffReason } from "@/lib/media";
import { getPrefs } from "@/lib/settings";
import { addVariants, updateVariants } from "../actions";
import { ProductTop } from "./product-top";
import { PurchaseBatches } from "./purchase-batches";
import { StockGrid } from "./stock-grid";

// How each kind of stock change reads in "Recent Stock Activity".
const reasonLabel = {
  opening: "Opening stock",
  purchase: "Received stock",
  sale: "Sold",
  return: "Customer return",
  cancelled: "Order cancelled",
  damage: "Damaged / lost",
  adjustment: "Stock set from a count",
} as const;

export default async function ProductPage({ params }: PageProps<"/inventory/[id]">) {
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
    purchaseLines,
    movementTotals,
    [sales],
    categoryRows,
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
        size: variants.size,
        color: variants.color,
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
    // What each lot of stock was bought for, oldest first.
    db
      .select({
        id: stockPurchases.id,
        units: stockPurchases.units,
        totalCost: stockPurchases.totalCost,
        note: stockPurchases.note,
        createdAt: stockPurchases.createdAt,
      })
      .from(stockPurchases)
      .where(eq(stockPurchases.productId, id))
      .orderBy(asc(stockPurchases.createdAt))
      .limit(200),
    // Which sizes and colors each batch brought in.
    db
      .select({
        purchaseId: stockPurchaseLines.purchaseId,
        variantId: stockPurchaseLines.variantId,
        quantity: stockPurchaseLines.quantity,
      })
      .from(stockPurchaseLines)
      .innerJoin(stockPurchases, eq(stockPurchases.id, stockPurchaseLines.purchaseId))
      .where(eq(stockPurchases.productId, id)),
    // Every stock change ever made to this product, added up by kind.
    db
      .select({
        reason: stockMovements.reason,
        total: sql<number>`sum(${stockMovements.change})::int`,
      })
      .from(stockMovements)
      .innerJoin(variants, eq(variants.id, stockMovements.variantId))
      .where(eq(variants.productId, id))
      .groupBy(stockMovements.reason),
    // Money taken for this product on orders that were not cancelled or returned.
    db
      .select({
        revenue: sql<string>`coalesce(sum(${orderItems.quantity} * ${orderItems.unitPrice}), 0)`,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .innerJoin(variants, eq(variants.id, orderItems.variantId))
      .where(
        and(eq(variants.productId, id), notInArray(orders.status, ["cancelled", "returned"])),
      ),
    db
      .selectDistinct({ category: products.category })
      .from(products)
      .where(isNotNull(products.category)),
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

  /* ---------- The numbers ---------- */

  const moved = (reason: (typeof movementTotals)[number]["reason"]) =>
    movementTotals.find((row) => row.reason === reason)?.total ?? 0;
  // Stock that came in, stock that went out on orders (returns and cancelled
  // orders put some back), and everything else: damage and count corrections.
  const purchased = moved("opening") + moved("purchase");
  const sold = -(moved("sale") + moved("return") + moved("cancelled"));
  const other = moved("damage") + moved("adjustment");
  const available = items.reduce((sum, v) => sum + v.stock, 0);

  const priced = purchases.filter((purchase) => purchase.totalCost !== null);
  const paidTotal = priced.reduce((sum, purchase) => sum + Number(purchase.totalCost), 0);
  const paidUnits = priced.reduce((sum, purchase) => sum + purchase.units, 0);
  // What one piece cost on average: from the purchase batches when they have
  // amounts, otherwise from the cost typed on each size and color.
  const shelfCost = items.reduce((sum, v) => sum + v.stock * Number(v.cost), 0);
  const averageCost = paidUnits
    ? paidTotal / paidUnits
    : available
      ? shelfCost / available
      : Number(items[0]?.cost ?? 0);
  const inventoryValue = paidUnits ? available * averageCost : shelfCost;

  const prices = [...new Set(items.map((v) => Number(v.price)))];

  const cards = [
    {
      label: "Purchased Units",
      value: `${purchased} units`,
      icon: Box,
      tone: "bg-brand-50 border-brand-100",
      iconTone: "bg-brand-100 text-brand",
    },
    {
      label: "Units Sold",
      value: `${sold} units`,
      icon: ShoppingCart,
      tone: "bg-rose-50 border-rose-100",
      iconTone: "bg-rose-100 text-rose-600",
    },
    {
      label: "Available Stock",
      value: `${available} units`,
      icon: Package,
      tone: "bg-emerald-50 border-emerald-100",
      iconTone: "bg-emerald-100 text-emerald-600",
    },
    {
      label: "Inventory Value (at cost)",
      value: formatMoney(inventoryValue, currency),
      icon: Coins,
      tone: "bg-brand-50 border-brand-100",
      iconTone: "bg-brand-100 text-brand",
    },
  ];

  return (
    <div className="space-y-3">
      <ProductTop
        product={{
          id: product.id,
          name: product.name,
          description: product.description,
          category: product.category,
          sku: product.sku,
          archived: product.archived,
        }}
        categories={categoryRows.map((row) => row.category!).filter(Boolean)}
        price={{ value: prices.length === 1 ? String(prices[0]) : "", varies: prices.length > 1 }}
        tiers={{
          price2: product.price2 === null ? "" : String(Number(product.price2)),
          price3: product.price3 === null ? "" : String(Number(product.price3)),
          price4: product.price4 === null ? "" : String(Number(product.price4)),
        }}
        currency={currency}
        metrics={{
          averageCost: formatMoney(averageCost, currency),
          available: `${available} units`,
          purchasedValue: formatMoney(paidTotal, currency),
        }}
        media={media}
        mode={mediaMode()}
        offReason={mediaOffReason()}
      />

      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-stat-cards>
        {cards.map((card) => (
          <div key={card.label} className={"flex items-center gap-3 rounded-xl border px-4 py-3 " + card.tone}>
            <span className={"flex size-10 shrink-0 items-center justify-center rounded-lg " + card.iconTone}>
              <card.icon className="size-5" strokeWidth={1.9} />
            </span>
            <div className="min-w-0">
              <dt className="truncate text-xs font-medium text-stone-600">{card.label}</dt>
              <dd className="text-base leading-tight font-extrabold tabular-nums">{card.value}</dd>
            </div>
          </div>
        ))}
      </dl>

      <p
        data-stock-formula
        className="flex flex-wrap items-center justify-center gap-x-2 rounded-xl border border-brand-100 bg-brand-100 px-4 py-2.5 text-sm font-bold tabular-nums"
      >
        <Calculator className="size-4 text-brand" />
        <span className="text-brand">Stock Formula:</span>
        <span>
          {purchased} purchased − {sold} sold
          {other < 0 && ` − ${-other} damaged or corrected`}
          {other > 0 && ` + ${other} corrected`} = {available} available
        </span>
      </p>

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-3">
          <PurchaseBatches
            productId={product.id}
            currency={currency}
            variants={items.map((v) => ({ id: v.id, size: v.size, color: v.color, stock: v.stock }))}
            sizes={sizes}
            colors={colors}
            batches={purchases.map((purchase) => ({
              id: purchase.id,
              date: formatDate(purchase.createdAt, timezone),
              note: purchase.note,
              units: purchase.units,
              totalCost: purchase.totalCost === null ? null : Number(purchase.totalCost),
              lines: purchaseLines
                .filter((line) => line.purchaseId === purchase.id)
                .map((line) => ({ variantId: line.variantId, quantity: line.quantity })),
            }))}
          />

          <StockGrid
            productId={product.id}
            variants={items.map((v) => ({
              id: v.id,
              size: v.size,
              color: v.color,
              stock: v.stock,
              lowStockAt: v.lowStockAt,
            }))}
            sizes={sizes}
            colors={colors}
            counts={countRows.map((count) => ({
              id: count.id,
              note: count.note,
              when: formatDateTime(count.createdAt, timezone),
              by: count.by,
              applied: count.appliedAt ? formatDateTime(count.appliedAt, timezone) : null,
              lines: countLines
                .filter((line) => line.countId === count.id)
                .map(({ variantId, counted, system }) => ({ variantId, counted, system })),
            }))}
          />
        </div>

        <div className="min-w-0 space-y-3">
          <Block title="Sales Summary" icon={<ChartColumn />}>
            <dl className="space-y-2 text-sm" data-sales-summary>
              {[
                { label: "Units Sold", value: String(sold), icon: ShoppingCart },
                {
                  label: "Revenue Generated",
                  value: formatMoney(sales.revenue, currency),
                  icon: Coins,
                },
                { label: "Remaining Units", value: String(available), icon: PackageCheck },
              ].map((row) => (
                <div key={row.label} className="flex items-center gap-3">
                  <row.icon className="size-4 shrink-0 text-brand" />
                  <dt className="min-w-0 flex-1 font-semibold">{row.label}</dt>
                  <dd className="w-36 rounded-lg bg-brand-50 px-3 py-1.5 text-right font-bold tabular-nums">
                    {row.value}
                  </dd>
                </div>
              ))}
            </dl>
            <Link
              href={`/orders?product=${product.id}`}
              className="mt-3 inline-block text-xs font-semibold text-brand hover:underline"
            >
              See the orders for this product →
            </Link>
          </Block>

          <Block title="Recent Stock Activity" icon={<History />} flush>
            <div className="max-h-96 overflow-y-auto px-4 pb-3" data-activity>
              {history.length === 0 && (
                <p className="py-2 text-sm text-stone-500">No stock changes yet.</p>
              )}
              {history.map((h) => (
                <div
                  key={h.id}
                  className="flex items-center gap-3 border-b border-stone-100 py-2 text-xs last:border-0"
                >
                  <span
                    className={
                      "w-12 shrink-0 rounded-md py-0.5 text-center text-sm font-bold tabular-nums " +
                      (h.change > 0
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-rose-50 text-rose-700")
                    }
                  >
                    {h.change > 0 ? "+" : ""}
                    {h.change}
                  </span>
                  <span className="w-32 shrink-0 text-sm font-bold">{reasonLabel[h.reason]}</span>
                  <span className="min-w-0 flex-1 truncate border-l border-stone-200 pl-3 text-stone-600">
                    {variantLabel(h)}
                    {h.note ? ` · ${h.note}` : ""}
                  </span>
                  <span className="shrink-0 text-right text-stone-500">
                    {formatDateTime(h.createdAt, timezone)}
                  </span>
                </div>
              ))}
            </div>
          </Block>
        </div>
      </div>

      {/* Less-used tools, kept out of the way until opened. */}
      <details className="card group" data-prices>
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold">
          Prices, SKUs and low-stock alerts for each size and color
          <span className="text-xs font-semibold text-brand group-open:hidden">Open</span>
          <span className="hidden text-xs font-semibold text-brand group-open:inline">Close</span>
        </summary>
        <ActionForm
          action={updateVariants.bind(null, product.id)}
          submit="Save changes"
          submitClassName="btn btn-sm"
          footerClassName="flex flex-row-reverse items-center justify-between gap-3 px-4 py-3"
        >
          <div className="overflow-x-auto px-4">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="th rounded-l-lg">Color</th>
                  <th className="th">Size</th>
                  <th className="th">SKU</th>
                  <th className="th text-right">Price</th>
                  <th className="th text-right">Cost</th>
                  <th className="th text-right whitespace-nowrap">Alert at</th>
                  <th className="th rounded-r-lg text-right">Stock</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {items.map((v) => (
                  <tr key={v.id}>
                    <td className="w-28 p-0.5">
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
                    <td className="w-16 px-3 py-1.5 text-right tabular-nums">{v.stock}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="bg-brand-100 font-bold">
                  <td className="rounded-l-lg px-3 py-2" colSpan={6}>
                    Total · {items.length} {items.length === 1 ? "item" : "items"}
                  </td>
                  <td className="rounded-r-lg px-3 py-2 text-right tabular-nums">{available}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </ActionForm>
      </details>

      <details className="card group" data-add-variant>
        <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-bold">
          Add a size or color
          <span className="text-xs font-semibold text-brand group-open:hidden">Open</span>
          <span className="hidden text-xs font-semibold text-brand group-open:inline">Close</span>
        </summary>
        <div className="px-4 pb-4">
          <ActionForm
            action={addVariants.bind(null, product.id)}
            submit="Add"
            submitClassName="btn btn-sm"
            className="grid grid-cols-3 items-end gap-3 sm:grid-cols-[1fr_1fr_6rem_auto]"
            footerClassName="max-sm:col-span-3 flex flex-wrap items-center gap-3 sm:flex-row-reverse sm:pb-0.5"
          >
            <Field label="New size">
              <input name="size" placeholder="XL" className="input" />
            </Field>
            <Field label="New color">
              <input name="color" placeholder="Navy" className="input" />
            </Field>
            <Field label="Stock each">
              <input name="stock" inputMode="numeric" defaultValue="0" className="input" />
            </Field>
          </ActionForm>
          <p className="mt-2 text-xs text-stone-500">
            A new size is added to every color, and a new color gets every size.
            Fill in both to add just that one.
          </p>
        </div>
      </details>
    </div>
  );
}
