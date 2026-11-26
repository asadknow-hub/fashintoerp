import { eq } from "drizzle-orm";
import { db } from "@/db";
import {
  autoReplies,
  conversations,
  customers,
  messages,
  orderItems,
  orders,
  productMedia,
  products,
  quickReplies,
  settings,
  stockCountLines,
  stockCounts,
  stockMovements,
  users,
  variants,
} from "@/db/schema";
import { getUser } from "@/lib/auth";

// Lets an owner download a safety copy of everything in the database as one
// file. Passwords and sign-in sessions are left out on purpose.
export async function GET() {
  const user = await getUser();
  if (!user) return new Response("Please sign in.", { status: 401 });
  if (user.role !== "owner") return new Response("Only owners can do this.", { status: 403 });

  const [
    business,
    staff,
    productRows,
    variantRows,
    mediaRows,
    movementRows,
    customerRows,
    orderRows,
    itemRows,
    conversationRows,
    messageRows,
    quickReplyRows,
    autoReplyRows,
    countRows,
    countLineRows,
  ] = await Promise.all([
    db.select().from(settings),
    db
      .select({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        active: users.active,
        createdAt: users.createdAt,
      })
      .from(users),
    db.select().from(products),
    db.select().from(variants),
    db.select().from(productMedia),
    db.select().from(stockMovements),
    db.select().from(customers),
    db.select().from(orders),
    db.select().from(orderItems),
    db.select().from(conversations),
    db.select().from(messages),
    db.select().from(quickReplies),
    db.select().from(autoReplies),
    db.select().from(stockCounts),
    db.select().from(stockCountLines),
  ]);

  const takenAt = new Date();
  await db.update(settings).set({ lastBackupAt: takenAt }).where(eq(settings.id, 1));

  const backup = {
    about: "Safety copy of the ERP data. Photos and videos are not inside; their addresses are.",
    takenAt: takenAt.toISOString(),
    takenBy: user.email,
    formatVersion: 1,
    tables: {
      settings: business,
      users: staff,
      products: productRows,
      variants: variantRows,
      product_media: mediaRows,
      stock_movements: movementRows,
      stock_counts: countRows,
      stock_count_lines: countLineRows,
      customers: customerRows,
      orders: orderRows,
      order_items: itemRows,
      conversations: conversationRows,
      messages: messageRows,
      quick_replies: quickReplyRows,
      auto_replies: autoReplyRows,
    },
  };

  return new Response(JSON.stringify(backup, null, 1), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="erp-backup-${takenAt.toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}
