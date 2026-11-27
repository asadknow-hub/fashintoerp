import { asc, eq, sql } from "drizzle-orm";
import { ShoppingCart } from "lucide-react";
import { FreshOnVisit } from "@/components/fresh-on-visit";
import { db } from "@/db";
import { productMedia, products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { sortSizes } from "@/lib/format";
import { getPrefs } from "@/lib/settings";
import { OrderForm, type OrderProduct } from "./order-form";

export default async function NewOrderPage({
  searchParams,
}: PageProps<"/orders/new">) {
  const [, params, { currency }, rows] = await Promise.all([
    requireUser(),
    searchParams,
    getPrefs(),
    db
      .select({
        id: variants.id,
        productId: products.id,
        name: products.name,
        category: products.category,
        price2: products.price2,
        price3: products.price3,
        price4: products.price4,
        sku: variants.sku,
        size: variants.size,
        color: variants.color,
        price: variants.price,
        stock: variants.stock,
        photo: sql<string | null>`(
          select coalesce(${productMedia.thumbUrl}, ${productMedia.url}) from ${productMedia}
          where ${productMedia.productId} = ${products.id}
            and (${productMedia.kind} = 'image' or ${productMedia.thumbUrl} is not null)
          order by (${productMedia.tag} = 'Main photo') desc,
            (${productMedia.kind} = 'image') desc, ${productMedia.createdAt}
          limit 1
        )`,
      })
      .from(variants)
      .innerJoin(products, eq(products.id, variants.productId))
      .where(eq(products.archived, false))
      .orderBy(asc(products.name), asc(variants.createdAt), asc(variants.sku)),
  ]);
  const param = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";

  // Group the sellable items under their product.
  const byProduct = new Map<string, OrderProduct>();
  for (const row of rows) {
    const product = byProduct.get(row.productId) ?? {
      id: row.productId,
      name: row.name,
      category: row.category,
      photo: row.photo,
      price2: row.price2 === null ? null : Number(row.price2),
      price3: row.price3 === null ? null : Number(row.price3),
      price4: row.price4 === null ? null : Number(row.price4),
      colors: [],
      sizes: [],
      variants: [],
    };
    if (!product.colors.includes(row.color)) product.colors.push(row.color);
    if (!product.sizes.includes(row.size)) product.sizes.push(row.size);
    product.variants.push({
      id: row.id,
      sku: row.sku,
      size: row.size,
      color: row.color,
      price: Number(row.price),
      stock: row.stock,
    });
    byProduct.set(row.productId, product);
  }
  const catalog = [...byProduct.values()].map((product) => ({
    ...product,
    sizes: sortSizes(product.sizes),
  }));

  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-xl bg-brand-100 text-brand">
          <ShoppingCart className="size-7" strokeWidth={1.9} />
        </span>
        <div>
          <h1 className="text-2xl leading-tight font-extrabold tracking-tight">
            Create Order (Sales)
          </h1>
          <p className="text-sm text-stone-600">
            Take a new order with customer and product details.
          </p>
        </div>
      </div>
      <FreshOnVisit>
        <OrderForm
          currency={currency}
          products={catalog}
          defaults={{
            name: param("name"),
            phone: param("phone"),
            conversationId: param("conversation"),
            source: param("source"),
          }}
        />
      </FreshOnVisit>
    </div>
  );
}
