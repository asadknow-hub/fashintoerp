"use server";

import { and, eq, inArray, isNotNull, like, or, sql } from "drizzle-orm";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { db, type Tx } from "@/db";
import {
  productMedia,
  products,
  stockCountLines,
  stockCounts,
  stockPurchaseLines,
  stockPurchases,
  variants,
} from "@/db/schema";
import { audit, productSubject } from "@/lib/audit";
import { requireUser } from "@/lib/auth";
import { amount, isUuid, optional, text, wholeNumber } from "@/lib/format";
import { isOurUrl, removeFile, sameStore } from "@/lib/media";
import { shelfHeld } from "@/lib/shelf";
import { cleanTag } from "@/lib/media-rules";
import { offerTotal } from "@/lib/offer";
import { changeStock, StockError } from "@/lib/stock";

const code = (value: string, length: number) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, length);

// A short code made from the product's name, e.g. "Linen Shirt" → LINSHI.
function productCode(name: string) {
  const words = name.split(/\s+/).filter(Boolean);
  const made =
    words.length > 1
      ? words
          .slice(0, 3)
          .map((w) => code(w, 3))
          .join("")
      : code(name, 6);
  return made || "ITEM";
}

// The SKU of one size and color: the product's code plus the color and size.
function skuFor(base: string, size: string | null, color: string | null) {
  return [base, color && code(color, 3), size && code(size, 4)].filter(Boolean).join("-");
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
  // What all of the opening stock was bought for, if known.
  totalPaid: string;
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

// A file that is already attached to a product: it shows where our file
// store is, so new files can be checked against it.
async function knownFile() {
  const [row] = await db
    .select({ url: productMedia.url })
    .from(productMedia)
    .where(like(productMedia.url, "https://%"))
    .limit(1);
  return row?.url ?? null;
}
const addresses = (items: { url: string; thumbUrl?: string | null }[]) =>
  items.flatMap((item) => (item.thumbUrl ? [item.url, item.thumbUrl] : [item.url]));

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
  let cost = money(input?.cost);
  const totalPaid = String(input?.totalPaid ?? "").trim() === "" ? null : money(input.totalPaid);
  const lowRaw = String(input?.lowStockAt ?? "").trim();
  const lowStockAt = lowRaw === "" ? 5 : Number(lowRaw);

  if (!name) return { error: "Give the product a name." };
  if (price === null || cost === null) return { error: "Prices must be numbers." };
  if (String(input?.totalPaid ?? "").trim() !== "" && totalPaid === null) {
    return { error: "Total paid must be a number." };
  }
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

  const pieces = combos.reduce((sum, combo) => sum + combo.stock, 0);
  if (totalPaid !== null && pieces === 0) {
    return { error: "Enter the stock before the total paid for it." };
  }
  // With only a total given, the cost of one piece is worked out from it.
  if (totalPaid !== null && Number(cost) === 0) cost = (Number(totalPaid) / pieces).toFixed(2);

  const media = Array.isArray(input?.media) ? input.media.slice(0, 40) : [];
  for (const item of media) {
    if (typeof item?.url !== "string" || !isOurUrl(item.url) || !validThumb(item.thumbUrl)) {
      return { error: "One of the files did not come from our storage." };
    }
    if (item.kind !== "image" && item.kind !== "video") return { error: "Unknown file type." };
  }
  if (media.length && !sameStore(addresses(media), await knownFile())) {
    return { error: "One of the files did not come from our storage." };
  }

  const taken = new Set<string>();
  const rows: { size: string | null; color: string | null; stock: number; sku: string }[] = [];
  for (const combo of combos) {
    rows.push({
      ...combo,
      sku: await uniqueSku(skuFor(productCode(name), combo.size, combo.color), taken),
    });
  }

  const productId = await db.transaction(async (tx) => {
    const [product] = await tx
      .insert(products)
      .values({
        name,
        sku: productCode(name),
        category: String(input.category ?? "").trim().slice(0, 80) || null,
        description: String(input.description ?? "").trim().slice(0, 2000) || null,
      })
      .returning({ id: products.id });
    // Each item gets a slightly later time, so colors and sizes stay in the
    // order they were entered.
    const startedAt = Date.now();
    const opening: { variantId: string; quantity: number }[] = [];
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
      if (row.stock > 0) opening.push({ variantId: variant.id, quantity: row.stock });
    }
    if (pieces > 0) {
      const [batch] = await tx
        .insert(stockPurchases)
        .values({
          productId: product.id,
          units: pieces,
          totalCost: totalPaid,
          note: "Opening stock",
          createdBy: user.id,
        })
        .returning({ id: stockPurchases.id });
      await tx
        .insert(stockPurchaseLines)
        .values(opening.map((line) => ({ ...line, purchaseId: batch.id })));
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

  await audit(user, {
    area: "products",
    action: "product.created",
    subject: name,
    summary: `Added the product with ${rows.length} sizes and colors and ${pieces} pieces of opening stock`,
    productId,
  });
  refresh();
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
  // Neither address may belong to a product, as its file or as its preview.
  const both = thumbUrl ? [url, thumbUrl] : [url];
  if (!sameStore(both, await knownFile())) return { error: "Unknown file." };
  const [attached] = await db
    .select({ id: productMedia.id })
    .from(productMedia)
    .where(or(inArray(productMedia.url, both), inArray(productMedia.thumbUrl, both)))
    .limit(1);
  if (!attached) {
    await removeFile(url);
    if (thumbUrl) await removeFile(thumbUrl);
  }
  return null;
}

// Saves the "Product information" card: the name and details, the product's
// code, and the selling price (which applies to every size and color).
export async function updateProduct(
  productId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(String(productId))) return { error: "Product not found." };
  const name = text(form, "name");
  const sku = code(text(form, "sku"), 24) || null;
  const priceTyped = text(form, "price");
  const price = priceTyped === "" ? null : amount(form, "price");
  if (!name) return { error: "Give the product a name." };
  if (priceTyped !== "" && price === null) return { error: "Selling price must be a number." };
  // What 2, 3 and 4 pieces cost together. Empty means "no special price".
  const tiers: Partial<Record<"price2" | "price3" | "price4", string | null>> = {};
  for (const key of ["price2", "price3", "price4"] as const) {
    if (!form.has(key)) continue;
    const typed = text(form, key);
    const value = typed === "" ? null : amount(form, key);
    if (typed !== "" && value === null) return { error: "Prices must be numbers." };
    tiers[key] = value;
  }

  try {
    await db.transaction(async (tx) => {
      const [before] = await tx
        .select({ sku: products.sku })
        .from(products)
        .where(eq(products.id, productId))
        .for("update");
      if (!before) throw new StockError("Product not found.");

      await tx
        .update(products)
        .set({
          name: name.slice(0, 120),
          sku,
          category: optional(form, "category"),
          description: optional(form, "description"),
          ...tiers,
        })
        .where(eq(products.id, productId));

      const items = await tx
        .select({ id: variants.id, sku: variants.sku, price: variants.price })
        .from(variants)
        .where(eq(variants.productId, productId));

      // More pieces can't cost less than fewer pieces.
      const [now] = await tx
        .select({ price2: products.price2, price3: products.price3, price4: products.price4 })
        .from(products)
        .where(eq(products.id, productId));
      const one =
        price !== null ? Number(price) : Math.max(0, ...items.map((item) => Number(item.price)));
      const offer = {
        price2: now.price2 === null ? null : Number(now.price2),
        price3: now.price3 === null ? null : Number(now.price3),
        price4: now.price4 === null ? null : Number(now.price4),
      };
      for (const [index, key] of (["price2", "price3", "price4"] as const).entries()) {
        const pieces = index + 2;
        if (offer[key] !== null && offer[key] < offerTotal(one, offer, pieces - 1)) {
          throw new StockError(
            `${pieces} pieces can't cost less than ${pieces - 1} ${pieces === 2 ? "piece" : "pieces"}. These are prices for all the pieces together.`,
          );
        }
      }
      for (const item of items) {
        const change: { price?: string; sku?: string } = {};
        if (price !== null) change.price = price;
        // A new product code carries through to every item built on the old one.
        if (sku && before.sku && sku !== before.sku) {
          if (item.sku === before.sku) change.sku = sku;
          else if (item.sku.startsWith(before.sku + "-")) {
            change.sku = sku + item.sku.slice(before.sku.length);
          }
        }
        if (Object.keys(change).length) {
          await tx.update(variants).set(change).where(eq(variants.id, item.id));
        }
      }
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    if (isDuplicate(err)) return { error: "Another product already uses that SKU." };
    throw err;
  }
  await audit(user, {
    area: "products",
    action: "product.edited",
    subject: name,
    summary:
      "Edited the product's details" +
      (price !== null ? `, selling price ${price}` : "") +
      (Object.keys(tiers).length
        ? `, prices for 2/3/4 pieces ${[tiers.price2, tiers.price3, tiers.price4].map((value) => value ?? "none").join(" / ")}`
        : ""),
    productId,
  });
  refresh();
  return { ok: "Saved" };
}

export async function setArchived(productId: string, archived: boolean): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(String(productId)) || typeof archived !== "boolean") {
    return { error: "Product not found." };
  }
  await db.update(products).set({ archived }).where(eq(products.id, productId));
  await audit(user, {
    area: "products",
    action: archived ? "product.archived" : "product.restored",
    subject: await productSubject(productId),
    summary: archived ? "Archived the product" : "Restored the product",
    productId,
  });
  refresh();
  return { ok: archived ? "Archived" : "Restored" };
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
  if (!isUuid(String(productId))) return { error: "Product not found." };
  if (!size && !color) return { error: "Enter a size or a color." };
  if (!(stock >= 0) || stock > 1_000_000) {
    return { error: "Stock must be a whole number, 0 or more." };
  }

  const [product] = await db
    .select({ name: products.name, sku: products.sku })
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
      sku: await uniqueSku(
        skuFor(product.sku || productCode(product.name), combo.size, combo.color),
        taken,
      ),
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
    // Stock that arrives with a new size or color gets a purchase record too,
    // so its cost can be filled in.
    if (stock > 0) {
      await tx.insert(stockPurchases).values({
        productId,
        units: stock * created.length,
        note: "Opening stock",
        createdBy: user.id,
      });
    }
  });
  await audit(user, {
    area: "products",
    action: "product.variants_added",
    subject: product.name,
    summary: `Added ${[size && `size ${size}`, color && `color ${color}`].filter(Boolean).join(" and ")}${stock > 0 ? ` with ${stock} pieces each` : ""}`,
    productId,
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
  const user = await requireUser();
  if (!isUuid(String(productId))) return { error: "Product not found." };
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
  await audit(user, {
    area: "products",
    action: "product.prices",
    subject: await productSubject(productId),
    summary: "Changed the prices, costs, codes or low-stock levels of its sizes and colors",
    productId,
  });
  refresh();
  return { ok: "Saved." };
}

// Pieces that come back from customers are put back on their order's page,
// so the only thing typed straight into the grid is what was damaged or lost.
const adjustments = {
  damaged: { reason: "damage", sign: -1 },
} as const;

// Adds or removes the numbers typed into the stock grid, all together or not
// at all.
export async function adjustStockGrid(
  productId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const kindName = text(form, "kind");
  if (!isUuid(String(productId))) return { error: "Product not found." };
  if (!Object.hasOwn(adjustments, kindName)) return { error: "Choose what happened." };
  const kind = adjustments[kindName as keyof typeof adjustments];
  const note = optional(form, "note");
  try {
    const changed = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: variants.id })
        .from(variants)
        .where(eq(variants.productId, productId))
        .for("update");
      let count = 0;
      for (const row of rows) {
        if (text(form, `qty:${row.id}`) === "") continue;
        const quantity = wholeNumber(form, `qty:${row.id}`);
        if (!(quantity >= 0) || quantity > 1_000_000) {
          throw new StockError("Use whole numbers, 0 or more.");
        }
        if (quantity === 0) continue;
        await changeStock(tx, {
          variantId: row.id,
          change: kind.sign * quantity,
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
  await audit(user, {
    area: "stock",
    action: "stock." + kindName,
    subject: await productSubject(productId),
    summary:
      (kindName === "damaged" ? "Took pieces off stock as damaged or lost" : "Added returned pieces to stock") +
      (note ? ` (${note})` : ""),
    productId,
  });
  refresh();
  return { ok: "Stock updated." };
}

/* ---------- What stock was bought for ---------- */

// One cost rule, used by every page: a piece of a product costs what its
// purchase batches cost on average (all the money paid ÷ all the pieces
// bought, over the batches that have an amount). Every size and color of the
// product is given that cost, each time a batch is added, changed or
// deleted. While no batch has an amount, costs typed by hand stay.
async function recost(tx: Tx, productId: string) {
  const [paid] = await tx
    .select({
      total: sql<string | null>`sum(${stockPurchases.totalCost})`,
      units: sql<number | null>`sum(${stockPurchases.units})::int`,
    })
    .from(stockPurchases)
    .where(and(eq(stockPurchases.productId, productId), isNotNull(stockPurchases.totalCost)));
  if (!paid?.units || paid.total === null) return;
  await tx
    .update(variants)
    .set({ cost: (Number(paid.total) / paid.units).toFixed(2) })
    .where(eq(variants.productId, productId));
}

// Saves a purchase batch from its pop-up: who it came from, what was paid,
// and how many pieces of each size and color. A new batch adds those pieces
// to stock. Changing the numbers of a saved batch moves stock by the
// difference, so the batches always add up to what was really bought.
//
// Old batches that have no size-and-color breakdown are money records: for
// those only the pieces, the amount and the name can be corrected.
export async function saveBatch(
  productId: string,
  batchId: string | null,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(productId) || (batchId !== null && !isUuid(batchId))) {
    return { error: "That record no longer exists." };
  }
  const note = optional(form, "note");
  const paid = text(form, "totalPaid");
  const totalCost = paid === "" ? null : amount(form, "totalPaid");
  if (paid !== "" && totalCost === null) return { error: "The cost must be a number." };

  try {
    await db.transaction(async (tx) => {
      const items = await tx
        .select({ id: variants.id, cost: variants.cost })
        .from(variants)
        .where(eq(variants.productId, productId))
        .for("update");

      const [batch] = batchId
        ? await tx
            .select({ id: stockPurchases.id, note: stockPurchases.note })
            .from(stockPurchases)
            .where(and(eq(stockPurchases.id, batchId), eq(stockPurchases.productId, productId)))
            .for("update")
        : [];
      if (batchId && !batch) throw new StockError("That batch no longer exists.");
      const before = batch
        ? await tx
            .select({
              variantId: stockPurchaseLines.variantId,
              quantity: stockPurchaseLines.quantity,
            })
            .from(stockPurchaseLines)
            .where(eq(stockPurchaseLines.purchaseId, batch.id))
        : [];

      // A money-only record from before batches kept their sizes and colors.
      if (batch && before.length === 0) {
        const units = wholeNumber(form, "units");
        if (!(units >= 1) || units > 10_000_000) {
          throw new StockError("Pieces must be a whole number, 1 or more.");
        }
        await tx
          .update(stockPurchases)
          .set({ units, totalCost, note })
          .where(eq(stockPurchases.id, batch.id));
        await recost(tx, productId);
        return;
      }

      const lines: { variantId: string; quantity: number }[] = [];
      for (const item of items) {
        const typed = text(form, `qty:${item.id}`);
        const quantity = typed === "" ? 0 : wholeNumber(form, `qty:${item.id}`);
        if (!(quantity >= 0) || quantity > 1_000_000) {
          throw new StockError("Use whole numbers, 0 or more.");
        }
        if (quantity > 0) lines.push({ variantId: item.id, quantity });
      }
      const units = lines.reduce((sum, line) => sum + line.quantity, 0);
      if (units === 0) {
        throw new StockError(
          batch
            ? "Type a number in at least one box. To remove the batch, use Delete."
            : "Type how many pieces came in, in at least one box.",
        );
      }

      const name = note ?? (batch ? null : "Stock received");
      for (const item of items) {
        const was = before.find((line) => line.variantId === item.id)?.quantity ?? 0;
        const now = lines.find((line) => line.variantId === item.id)?.quantity ?? 0;
        if (now === was) continue;
        try {
          await changeStock(tx, {
            variantId: item.id,
            change: now - was,
            reason: "purchase",
            note: batch ? `Batch corrected${name ? `: ${name}` : ""}` : name,
            userId: user.id,
          });
        } catch (err) {
          if (!(err instanceof StockError)) throw err;
          throw new StockError(
            `${err.message} Some of these pieces were already sold or taken off, so the batch can't go that low.`,
          );
        }
      }

      let purchaseId = batch?.id;
      if (purchaseId) {
        await tx
          .update(stockPurchases)
          .set({ units, totalCost, note: name })
          .where(eq(stockPurchases.id, purchaseId));
        await tx.delete(stockPurchaseLines).where(eq(stockPurchaseLines.purchaseId, purchaseId));
      } else {
        const [created] = await tx
          .insert(stockPurchases)
          .values({ productId, units, totalCost, note: name, createdBy: user.id })
          .returning({ id: stockPurchases.id });
        purchaseId = created.id;
      }
      await tx
        .insert(stockPurchaseLines)
        .values(lines.map((line) => ({ ...line, purchaseId: purchaseId! })));

      await recost(tx, productId);
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  await audit(user, {
    area: "stock",
    action: batchId ? "stock.batch_changed" : "stock.batch_added",
    subject: await productSubject(productId),
    summary:
      (batchId ? "Changed a purchase batch" : "Added a purchase batch (stock received)") +
      (note ? `: ${note}` : "") +
      (totalCost !== null ? `, total cost ${totalCost}` : ""),
    productId,
  });
  refresh();
  return { ok: "Saved." };
}

// Deleting a batch takes its pieces back out of stock. (An old money-only
// record has no pieces to take out.)
export async function deletePurchase(purchaseId: string): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(String(purchaseId))) return { error: "That record no longer exists." };
  let removed: { productId: string; note: string | null; units: number } | null = null;
  try {
    await db.transaction(async (tx) => {
      const [batch] = await tx
        .select({
          id: stockPurchases.id,
          note: stockPurchases.note,
          productId: stockPurchases.productId,
          units: stockPurchases.units,
        })
        .from(stockPurchases)
        .where(eq(stockPurchases.id, purchaseId))
        .for("update");
      if (!batch) return;
      removed = { productId: batch.productId, note: batch.note, units: batch.units };
      const lines = await tx
        .select({
          variantId: stockPurchaseLines.variantId,
          quantity: stockPurchaseLines.quantity,
        })
        .from(stockPurchaseLines)
        .where(eq(stockPurchaseLines.purchaseId, batch.id));
      for (const line of lines) {
        try {
          await changeStock(tx, {
            variantId: line.variantId,
            change: -line.quantity,
            reason: "purchase",
            note: `Batch deleted${batch.note ? `: ${batch.note}` : ""}`,
            userId: user.id,
          });
        } catch (err) {
          if (!(err instanceof StockError)) throw err;
          throw new StockError(
            `${err.message} Some of this batch was already sold or taken off, so it can't be deleted. Lower its numbers instead.`,
          );
        }
      }
      await tx.delete(stockPurchases).where(eq(stockPurchases.id, batch.id));
      await recost(tx, batch.productId);
    });
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
  const batchGone = removed as { productId: string; note: string | null; units: number } | null;
  if (batchGone) {
    await audit(user, {
      area: "stock",
      action: "stock.batch_deleted",
      subject: await productSubject(batchGone.productId),
      summary: `Deleted a purchase batch of ${batchGone.units} pieces${batchGone.note ? ` (${batchGone.note})` : ""}`,
      productId: batchGone.productId,
    });
  }
  refresh();
  return { ok: "Batch deleted." };
}

/* ---------- Fresh counts (snapshots) ---------- */

const tally = (lines: { counted: number; system: number }[]) => {
  const counted = lines.reduce((sum, line) => sum + line.counted, 0);
  const system = lines.reduce((sum, line) => sum + line.system, 0);
  const missing = lines.reduce((sum, line) => sum + Math.max(0, line.system - line.counted), 0);
  const extra = lines.reduce((sum, line) => sum + Math.max(0, line.counted - line.system), 0);
  const gap =
    [missing ? `${missing} missing` : null, extra ? `${extra} extra` : null]
      .filter(Boolean)
      .join(" and ") || "all match";
  return `the shelf should hold ${system}, you counted ${counted} (${gap})`;
};

// A count older than this is no longer a fair picture of the shelf.
const COUNT_DAYS = 3;

// Saves a fresh count as a snapshot, or updates one that is being edited.
// Stock itself is not touched.
export async function saveCount(
  productId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  const countId = text(form, "countId");
  const note = optional(form, "note");
  if (!isUuid(productId) || (countId && !isUuid(countId))) {
    return { error: "Product not found." };
  }

  const rows = await db
    .select({ id: variants.id, stock: variants.stock })
    .from(variants)
    .where(eq(variants.productId, productId));
  const typed: { variantId: string; counted: number; stock: number }[] = [];
  for (const row of rows) {
    if (text(form, `qty:${row.id}`) === "") continue;
    const counted = wholeNumber(form, `qty:${row.id}`);
    if (!(counted >= 0) || counted > 1_000_000) {
      return { error: "Use whole numbers, 0 or more." };
    }
    typed.push({ variantId: row.id, counted, stock: row.stock });
  }
  if (typed.length === 0) return { error: "Type what you counted in at least one box." };
  // What the shelf should hold: the stock, plus pieces waiting to be sent out.
  const held = await shelfHeld({ variantIds: typed.map((entry) => entry.variantId) });
  for (const entry of typed) entry.stock += held.get(entry.variantId) ?? 0;

  const result = await db.transaction(async (tx) => {
    // When editing, each item keeps the system number it was first compared with.
    const before = new Map<string, number>();
    let id = countId;
    if (id) {
      const [existing] = await tx
        .select({ appliedAt: stockCounts.appliedAt })
        .from(stockCounts)
        .where(and(eq(stockCounts.id, id), eq(stockCounts.productId, productId)))
        .for("update");
      if (!existing) return { error: "That count no longer exists." };
      if (existing.appliedAt) {
        return { error: "That count was already used as the stock, so it can't be changed." };
      }
      const old = await tx
        .select({ variantId: stockCountLines.variantId, systemStock: stockCountLines.systemStock })
        .from(stockCountLines)
        .where(eq(stockCountLines.countId, id));
      for (const line of old) before.set(line.variantId, line.systemStock);
      await tx.update(stockCounts).set({ note }).where(eq(stockCounts.id, id));
      await tx.delete(stockCountLines).where(eq(stockCountLines.countId, id));
    } else {
      const [created] = await tx
        .insert(stockCounts)
        .values({ productId, note, createdBy: user.id })
        .returning({ id: stockCounts.id });
      id = created.id;
    }
    const lines = typed.map((entry) => ({
      countId: id,
      variantId: entry.variantId,
      counted: entry.counted,
      systemStock: before.get(entry.variantId) ?? entry.stock,
    }));
    await tx.insert(stockCountLines).values(lines);
    return { lines };
  });
  if ("error" in result) return { error: result.error };

  await audit(user, {
    area: "stock",
    action: countId ? "stock.count_changed" : "stock.count_saved",
    subject: await productSubject(productId),
    summary: (countId ? "Changed a stock count" : "Saved a stock count") + (note ? ` (${note})` : ""),
    productId,
  });
  refresh();
  const summary = tally(
    result.lines.map((line) => ({ counted: line.counted, system: line.systemStock })),
  );
  return {
    ok: `Count ${countId ? "updated" : "saved"} as a snapshot: ${summary}. Stock was not changed.`,
  };
}

export async function deleteCount(countId: string): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(String(countId))) return { error: "That count no longer exists." };
  const [gone] = await db
    .delete(stockCounts)
    .where(eq(stockCounts.id, countId))
    .returning({ productId: stockCounts.productId });
  if (gone) {
    await audit(user, {
      area: "stock",
      action: "stock.count_deleted",
      subject: await productSubject(gone.productId),
      summary: "Deleted a stock count",
      productId: gone.productId,
    });
  }
  refresh();
  return { ok: "Count deleted. Stock was not changed." };
}

// Only when asked: makes the real stock match what was counted.
export async function applyCount(countId: string): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(String(countId))) return { error: "That count no longer exists." };

  try {
    const changed = await db.transaction(async (tx) => {
      const [count] = await tx
        .select({ appliedAt: stockCounts.appliedAt, createdAt: stockCounts.createdAt })
        .from(stockCounts)
        .where(eq(stockCounts.id, countId))
        .for("update");
      if (!count) throw new StockError("That count no longer exists.");
      if (count.appliedAt) throw new StockError("That count was already used as the stock.");
      if (Date.now() - count.createdAt.getTime() > COUNT_DAYS * 24 * 60 * 60 * 1000) {
        throw new StockError(
          `This count is more than ${COUNT_DAYS} days old. Count again and use the new count.`,
        );
      }

      const lines = await tx
        .select({
          variantId: stockCountLines.variantId,
          counted: stockCountLines.counted,
          expected: stockCountLines.systemStock,
          stock: variants.stock,
        })
        .from(stockCountLines)
        .innerJoin(variants, eq(variants.id, stockCountLines.variantId))
        .where(eq(stockCountLines.countId, countId))
        .for("update", { of: variants });
      let total = 0;
      for (const line of lines) {
        // The difference the count found, added to today's stock: what was
        // sold or received since the count stays counted.
        const change = line.counted - line.expected;
        if (change === 0) continue;
        if (line.stock + change < 0) {
          throw new StockError(
            "Too much of this product was sold since the count was taken. Count again and use the new count.",
          );
        }
        await changeStock(tx, {
          variantId: line.variantId,
          change,
          reason: "adjustment",
          note: "Stock corrected from a fresh count",
          userId: user.id,
        });
        total++;
      }
      await tx.update(stockCounts).set({ appliedAt: new Date() }).where(eq(stockCounts.id, countId));
      return total;
    });
    const [counted] = await db
      .select({ productId: stockCounts.productId })
      .from(stockCounts)
      .where(eq(stockCounts.id, countId));
    if (counted) {
      await audit(user, {
        area: "stock",
        action: "stock.count_applied",
        subject: await productSubject(counted.productId),
        summary: `Corrected the stock from a count (${changed} sizes and colors changed)`,
        productId: counted.productId,
      });
    }
    refresh();
    return {
      ok:
        changed === 0
          ? "Stock already matched this count, so nothing changed."
          : "Stock corrected by what this count found.",
    };
  } catch (err) {
    if (err instanceof StockError) return { error: err.message };
    throw err;
  }
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
  const user = await requireUser();
  const tag = cleanTag(String(input.tag ?? ""));
  if (!isUuid(String(input.productId))) return { error: "Product not found." };
  if (input.kind !== "image" && input.kind !== "video") return { error: "Unknown file type." };
  if (!tag) return { error: "Choose a tag." };
  if (typeof input.url !== "string" || !isOurUrl(input.url) || !validThumb(input.thumbUrl)) {
    return { error: "That file did not come from our storage." };
  }
  if (!sameStore(addresses([input]), await knownFile())) {
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
  await audit(user, {
    area: "products",
    action: "product.media_added",
    subject: await productSubject(product.id),
    summary: `Added a ${input.kind === "video" ? "video" : "photo"} (${tag})`,
    productId: product.id,
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
  const user = await requireUser();
  if (!isUuid(String(mediaId))) return { error: "Not found." };
  const [removed] = await db
    .delete(productMedia)
    .where(eq(productMedia.id, mediaId))
    .returning({
      url: productMedia.url,
      thumbUrl: productMedia.thumbUrl,
      productId: productMedia.productId,
      kind: productMedia.kind,
    });
  if (removed) {
    await removeFile(removed.url);
    if (removed.thumbUrl) await removeFile(removed.thumbUrl);
    await audit(user, {
      area: "products",
      action: "product.media_deleted",
      subject: await productSubject(removed.productId),
      summary: `Deleted a ${removed.kind === "video" ? "video" : "photo"}`,
      productId: removed.productId,
    });
  }
  refresh();
  return { ok: "Deleted." };
}
