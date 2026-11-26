"use server";

import { eq, like } from "drizzle-orm";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import { productMedia, products, variants } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { amount, isUuid, optional, text, wholeNumber } from "@/lib/format";
import { isOurUrl, removeFile } from "@/lib/media";
import { cleanTag } from "@/lib/media-rules";
import { changeStock, StockError } from "@/lib/stock";

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

export type NewProduct = {
  name: string;
  category: string;
  description: string;
  price: string;
  cost: string;
  lowStockAt: string;
  // One entry per size and color combination, with its opening stock.
  variants: { size: string | null; color: string | null; stock: number }[];
  media: {
    url: string;
    thumbUrl: string | null;
    kind: "image" | "video";
    tag: string;
    fileName: string | null;
  }[];
};

// A preview picture is optional, but when given it must be one of our files.
const validThumb = (value: unknown) =>
  value === null || value === undefined || (typeof value === "string" && isOurUrl(value));

const label = (value: unknown) => {
  const cleaned = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  return cleaned ? cleaned.slice(0, 40) : null;
};

const money = (value: unknown) => {
  const raw = String(value ?? "").trim();
  if (!raw) return "0";
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
};

// Called by the "Add product" screen with everything typed there.
export async function createProduct(
  input: NewProduct,
): Promise<{ error: string } | { id: string }> {
  const user = await requireUser();
  const name = typeof input?.name === "string" ? input.name.trim().slice(0, 120) : "";
  const price = money(input?.price);
  const cost = money(input?.cost);
  const lowRaw = String(input?.lowStockAt ?? "").trim();
  const lowStockAt = lowRaw === "" ? 5 : Number(lowRaw);

  if (!name) return { error: "Give the product a name." };
  if (price === null || cost === null) return { error: "Prices must be numbers." };
  if (!Number.isInteger(lowStockAt) || lowStockAt < 0) {
    return { error: "Low stock alert must be a whole number, 0 or more." };
  }

  const combos: { size: string | null; color: string | null; stock: number }[] = [];
  const seen = new Set<string>();
  for (const item of Array.isArray(input?.variants) ? input.variants : []) {
    const size = label(item?.size);
    const color = label(item?.color);
    const stock = Number(item?.stock ?? 0);
    if (!Number.isInteger(stock) || stock < 0 || stock > 1_000_000) {
      return { error: "Stock must be whole numbers, 0 or more." };
    }
    const key = JSON.stringify([size?.toLowerCase(), color?.toLowerCase()]);
    if (seen.has(key)) continue;
    seen.add(key);
    combos.push({ size, color, stock });
  }
  if (combos.length === 0) combos.push({ size: null, color: null, stock: 0 });
  if (combos.length > 200) return { error: "That is too many sizes × colors." };

  const media = Array.isArray(input?.media) ? input.media.slice(0, 40) : [];
  for (const item of media) {
    if (typeof item?.url !== "string" || !isOurUrl(item.url) || !validThumb(item.thumbUrl)) {
      return { error: "One of the files did not come from our storage." };
    }
    if (item.kind !== "image" && item.kind !== "video") return { error: "Unknown file type." };
  }

  const taken = new Set<string>();
  const rows: { size: string | null; color: string | null; stock: number; sku: string }[] = [];
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
        category: String(input.category ?? "").trim().slice(0, 80) || null,
        description: String(input.description ?? "").trim().slice(0, 2000) || null,
      })
      .returning({ id: products.id });
    // Each item gets a slightly later time, so colors and sizes stay in the
    // order they were entered.
    const startedAt = Date.now();
    for (const [index, row] of rows.entries()) {
      const [variant] = await tx
        .insert(variants)
        .values({
          productId: product.id,
          sku: row.sku,
          size: row.size,
          color: row.color,
          price,
          cost,
          lowStockAt,
          createdAt: new Date(startedAt + index),
        })
        .returning({ id: variants.id });
      await changeStock(tx, {
        variantId: variant.id,
        change: row.stock,
        reason: "opening",
        userId: user.id,
      });
    }
    if (media.length) {
      await tx.insert(productMedia).values(
        media.map((item) => ({
          productId: product.id,
          kind: item.kind,
          url: item.url,
          thumbUrl: item.thumbUrl ?? null,
          tag: cleanTag(String(item.tag ?? "")) || "Gallery",
          fileName: String(item.fileName ?? "").slice(0, 200) || null,
        })),
      );
    }
    return product.id;
  });

  return { id: productId };
}

// Removes a file that was uploaded on the "Add product" screen and then
// taken off again before saving. Files already attached to a product are
// left alone.
export async function discardUpload(url: string, thumbUrl?: string | null): Promise<ActionState> {
  await requireUser();
  if (typeof url !== "string" || !isOurUrl(url) || !validThumb(thumbUrl)) {
    return { error: "Unknown file." };
  }
  const [attached] = await db
    .select({ id: productMedia.id })
    .from(productMedia)
    .where(eq(productMedia.url, url))
    .limit(1);
  if (!attached) {
    await removeFile(url);
    if (thumbUrl) await removeFile(thumbUrl);
  }
  return null;
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
  thumbUrl: string | null;
  kind: "image" | "video";
  tag: string;
  fileName: string | null;
}): Promise<ActionState> {
  await requireUser();
  const tag = cleanTag(String(input.tag ?? ""));
  if (!isUuid(String(input.productId))) return { error: "Product not found." };
  if (input.kind !== "image" && input.kind !== "video") return { error: "Unknown file type." };
  if (!tag) return { error: "Choose a tag." };
  if (typeof input.url !== "string" || !isOurUrl(input.url) || !validThumb(input.thumbUrl)) {
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
    thumbUrl: input.thumbUrl ?? null,
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
    .returning({ url: productMedia.url, thumbUrl: productMedia.thumbUrl });
  if (removed) {
    await removeFile(removed.url);
    if (removed.thumbUrl) await removeFile(removed.thumbUrl);
  }
  refresh();
  return { ok: "Deleted." };
}
