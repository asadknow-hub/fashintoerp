import { asc, eq } from "drizzle-orm";
import Link from "next/link";
import { FreshOnVisit } from "@/components/fresh-on-visit";
import { PageHeader } from "@/components/ui";
import { db } from "@/db";
import { products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { variantLabel } from "@/lib/format";
import { getPrefs } from "@/lib/settings";
import { OrderForm } from "./order-form";

export default async function NewOrderPage({
  searchParams,
}: PageProps<"/orders/new">) {
  await requireUser();
  const params = await searchParams;
  const param = (key: string) =>
    typeof params[key] === "string" ? (params[key] as string) : "";

  const rows = await db
    .select({
      id: variants.id,
      name: products.name,
      size: variants.size,
      color: variants.color,
      price: variants.price,
      stock: variants.stock,
    })
    .from(variants)
    .innerJoin(products, eq(products.id, variants.productId))
    .where(eq(products.archived, false))
    .orderBy(asc(products.name), asc(variants.color), asc(variants.createdAt));

  return (
    <div>
      <PageHeader title="New order" />
      <FreshOnVisit>
        <OrderForm
          currency={(await getPrefs()).currency}
          sellables={rows.map((row) => ({
            id: row.id,
            label: `${row.name} · ${variantLabel(row)}`,
            price: Number(row.price),
            stock: row.stock,
          }))}
          defaults={{
            name: param("name"),
            phone: param("phone"),
            conversationId: param("conversation"),
            source: param("source"),
          }}
        />
      </FreshOnVisit>
      <Link
        href="/orders"
        className="mt-4 inline-block text-sm text-stone-600 hover:underline"
      >
        ← Back to orders
      </Link>
    </div>
  );
}
