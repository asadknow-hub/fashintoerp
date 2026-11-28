import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLog,
  autoReplies,
  conversations,
  customers,
  messages,
  deliveryCompanies,
  orderItems,
  orders,
  productMedia,
  products,
  quickReplies,
  settings,
  stockCountLines,
  stockCounts,
  stockMovements,
  stockPurchaseLines,
  stockPurchases,
  users,
  variants,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import { getUser } from "@/lib/auth";

// Lets an Owner or the System Admin download a safety copy of everything in
// the database as one file. Passwords and sign-in sessions are left out on
// purpose. It is a POST (a button, not a link) so nothing can trigger it by
// merely being opened.
export async function POST() {
  const user = await getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  if (user.role === "staff") return new Response("Only an Owner or the System Admin can do this.", { status: 403 });

  // Everything is read inside one read-only snapshot, so the copy is of one
  // single moment: an order saved while it runs is either all in or all out.
  const tables = await db.transaction(
    async (tx) => ({
      settings: await tx.select().from(settings),
      users: await tx
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          active: users.active,
          createdAt: users.createdAt,
        })
        .from(users),
      products: await tx.select().from(products),
      variants: await tx.select().from(variants),
      product_media: await tx.select().from(productMedia),
      stock_movements: await tx.select().from(stockMovements),
      stock_purchases: await tx.select().from(stockPurchases),
      stock_purchase_lines: await tx.select().from(stockPurchaseLines),
      delivery_companies: await tx.select().from(deliveryCompanies),
      audit_log: await tx.select().from(auditLog),
      stock_counts: await tx.select().from(stockCounts),
      stock_count_lines: await tx.select().from(stockCountLines),
      customers: await tx.select().from(customers),
      orders: await tx.select().from(orders),
      order_items: await tx.select().from(orderItems),
      conversations: await tx.select().from(conversations),
      messages: await tx.select().from(messages),
      quick_replies: await tx.select().from(quickReplies),
      auto_replies: await tx.select().from(autoReplies),
    }),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );

  // Only now that the copy exists is it noted as taken.
  const takenAt = new Date();
  await db.update(settings).set({ lastBackupAt: takenAt }).where(eq(settings.id, 1));
  await audit(user, {
    area: "settings",
    action: "settings.backup",
    subject: "Safety copy",
    summary: "Downloaded a safety copy of all the data",
  });

  // Written out one table at a time, so a big database is never one huge
  // piece of text in memory.
  const names = Object.keys(tables) as (keyof typeof tables)[];
  const head = JSON.stringify({
    about: "Safety copy of the ERP data. Photos and videos are not inside; their addresses are.",
    takenAt: takenAt.toISOString(),
    takenBy: user.email,
    formatVersion: 1,
  });
  const encoder = new TextEncoder();
  let next = -1;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (next === -1) {
        controller.enqueue(encoder.encode(head.slice(0, -1) + ',"tables":{'));
      } else if (next < names.length) {
        const name = names[next];
        controller.enqueue(
          encoder.encode((next ? "," : "") + JSON.stringify(name) + ":" + JSON.stringify(tables[name])),
        );
      } else {
        controller.enqueue(encoder.encode("}}"));
        controller.close();
      }
      next++;
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="erp-backup-${takenAt.toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
