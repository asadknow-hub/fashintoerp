"use server";

import { eq, like } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { amount, optional, text, wholeNumber } from "@/lib/format";
import { changeStock, StockError } from "@/lib/stock";

const list = (value: string) => [
  ...new Set(
    value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  ),
];

const code = (value: string, length: number) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, length);

function skuFor(name: string, size: string | null, color: string | null) {
  const words = name.split(/\s+/).filter(Boolean);
  const prefix =
    words.length > 1
      ? words
          .slice(0, 3)
          .map((w) => code(w, 3))
          .join("")
      : code(name, 6);
  return [prefix || "ITEM", color && code(color, 3), size && code(size, 4)]
    .filter(Boolean)
    .join("-");
}

// Makes sure a SKU isn't already used by adding -2, -3… when needed.
async function uniqueSku(base: string, taken: Set<string>) {
  const existing = await db
    .select({ sku: variants.sku })
    .from(variants)
    .where(like(variants.sku, base + "%"));
  for (const row of existing) taken.add(row.sku);
  let sku = base;
  for (let n = 2; taken.has(sku); n++) sku = `${base}-${n}`;
  taken.add(sku);
  return sku;
}

const isDuplicate = (err: unknown) =>
  typeof err === "object" &&
  err !== null &&
  ((err as { code?: string }).code === "23505" ||
    (err as { cause?: { code?: string } }).cause?.code === "23505");

export async function createProduct(
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const name = text(form, "name");
  const price = amount(form, "price");
  const cost = amount(form, "cost");
  const stock = text(form, "stock") ? wholeNumber(form, "stock") : 0;
  const lowStockAt = text(form, "lowStockAt") ? wholeNumber(form, "lowStockAt") : 5;

  if (!name) return { error: "Give the product a name." };
  if (price === null || cost === null) return { error: "Prices must be numbers." };
  if (!(stock >= 0)) return { error: "Stock must be a whole number, 0 or more." };
  if (!(lowStockAt >= 0)) return { error: "Low stock alert must be 0 or more." };

  const sizes = list(text(form, "sizes"));
  const colors = list(text(form, "colors"));
  const combos: { size: string | null; color: string | null }[] = [];
  for (const color of colors.length ? colors : [null]) {
    for (const size of sizes.length ? sizes : [null]) combos.push({ size, color });
  }
  if (combos.length > 200) return { error: "That is too many sizes × colors." };

  const taken = new Set<string>();
  const rows: { size: string | null; color: string | null; sku: string }[] = [];
  for (const combo of combos) {
    rows.push({
      ...combo,
      sku: await uniqueSku(skuFor(name, combo.size, combo.color), taken),
    });
  }

  const productId = await db.transaction(async (tx) => {
    const [product] = await tx
      .insert(products)
      .values({
        name,
        category: optional(form, "category"),
        description: optional(form, "description"),
      })
      .returning({ id: products.id });
    const created = await tx
      .insert(variants)
      .values(
        rows.map((row) => ({
          ...row,
          productId: product.id,
          price,
          cost,
          lowStockAt,
        })),
      )
      .returning({ id: variants.id });
    for (const variant of created) {
      await changeStock(tx, {
        variantId: variant.id,
        change: stock,
        reason: "opening",
        userId: user.id,
      });
    }
    return product.id;
  });

  redirect(`/inventory/${productId}`);
}

export async function updateProduct(
  productId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireUser();
  const name = text(form, "name");
  if (!name) return { error: "Give the product a name." };
  await db
    .update(products)
    .set({
      name,
      category: optional(form, "category"),
      description: optional(form, "description"),
    })
    .where(eq(products.id, productId));
  refresh();
  return { ok: "Saved." };
}

export async function setArchived(productId: string, archived: boolean) {
  await requireUser();
  await db.update(products).set({ archived }).where(eq(products.id, productId));
  refresh();
}

export async function addVariant(
  productId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const size = optional(form, "size");
  const color = optional(form, "color");
  const price = amount(form, "price");
  const cost = amount(form, "cost");
  const stock = text(form, "stock") ? wholeNumber(form, "stock") : 0;
  if (!size && !color) return { error: "Enter a size or a color." };
  if (price === null || cost === null) return { error: "Prices must be numbers." };
  if (!(stock >= 0)) return { error: "Stock must be a whole number, 0 or more." };

  const [product] = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) return { error: "Product not found." };

  const sku = await uniqueSku(skuFor(product.name, size, color), new Set());
  await db.transaction(async (tx) => {
    const [variant] = await tx
      .insert(variants)
      .values({ productId, sku, size, color, price, cost })
      .returning({ id: variants.id });
    await changeStock(tx, {
      variantId: variant.id,
      change: stock,
      reason: "opening",
      userId: user.id,
    });
  });
  refresh();
  return { ok: "Added." };
}

export async function updateVariant(
  variantId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireUser();
  const sku = text(form, "sku");
  const price = amount(form, "price");
  const cost = amount(form, "cost");
  const lowStockAt = wholeNumber(form, "lowStockAt");
  if (!sku) return { error: "SKU can't be empty." };
  if (price === null || cost === null) return { error: "Prices must be numbers." };
  if (!(lowStockAt >= 0)) return { error: "Low stock alert must be 0 or more." };
  try {
    await db
      .update(variants)
      .set({
        sku,
        size: optional(form, "size"),
        color: optional(form, "color"),
        price,
        cost,
        lowStockAt,
      })
      .where(eq(variants.id, variantId));
  } catch (err) {
    if (isDuplicate(err)) return { error: "Another item already uses that SKU." };
    throw err;
  }
  refresh();
  return { ok: "Saved." };
}

const adjustments = {
  received: { reason: "purchase", sign: 1 },
  returned: { reason: "return", sign: 1 },
  damaged: { reason: "damage", sign: -1 },
  recount: { reason: "adjustment", sign: 0 },
} as const;

export async function adjustStock(
  variantId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const kind = adjustments[text(form, "kind") as keyof typeof adjustments];
  const quantity = wholeNumber(form, "quantity");
  if (!kind) return { error: "Choose what happened." };
  if (!(quantity >= 0) || (kind.sign !== 0 && quantity === 0)) {
    return { error: "Enter a whole number." };
  }

  try {
    await db.transaction(async (tx) => {
      let change = kind.sign * quantity;
      if (kind.sign === 0) {
        // Recount: the number typed is the new total on the shelf.
        const [current] = await tx
          .select({ stock: variants.stock })
          .from(variants)
          .where(eq(variants.id, variantId))
          .for("update");
        if (!current) throw new StockError("That item no longer exists.");
        change = quantity - current.stock;
      }
      await changeStock(tx, {
        variantId,
        change,
        reason: kind.reason,
        note: optional(form, "note"),
        userId: user.id,
      });
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Stock updated." };
}
