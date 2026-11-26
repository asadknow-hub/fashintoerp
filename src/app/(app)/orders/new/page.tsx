import { asc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { FreshOnVisit } from "@/components/fresh-on-visit";
import { PageHeader } from "@/components/ui";
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
      <PageHeader
        title="New order"
        subtitle="Pick the product, then its color and size. Stock is checked as you go."
      />
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
      <Link href="/orders" className="mt-3 inline-block text-sm text-stone-600 hover:underline">
        ← Back to orders
      </Link>
    </div>
  );
}
