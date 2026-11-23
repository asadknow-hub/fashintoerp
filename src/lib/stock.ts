import "server-only";
import { and, eq, sql } from "drizzle-orm";
import type { Tx } from "@/db";
import { stockMovements, variants } from "@/db/schema";

export class StockError extends Error {}

type Reason = (typeof stockMovements.reason.enumValues)[number];

// The one place stock numbers change. Updates the count and writes a history
// line together, and refuses to let stock go below zero.
export async function changeStock(
  tx: Tx,
  input: {
    variantId: string;
    change: number;
    reason: Reason;
    note?: string | null;
    userId?: string | null;
    orderId?: string | null;
  },
) {
  if (input.change === 0) return;
  const [updated] = await tx
    .update(variants)
    .set({ stock: sql`${variants.stock} + ${input.change}` })
    .where(
      and(
        eq(variants.id, input.variantId),
        sql`${variants.stock} + ${input.change} >= 0`,
      ),
    )
    .returning({ sku: variants.sku });
  if (!updated) {
    const [current] = await tx
      .select({ sku: variants.sku, stock: variants.stock })
      .from(variants)
      .where(eq(variants.id, input.variantId));
    throw new StockError(
      current
        ? `Not enough stock for ${current.sku} (only ${current.stock} left).`
        : "That item no longer exists.",
    );
  }
  await tx.insert(stockMovements).values({
    variantId: input.variantId,
    change: input.change,
    reason: input.reason,
    note: input.note ?? null,
    userId: input.userId ?? null,
    orderId: input.orderId ?? null,
  });
}
