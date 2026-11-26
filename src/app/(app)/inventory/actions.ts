"use server";

import { eq, like } from "drizzle-orm";
import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { productMedia, products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { amount, isUuid, optional, text, wholeNumber } from "@/lib/format";
import { isOurUrl, removeFile } from "@/lib/media";
import { cleanTag } from "@/lib/media-rules";
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

// Adds sizes and/or colors. A new size is added for every existing color,
// a new color for every existing size, and both together add just that one.
export async function addVariants(
  productId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const size = optional(form, "size");
  const color = optional(form, "color");
  const stock = text(form, "stock") ? wholeNumber(form, "stock") : 0;
  if (!size && !color) return { error: "Enter a size or a color." };
  if (!(stock >= 0)) return { error: "Stock must be a whole number, 0 or more." };

  const [product] = await db
    .select({ name: products.name })
    .from(products)
    .where(eq(products.id, productId));
  if (!product) return { error: "Product not found." };

  const existing = await db
    .select()
    .from(variants)
    .where(eq(variants.productId, productId))
    .orderBy(variants.createdAt);
  const sizes = [...new Set(existing.map((v) => v.size))];
  const colors = [...new Set(existing.map((v) => v.color))];
  const combos =
    size && color
      ? [{ size, color }]
      : size
        ? (colors.length ? colors : [null]).map((c) => ({ size, color: c }))
        : (sizes.length ? sizes : [null]).map((s) => ({ size: s, color }));
  const same = (a: string | null, b: string | null) =>
    (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
  const fresh = combos.filter(
    (combo) =>
      !existing.some((v) => same(v.size, combo.size) && same(v.color, combo.color)),
  );
  if (fresh.length === 0) return { error: "That size and color already exists." };

  // New items start with the same prices as the first existing one.
  const template = existing[0];
  const taken = new Set<string>();
  const rows: (typeof variants.$inferInsert)[] = [];
  for (const combo of fresh) {
    rows.push({
      ...combo,
      productId,
      sku: await uniqueSku(skuFor(product.name, combo.size, combo.color), taken),
      price: template?.price ?? "0",
      cost: template?.cost ?? "0",
      lowStockAt: template?.lowStockAt ?? 5,
    });
  }

  await db.transaction(async (tx) => {
    const created = await tx.insert(variants).values(rows).returning({ id: variants.id });
    for (const variant of created) {
      await changeStock(tx, {
        variantId: variant.id,
        change: stock,
        reason: "opening",
        userId: user.id,
      });
    }
  });
  refresh();
  return { ok: "Added." };
}

// Saves the whole "Prices & codes" table in one go.
export async function updateVariants(
  productId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireUser();
  const rows = await db
    .select({ id: variants.id })
    .from(variants)
    .where(eq(variants.productId, productId));

  const changes: {
    id: string;
    sku: string;
    size: string | null;
    color: string | null;
    price: string;
    cost: string;
    lowStockAt: number;
  }[] = [];
  for (const row of rows) {
    const sku = text(form, `sku:${row.id}`);
    const price = amount(form, `price:${row.id}`);
    const cost = amount(form, `cost:${row.id}`);
    const lowStockAt = wholeNumber(form, `low:${row.id}`);
    if (!sku) return { error: "SKU can't be empty." };
    if (price === null || cost === null) return { error: "Prices must be numbers." };
    if (!(lowStockAt >= 0)) return { error: "Low stock alert must be 0 or more." };
    changes.push({
      id: row.id,
      sku,
      size: optional(form, `size:${row.id}`),
      color: optional(form, `color:${row.id}`),
      price,
      cost,
      lowStockAt,
    });
  }
  if (new Set(changes.map((c) => c.sku.toLowerCase())).size !== changes.length) {
    return { error: "Two rows have the same SKU." };
  }

  try {
    await db.transaction(async (tx) => {
      for (const { id, ...values } of changes) {
        await tx.update(variants).set(values).where(eq(variants.id, id));
      }
    });
  } catch (err) {
    if (isDuplicate(err)) return { error: "Another product already uses one of those SKUs." };
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

// Applies the numbers typed into the stock grid, all together or not at all.
export async function adjustStockGrid(
  productId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const kind = adjustments[text(form, "kind") as keyof typeof adjustments];
  if (!kind) return { error: "Choose what happened." };
  const note = optional(form, "note");

  try {
    const changed = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: variants.id, stock: variants.stock })
        .from(variants)
        .where(eq(variants.productId, productId))
        .for("update");
      let count = 0;
      for (const row of rows) {
        const raw = text(form, `qty:${row.id}`);
        if (raw === "") continue;
        const quantity = wholeNumber(form, `qty:${row.id}`);
        if (!(quantity >= 0)) throw new StockError("Use whole numbers, 0 or more.");
        // Recount: the number typed is the new total on the shelf.
        const change = kind.sign === 0 ? quantity - row.stock : kind.sign * quantity;
        if (change === 0) continue;
        await changeStock(tx, {
          variantId: row.id,
          change,
          reason: kind.reason,
          note,
          userId: user.id,
        });
        count++;
      }
      return count;
    });
    if (changed === 0) return { error: "Type a number in at least one box." };
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  refresh();
  return { ok: "Stock updated." };
}

/* ---------- Photos and videos ---------- */

// Called by the browser after a file has finished uploading.
export async function addMedia(input: {
  productId: string;
  url: string;
  kind: "image" | "video";
  tag: string;
  fileName: string;
}): Promise<ActionState> {
  await requireUser();
  const tag = cleanTag(String(input.tag ?? ""));
  if (!isUuid(String(input.productId))) return { error: "Product not found." };
  if (input.kind !== "image" && input.kind !== "video") return { error: "Unknown file type." };
  if (!tag) return { error: "Choose a tag." };
  if (typeof input.url !== "string" || !isOurUrl(input.url)) {
    return { error: "That file did not come from our storage." };
  }

  const [product] = await db
    .select({ id: products.id })
    .from(products)
    .where(eq(products.id, input.productId));
  if (!product) return { error: "Product not found." };

  await db.insert(productMedia).values({
    productId: product.id,
    kind: input.kind,
    url: input.url,
    tag,
    fileName: String(input.fileName ?? "").slice(0, 200) || null,
  });
  refresh();
  return { ok: "Added." };
}

export async function setMediaTag(mediaId: string, value: string): Promise<ActionState> {
  await requireUser();
  const tag = cleanTag(String(value ?? ""));
  if (!isUuid(String(mediaId)) || !tag) return { error: "Choose a tag." };
  await db.update(productMedia).set({ tag }).where(eq(productMedia.id, mediaId));
  refresh();
  return { ok: "Saved." };
}

export async function deleteMedia(mediaId: string): Promise<ActionState> {
  await requireUser();
  if (!isUuid(String(mediaId))) return { error: "Not found." };
  const [removed] = await db
    .delete(productMedia)
    .where(eq(productMedia.id, mediaId))
    .returning({ url: productMedia.url });
  if (removed) await removeFile(removed.url);
  refresh();
  return { ok: "Deleted." };
}
