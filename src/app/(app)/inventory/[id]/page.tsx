import { asc, desc, eq, inArray } from "drizzle-orm";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { Badge, Field, stockTone } from "@/components/ui";
import { db } from "@/db";
import { products, stockMovements, users, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { formatDateTime, formatMoney, isUuid, variantLabel } from "@/lib/format";
import { getPrefs } from "@/lib/settings";
import {
  addVariant,
  adjustStock,
  setArchived,
  updateProduct,
  updateVariant,
} from "../actions";

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
  const items = await db
    .select()
    .from(variants)
    .where(eq(variants.productId, id))
    .orderBy(asc(variants.color), asc(variants.createdAt));

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
        .limit(30)
    : [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/inventory" className="text-sm text-stone-500 hover:underline">
            ← Inventory
          </Link>
          <h1 className="mt-1 flex items-center gap-2 text-xl font-semibold tracking-tight">
            {product.name}
            {product.archived && <Badge>Archived</Badge>}
          </h1>
        </div>
        <form action={setArchived.bind(null, product.id, !product.archived)}>
          <button className="btn-secondary btn-sm">
            {product.archived ? "Restore product" : "Archive product"}
          </button>
        </form>
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold">Sizes & colors</h2>
        {items.map((v) => (
          <details key={v.id} className="card group">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
              <span className="min-w-32 font-medium">{variantLabel(v)}</span>
              <span className="font-mono text-xs text-stone-500">{v.sku}</span>
              <span className="text-sm text-stone-600">
                {formatMoney(v.price, currency)}
              </span>
              <span className="ml-auto flex items-center gap-2">
                <Badge tone={stockTone(v.stock, v.lowStockAt)}>
                  {v.stock} in stock
                </Badge>
                <span className="text-xs text-stone-500 group-open:hidden">
                  Edit
                </span>
                <span className="hidden text-xs text-stone-500 group-open:inline">
                  Close
                </span>
              </span>
            </summary>
            <div className="grid gap-6 border-t border-stone-100 p-4 lg:grid-cols-2">
              <ActionForm
                action={adjustStock.bind(null, v.id)}
                submit="Update stock"
                className="space-y-3"
              >
                <h3 className="text-sm font-semibold">Change stock</h3>
                <div className="grid gap-3 sm:grid-cols-[1fr_7rem]">
                  <Field label="What happened?">
                    <select name="kind" className="input" defaultValue="received">
                      <option value="received">New stock received (add)</option>
                      <option value="returned">Customer return (add)</option>
                      <option value="damaged">Damaged or lost (remove)</option>
                      <option value="recount">Recount (set exact number)</option>
                    </select>
                  </Field>
                  <Field label="Quantity">
                    <input
                      name="quantity"
                      inputMode="numeric"
                      required
                      className="input"
                    />
                  </Field>
                </div>
                <Field label="Note (optional)">
                  <input name="note" className="input" />
                </Field>
              </ActionForm>

              <ActionForm
                action={updateVariant.bind(null, v.id)}
                submit="Save details"
                submitClassName="btn-secondary"
                className="space-y-3"
              >
                <h3 className="text-sm font-semibold">Details</h3>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <Field label="Size">
                    <input name="size" defaultValue={v.size ?? ""} className="input" />
                  </Field>
                  <Field label="Color">
                    <input name="color" defaultValue={v.color ?? ""} className="input" />
                  </Field>
                  <Field label="SKU">
                    <input name="sku" defaultValue={v.sku} required className="input" />
                  </Field>
                  <Field label="Selling price">
                    <input
                      name="price"
                      inputMode="decimal"
                      defaultValue={Number(v.price)}
                      className="input"
                    />
                  </Field>
                  <Field label="Your cost">
                    <input
                      name="cost"
                      inputMode="decimal"
                      defaultValue={Number(v.cost)}
                      className="input"
                    />
                  </Field>
                  <Field label="Low stock alert">
                    <input
                      name="lowStockAt"
                      inputMode="numeric"
                      defaultValue={v.lowStockAt}
                      className="input"
                    />
                  </Field>
                </div>
              </ActionForm>
            </div>
          </details>
        ))}

        <details className="card">
          <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-stone-700">
            + Add another size or color
          </summary>
          <ActionForm
            action={addVariant.bind(null, product.id)}
            submit="Add"
            className="space-y-3 border-t border-stone-100 p-4"
          >
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              <Field label="Size">
                <input name="size" className="input" />
              </Field>
              <Field label="Color">
                <input name="color" className="input" />
              </Field>
              <Field label="Selling price">
                <input
                  name="price"
                  inputMode="decimal"
                  defaultValue={items[0] ? Number(items[0].price) : ""}
                  className="input"
                />
              </Field>
              <Field label="Your cost">
                <input
                  name="cost"
                  inputMode="decimal"
                  defaultValue={items[0] ? Number(items[0].cost) : ""}
                  className="input"
                />
              </Field>
              <Field label="Stock">
                <input name="stock" inputMode="numeric" defaultValue="0" className="input" />
              </Field>
            </div>
          </ActionForm>
        </details>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-semibold">Product details</h2>
          <ActionForm
            action={updateProduct.bind(null, product.id)}
            submit="Save"
            submitClassName="btn-secondary"
            className="card space-y-3 p-4"
          >
            <Field label="Name">
              <input name="name" defaultValue={product.name} required className="input" />
            </Field>
            <Field label="Category">
              <input name="category" defaultValue={product.category ?? ""} className="input" />
            </Field>
            <Field label="Description">
              <textarea
                name="description"
                defaultValue={product.description ?? ""}
                rows={3}
                className="input"
              />
            </Field>
          </ActionForm>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-semibold">Stock history</h2>
          <div className="card divide-y divide-stone-100">
            {history.length === 0 && (
              <p className="p-4 text-sm text-stone-500">No stock changes yet.</p>
            )}
            {history.map((h) => (
              <div key={h.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                <span
                  className={
                    "w-12 shrink-0 font-medium tabular-nums " +
                    (h.change > 0 ? "text-emerald-700" : "text-rose-700")
                  }
                >
                  {h.change > 0 ? "+" : ""}
                  {h.change}
                </span>
                <span className="min-w-0 flex-1">
                  {reasonLabel[h.reason]}
                  <span className="ml-2 font-mono text-xs text-stone-500">{h.sku}</span>
                  {h.note && <span className="block text-xs text-stone-500">{h.note}</span>}
                </span>
                <span className="shrink-0 text-right text-xs text-stone-500">
                  {formatDateTime(h.createdAt, timezone)}
                  {h.userName && <span className="block">{h.userName}</span>}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
