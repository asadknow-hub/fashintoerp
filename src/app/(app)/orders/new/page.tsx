import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import { ShoppingCart } from "lucide-react";
import { FreshOnVisit } from "@/components/fresh-on-visit";
import { db } from "@/db";
import { customers, orders, productMedia, products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isUuid, orderName, sortSizes } from "@/lib/format";
import { getPrefs } from "@/lib/settings";
import { OrderForm, type OrderProduct } from "./order-form";

export default async function NewOrderPage({
  searchParams,
}: PageProps<"/orders/new">) {
  const [, params, { currency, timezone }, used, [lastRef], rows] = await Promise.all([
    requireUser(),
    searchParams,
    getPrefs(),
    // Instructions typed on earlier orders, most used first.
    db
      .select({ text: orders.instruction })
      .from(orders)
      .where(isNotNull(orders.instruction))
      .groupBy(orders.instruction)
      .orderBy(desc(sql`count(*)`), asc(orders.instruction))
      .limit(12),
    // The highest FO number used so far.
    db
      .select({ ref: orders.trackingNumber })
      .from(orders)
      .where(sql`${orders.trackingNumber} ~ '^FO[0-9]{1,12}$'`)
      .orderBy(desc(sql`substring(${orders.trackingNumber} from 3)::numeric`))
      .limit(1),
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

  // "Create Exchange" on an order opens this screen for a new order that
  // replaces it, starting with the same customer and address.
  const exchangeId = isUuid(param("exchange")) ? param("exchange") : null;
  const [original] = exchangeId
    ? await db
        .select({
          id: orders.id,
          number: orders.number,
          ref: orders.trackingNumber,
          name: customers.name,
          phone: customers.phone,
          phone2: orders.phone2,
          country: orders.country,
          city: orders.city,
          area: orders.area,
          street: orders.street,
        })
        .from(orders)
        .innerJoin(customers, eq(customers.id, orders.customerId))
        .where(eq(orders.id, exchangeId))
    : [];

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

  // "Open to Check Allowed" is always offered, then whatever was used before.
  const instructions = ["Open to Check Allowed"];
  for (const row of used) {
    const line = row.text?.trim();
    if (line && !instructions.some((known) => known.toLowerCase() === line.toLowerCase())) {
      instructions.push(line);
    }
  }
  // After FO002 comes 003, keeping the zeros in front.
  const lastDigits = lastRef?.ref?.slice(2) ?? "";
  const nextRef = lastDigits
    ? String(BigInt(lastDigits) + BigInt(1)).padStart(lastDigits.length, "0")
    : "001";

  const header = (
      <div className="flex items-center gap-4">
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
  );

  return (
    <FreshOnVisit>
      <OrderForm
        currency={currency}
        timezone={timezone}
        instructions={instructions}
        nextRef={nextRef}
        header={header}
        products={catalog}
        defaults={{
          name: original?.name ?? param("name"),
          phone: original?.phone ?? param("phone"),
          phone2: original?.phone2 ?? "",
          country: original?.country ?? "",
          city: original?.city ?? "",
          area: original?.area ?? "",
          street: original?.street ?? "",
          conversationId: param("conversation"),
          source: original ? "exchange" : param("source"),
          exchange: original
            ? {
                id: original.id,
                label: `Order ${orderName(original.ref, original.number)}`,
              }
            : null,
        }}
      />
    </FreshOnVisit>
  );
}
