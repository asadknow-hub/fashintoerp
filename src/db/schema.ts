import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const money = (name: string) => numeric(name, { precision: 12, scale: 2 });

// Every table has row level security switched on with no policies. The app
// connects as the table owner, so it is unaffected, but Supabase's public
// Data API (anon key) cannot read or write anything.

/* ---------- Business settings (one row) ---------- */

export const settings = pgTable("settings", {
  id: integer("id").primaryKey().default(1),
  businessName: text("business_name").notNull(),
  currency: text("currency").notNull().default("AED"),
  timezone: text("timezone").notNull().default("UTC"),
  // When an owner last downloaded a safety copy of the data.
  lastBackupAt: timestamp("last_backup_at", { withTimezone: true }),
  createdAt: createdAt(),
}).enableRLS();

/* ---------- Team & login ---------- */

export const userRole = pgEnum("user_role", ["owner", "staff"]);

export const users = pgTable("users", {
  id: id(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  // Scrambled one-time code for getting back in after a forgotten password.
  recoveryHash: text("recovery_hash"),
  role: userRole("role").notNull().default("staff"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}).enableRLS();

export const sessions = pgTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
).enableRLS();

export const loginAttempts = pgTable(
  "login_attempts",
  {
    id: id(),
    email: text("email").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("login_attempts_email_idx").on(t.email, t.createdAt)],
).enableRLS();

/* ---------- Inventory ---------- */

export const products = pgTable("products", {
  id: id(),
  name: text("name").notNull(),
  // The product's own code. Each size and color has a longer SKU built on it.
  sku: text("sku"),
  category: text("category"),
  description: text("description"),
  // Price per piece when someone buys 2, 3, or 4 and more of this product.
  // Empty means the same as for fewer pieces. The price for one piece is on
  // each variant.
  price2: money("price_2"),
  price3: money("price_3"),
  price4: money("price_4"),
  archived: boolean("archived").notNull().default(false),
  createdAt: createdAt(),
}).enableRLS();

// A variant is one sellable item: e.g. "Linen Shirt / M / Black".
export const variants = pgTable(
  "variants",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    sku: text("sku").notNull().unique(),
    size: text("size"),
    color: text("color"),
    price: money("price").notNull().default("0"),
    cost: money("cost").notNull().default("0"),
    stock: integer("stock").notNull().default(0),
    lowStockAt: integer("low_stock_at").notNull().default(5),
    createdAt: createdAt(),
  },
  (t) => [
    index("variants_product_idx").on(t.productId),
    check("variants_stock_not_negative", sql`${t.stock} >= 0`),
  ],
).enableRLS();

export const mediaKind = pgEnum("media_kind", ["image", "video"]);

// Photos and videos of a product. The tag says what it is: "Size chart",
// "Inside video" and so on. The files themselves live in file storage; this
// table only keeps their address.
export const productMedia = pgTable(
  "product_media",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    kind: mediaKind("kind").notNull(),
    url: text("url").notNull(),
    // A small picture of the photo, or of one frame of the video, so lists
    // and galleries load fast. Older files may not have one.
    thumbUrl: text("thumb_url"),
    tag: text("tag").notNull(),
    fileName: text("file_name"),
    createdAt: createdAt(),
  },
  (t) => [index("product_media_product_idx").on(t.productId, t.createdAt)],
).enableRLS();

export const stockReason = pgEnum("stock_reason", [
  "opening",
  "purchase",
  "sale",
  "return",
  "cancelled",
  "damage",
  "adjustment",
]);

// Every change to stock is written here, so we always know why a number moved.
export const stockMovements = pgTable(
  "stock_movements",
  {
    id: id(),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    change: integer("change").notNull(),
    reason: stockReason("reason").notNull(),
    note: text("note"),
    orderId: uuid("order_id"),
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("stock_movements_variant_idx").on(t.variantId, t.createdAt)],
).enableRLS();

// A batch of stock that was bought: how many pieces and the total paid. One
// is written whenever stock is added (opening stock or a delivery). The total
// is empty until someone fills it in. Its lines say which sizes and colors
// came in; changing or deleting a batch that has lines moves stock with it.
// Old batches without lines are money records only.
export const stockPurchases = pgTable(
  "stock_purchases",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    units: integer("units").notNull(),
    totalCost: money("total_cost"),
    note: text("note"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("stock_purchases_product_idx").on(t.productId, t.createdAt)],
).enableRLS();

export const stockPurchaseLines = pgTable(
  "stock_purchase_lines",
  {
    id: id(),
    purchaseId: uuid("purchase_id")
      .notNull()
      .references(() => stockPurchases.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    quantity: integer("quantity").notNull(),
  },
  (t) => [
    index("stock_purchase_lines_purchase_idx").on(t.purchaseId),
    index("stock_purchase_lines_variant_idx").on(t.variantId),
  ],
).enableRLS();

// A fresh count is saved as a snapshot: what was counted next to what the
// system had at that moment. It is for reference only and never changes
// stock by itself, so it can be edited or deleted freely.
export const stockCounts = pgTable(
  "stock_counts",
  {
    id: id(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    note: text("note"),
    // Set when someone chose to make the real stock match this count.
    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: createdAt(),
  },
  (t) => [index("stock_counts_product_idx").on(t.productId, t.createdAt)],
).enableRLS();

export const stockCountLines = pgTable(
  "stock_count_lines",
  {
    id: id(),
    countId: uuid("count_id")
      .notNull()
      .references(() => stockCounts.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id, { onDelete: "cascade" }),
    counted: integer("counted").notNull(),
    // What the system had for this item when it was counted.
    systemStock: integer("system_stock").notNull(),
  },
  (t) => [uniqueIndex("stock_count_lines_unique_idx").on(t.countId, t.variantId)],
).enableRLS();

/* ---------- Customers & orders ---------- */

export const customers = pgTable(
  "customers",
  {
    id: id(),
    name: text("name").notNull(),
    phone: text("phone"),
    // A second number to try when the first doesn't answer.
    phone2: text("phone2"),
    email: text("email"),
    // Street, building, apartment.
    address: text("address"),
    area: text("area"),
    city: text("city"),
    country: text("country"),
    notes: text("notes"),
    createdAt: createdAt(),
  },
  (t) => [index("customers_phone_idx").on(t.phone)],
).enableRLS();

export const orderStatus = pgEnum("order_status", [
  "new",
  "confirmed",
  "packed",
  "shipped",
  "delivered",
  "cancelled",
  "returned",
]);

export const paymentMethod = pgEnum("payment_method", ["cod", "prepaid"]);

export const orders = pgTable(
  "orders",
  {
    id: id(),
    number: integer("number")
      .notNull()
      .generatedAlwaysAsIdentity({ startWith: 1001 }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id),
    status: orderStatus("status").notNull().default("new"),
    payment: paymentMethod("payment").notNull().default("cod"),
    source: text("source"),
    // Where it is going. "shippingAddress" is the same thing as one line.
    shippingAddress: text("shipping_address"),
    country: text("country"),
    city: text("city"),
    area: text("area"),
    street: text("street"),
    // The second number the courier can call.
    phone2: text("phone2"),
    // How much the courier collects on delivery. Zero when already paid.
    codAmount: money("cod_amount").notNull().default("0"),
    // What the courier should know: "call before coming", "leave at reception".
    instruction: text("instruction"),
    shippingFee: money("shipping_fee").notNull().default("0"),
    discount: money("discount").notNull().default("0"),
    total: money("total").notNull().default("0"),
    trackingNumber: text("tracking_number"),
    notes: text("notes"),
    createdBy: uuid("created_by").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("orders_number_idx").on(t.number),
    index("orders_customer_idx").on(t.customerId),
    index("orders_status_idx").on(t.status),
  ],
).enableRLS();

export const orderItems = pgTable(
  "order_items",
  {
    id: id(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    variantId: uuid("variant_id")
      .notNull()
      .references(() => variants.id),
    quantity: integer("quantity").notNull(),
    unitPrice: money("unit_price").notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)],
).enableRLS();

/* ---------- Chats (inbox) ---------- */

export const chatChannel = pgEnum("chat_channel", [
  "whatsapp",
  "instagram",
  "messenger",
]);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    channel: chatChannel("channel").notNull(),
    // The other person's id on that channel (phone number / Instagram id / Messenger id).
    externalId: text("external_id").notNull(),
    contactName: text("contact_name"),
    customerId: uuid("customer_id").references(() => customers.id, {
      onDelete: "set null",
    }),
    assignedTo: uuid("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),
    open: boolean("open").notNull().default(true),
    unread: integer("unread").notNull().default(0),
    lastMessage: text("last_message"),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversations_channel_external_idx").on(
      t.channel,
      t.externalId,
    ),
    index("conversations_last_idx").on(t.lastMessageAt),
  ],
).enableRLS();

export const messageDirection = pgEnum("message_direction", ["in", "out"]);
export const messageStatus = pgEnum("message_status", [
  "received",
  "sent",
  "failed",
]);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    direction: messageDirection("direction").notNull(),
    body: text("body").notNull(),
    status: messageStatus("status").notNull(),
    error: text("error"),
    // Message id on the channel, used to ignore duplicates.
    externalId: text("external_id").unique(),
    // Who sent it from our side. Empty for customer messages and auto-replies.
    userId: uuid("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    automated: boolean("automated").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("messages_conversation_idx").on(t.conversationId, t.createdAt)],
).enableRLS();

// Saved replies the team can insert with one click.
export const quickReplies = pgTable("quick_replies", {
  id: id(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdAt: createdAt(),
}).enableRLS();

// Auto-replies: when a customer message contains the keyword, send the reply.
export const autoReplies = pgTable("auto_replies", {
  id: id(),
  keyword: text("keyword").notNull(),
  reply: text("reply").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}).enableRLS();

/* ---------- Relations ---------- */

export const productsRelations = relations(products, ({ many }) => ({
  variants: many(variants),
}));

export const variantsRelations = relations(variants, ({ one, many }) => ({
  product: one(products, {
    fields: [variants.productId],
    references: [products.id],
  }),
  movements: many(stockMovements),
}));

export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  variant: one(variants, {
    fields: [stockMovements.variantId],
    references: [variants.id],
  }),
  user: one(users, { fields: [stockMovements.userId], references: [users.id] }),
}));

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, { fields: [orderItems.orderId], references: [orders.id] }),
  variant: one(variants, {
    fields: [orderItems.variantId],
    references: [variants.id],
  }),
}));

export const conversationsRelations = relations(
  conversations,
  ({ one, many }) => ({
    customer: one(customers, {
      fields: [conversations.customerId],
      references: [customers.id],
    }),
    messages: many(messages),
  }),
);

export const messagesRelations = relations(messages, ({ one }) => ({
  conversation: one(conversations, {
    fields: [messages.conversationId],
    references: [conversations.id],
  }),
  user: one(users, { fields: [messages.userId], references: [users.id] }),
}));
