"use server";

import { and, eq, like } from "drizzle-orm";
import { refresh } from "next/cache";
import type { ActionState } from "@/components/action-form";
import { db } from "@/db";
import {
  productMedia,
  products,
  stockCountLines,
  stockCounts,
  stockPurchases,
  variants,
} from "@/db/schema";
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
    if (pieces > 0) {
      await tx.insert(stockPurchases).values({
        productId: product.id,
        units: pieces,
        totalCost: totalPaid,
        note: "Opening stock",
        createdBy: user.id,
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
  const kind = adjustments[kindName as keyof typeof adjustments];
  if (!kind) return { error: "Choose what happened." };
  const note = optional(form, "note");
  // Only asked for when stock is received: what the whole delivery cost.
  const paidTyped = kindName === "received" ? text(form, "totalPaid") : "";
  const totalPaid = paidTyped === "" ? null : amount(form, "totalPaid");
  if (paidTyped !== "" && totalPaid === null) return { error: "Total paid must be a number." };

  try {
    const changed = await db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: variants.id, cost: variants.cost })
        .from(variants)
        .where(eq(variants.productId, productId))
        .for("update");
      let count = 0;
      let pieces = 0;
      const touched: typeof rows = [];
      for (const row of rows) {
        if (text(form, `qty:${row.id}`) === "") continue;
        const quantity = wholeNumber(form, `qty:${row.id}`);
        if (!(quantity >= 0)) throw new StockError("Use whole numbers, 0 or more.");
        if (quantity === 0) continue;
        await changeStock(tx, {
          variantId: row.id,
          change: kind.sign * quantity,
          reason: kind.reason,
          note,
          userId: user.id,
        });
        count++;
        pieces += quantity;
        touched.push(row);
      }
      if (kindName === "received" && pieces > 0) {
        await tx.insert(stockPurchases).values({
          productId,
          units: pieces,
          totalCost: totalPaid,
          note: note ?? "Stock received",
          createdBy: user.id,
        });
        // Items that had no cost yet take theirs from this delivery.
        if (totalPaid !== null) {
          const each = (Number(totalPaid) / pieces).toFixed(2);
          for (const row of touched) {
            if (Number(row.cost) === 0) {
              await tx.update(variants).set({ cost: each }).where(eq(variants.id, row.id));
            }
          }
        }
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

/* ---------- What stock was bought for ---------- */

function readPurchase(form: FormData) {
  const units = wholeNumber(form, "units");
  const paid = text(form, "totalPaid");
  const totalCost = paid === "" ? null : amount(form, "totalPaid");
  if (!(units >= 1) || units > 10_000_000) return { error: "Pieces must be a whole number, 1 or more." };
  if (paid !== "" && totalCost === null) return { error: "Total paid must be a number." };
  return { units, totalCost, note: optional(form, "note") };
}

// Records what some stock cost, for stock that is already in the system.
// It is a money record only: stock is not changed.
export async function addPurchase(
  productId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  const user = await requireUser();
  if (!isUuid(productId)) return { error: "Product not found." };
  const values = readPurchase(form);
  if ("error" in values) return { error: values.error };
  if (values.totalCost === null) return { error: "Enter the total paid." };
  await db.insert(stockPurchases).values({ productId, ...values, createdBy: user.id });
  refresh();
  return { ok: "Saved." };
}

export async function updatePurchase(
  purchaseId: string,
  _state: ActionState,
  form: FormData,
): Promise<ActionState> {
  await requireUser();
  if (!isUuid(purchaseId)) return { error: "That record no longer exists." };
  const values = readPurchase(form);
  if ("error" in values) return { error: values.error };
  await db.update(stockPurchases).set(values).where(eq(stockPurchases.id, purchaseId));
  refresh();
  return { ok: "Saved." };
}

export async function deletePurchase(purchaseId: string): Promise<ActionState> {
  await requireUser();
  if (!isUuid(String(purchaseId))) return { error: "That record no longer exists." };
  await db.delete(stockPurchases).where(eq(stockPurchases.id, purchaseId));
  refresh();
  return null;
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
  return `system had ${system}, you counted ${counted} (${gap})`;
};

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

  refresh();
  const summary = tally(
    result.lines.map((line) => ({ counted: line.counted, system: line.systemStock })),
  );
  return {
    ok: `Count ${countId ? "updated" : "saved"} as a snapshot: ${summary}. Stock was not changed.`,
  };
}

export async function deleteCount(countId: string): Promise<ActionState> {
  await requireUser();
  if (!isUuid(String(countId))) return { error: "That count no longer exists." };
  await db.delete(stockCounts).where(eq(stockCounts.id, countId));
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
        .select({ appliedAt: stockCounts.appliedAt })
        .from(stockCounts)
        .where(eq(stockCounts.id, countId))
        .for("update");
      if (!count) throw new StockError("That count no longer exists.");
      if (count.appliedAt) throw new StockError("That count was already used as the stock.");

      const lines = await tx
        .select({
          variantId: stockCountLines.variantId,
          counted: stockCountLines.counted,
          stock: variants.stock,
        })
        .from(stockCountLines)
        .innerJoin(variants, eq(variants.id, stockCountLines.variantId))
        .where(eq(stockCountLines.countId, countId))
        .for("update", { of: variants });
      let total = 0;
      for (const line of lines) {
        const change = line.counted - line.stock;
        if (change === 0) continue;
        await changeStock(tx, {
          variantId: line.variantId,
          change,
          reason: "adjustment",
          note: "Stock set from a fresh count",
          userId: user.id,
        });
        total++;
      }
      await tx.update(stockCounts).set({ appliedAt: new Date() }).where(eq(stockCounts.id, countId));
      return total;
    });
    refresh();
    return {
      ok:
        changed === 0
          ? "Stock already matched this count, so nothing changed."
          : "Stock now matches this count.",
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
