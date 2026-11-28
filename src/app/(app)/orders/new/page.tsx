import { asc, eq, sql } from "drizzle-orm";
import { ShoppingCart } from "lucide-react";
import { FreshOnVisit } from "@/components/fresh-on-visit";
import { db } from "@/db";
import {
  customers,
  deliveryCompanies,
  orders,
  productMedia,
  products,
  variants,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { isUuid, orderName, sortSizes } from "@/lib/format";
import { nextRefNumber } from "@/lib/order-ref";
import { getPrefs } from "@/lib/settings";
import { OrderForm, type OrderProduct } from "./order-form";

export default async function NewOrderPage({
  searchParams,
}: PageProps<"/orders/new">) {
  const [user, params, { currency, timezone }, rows] = await Promise.all([
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

  // "Create Exchange" on an order opens this screen for a new order that
  // replaces it, starting with the same customer and address.
  const exchangeId = isUuid(param("exchange")) ? param("exchange") : null;
  const [original] = exchangeId
    ? await db
        .select({
          id: orders.id,
          number: orders.number,
          ref: orders.trackingNumber,
          companyId: orders.deliveryCompanyId,
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

  // The one saved instruction: filled in on every new order, and the only
  // line in the dropdown. Anything else typed on an order stays on that
  // order and is not added to the list.
  const instructions = ["Open to Check Allowed"];
  const nextRef = await nextRefNumber(user.id);

  // On an exchange the customer pays the delivery charge as the COD: the
  // charge of the company that delivered the first order, or of the only
  // company there is.
  const couriers = original
    ? await db
        .select({ id: deliveryCompanies.id, name: deliveryCompanies.name, rate: deliveryCompanies.rate })
        .from(deliveryCompanies)
        .where(eq(deliveryCompanies.active, true))
    : [];
  const courier =
    couriers.find((company) => company.id === original?.companyId) ??
    (couriers.length === 1 ? couriers[0] : undefined);

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
          cod: courier ? Number(courier.rate).toFixed(2) : "",
          exchange: original
            ? {
                id: original.id,
                label: `Order ${orderName(original.ref, original.number)}`,
                courier: courier?.name ?? null,
              }
            : null,
        }}
      />
    </FreshOnVisit>
  );
}
