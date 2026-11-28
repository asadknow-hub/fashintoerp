import { relations, sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
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


export const users = pgTable(
  "users",
  {
    id: id(),
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    // Scrambled one-time code for getting back in after a forgotten password.
    recoveryHash: text("recovery_hash"),
    // "admin" is the one System Admin, "owner" a partner. See src/lib/roles.ts.
    role: text("role", { enum: ["admin", "owner", "staff"] }).notNull().default("staff"),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [
    check("users_role_known", sql`${t.role} IN ('admin', 'owner', 'staff')`),
    // There is only ever one System Admin.
    uniqueIndex("users_one_admin")
      .on(sql`(true)`)
      .where(sql`${t.role} = 'admin'`),
  ],
).enableRLS();

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
    // Where the try came from, so one place can't lock a person out.
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("login_attempts_email_idx").on(t.email, t.createdAt),
    index("login_attempts_ip_idx").on(t.ip, t.createdAt),
  ],
).enableRLS();

/* ---------- Inventory ---------- */

export const products = pgTable("products", {
  id: id(),
  name: text("name").notNull(),
  // The product's own code. Each size and color has a longer SKU built on it.
  sku: text("sku"),
  category: text("category"),
  description: text("description"),
  // What 2, 3 and 4 pieces of this product cost together (see lib/offer.ts).
  // Empty means no special price for that many. The price for one piece is
  // on each variant.
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

// The courier companies that deliver orders, with what each usually charges
// for one delivery. Set up in Settings and picked when an order is entered
// in the courier's portal. A company that orders already point at is hidden
// (not active) rather than deleted.
export const deliveryCompanies = pgTable("delivery_companies", {
  id: id(),
  name: text("name").notNull(),
  rate: money("rate").notNull().default("0"),
  // What the company bills when a customer opens the parcel and then
  // refuses it.
  openedFee: money("opened_fee").notNull().default("10"),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
}).enableRLS();

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
    // The steps after an order is taken: entered in the courier's portal
    // (with which company), handed over, and delivered. The charge is what
    // the courier billed for this delivery, confirmed when it is delivered.
    deliveryCompanyId: uuid("delivery_company_id").references(() => deliveryCompanies.id, {
      onDelete: "set null",
    }),
    portalAt: timestamp("portal_at", { withTimezone: true }),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    deliveryCharge: money("delivery_charge"),
    // A return (after delivery). The delivery company charges for the trip
    // back (returnCharge), which comes off the payout. The customer gets
    // their money back by bank transfer, less the part of that delivery
    // cost they agreed to cover (returnFee): usually all of it, sometimes
    // less, sometimes nothing. refundSentAt is when the transfer was made.
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    returnFee: money("return_fee"),
    returnCharge: money("return_charge"),
    refundSentAt: timestamp("refund_sent_at", { withTimezone: true }),
    // A cancellation: when, and what the delivery company charged for it
    // (they charge when the customer opened the parcel before refusing it).
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    cancelFee: money("cancel_fee"),
    // Set on an order that replaces another one: the order it is an
    // exchange for.
    exchangeOfId: uuid("exchange_of_id"),
    // On an exchange: what the customer paid for the goods on the order it
    // replaces. A return of the exchange gives that back (its own COD is only
    // the delivery charge).
    refundBase: money("refund_base"),
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
    // One FO number, one order (whatever the letter case).
    uniqueIndex("orders_ref_unique")
      .on(sql`upper(${t.trackingNumber})`)
      .where(sql`${t.trackingNumber} IS NOT NULL`),
    // The lists show the newest first.
    index("orders_created_idx").on(t.createdAt.desc(), t.id),
    // "Which order replaced this one?" is asked for every row of a list.
    index("orders_exchange_of_idx")
      .on(t.exchangeOfId)
      .where(sql`${t.exchangeOfId} IS NOT NULL`),
  ],
).enableRLS();

// Who is typing an order with which shipper ref right now. The Create Order
// screen keeps its line fresh while the ref is in the box, so two people who
// start on the same FO number can be told about each other. Old lines are
// simply ignored.
export const shipperRefClaims = pgTable(
  "shipper_ref_claims",
  {
    ref: text("ref").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.ref, t.userId] })],
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
    // Taken off this line by a multi-piece price, so the line comes to
    // quantity × unit price − discount.
    discount: money("discount").notNull().default("0"),
    // What one piece cost the business when the order was taken, so profit
    // can be worked out later whatever stock costs by then. Empty when the
    // cost was not known.
    unitCost: money("unit_cost"),
    // For pieces that are on their way back (a return, an exchange, a parcel
    // refused at the door): what happened to them once they arrived.
    // Empty = not here yet, "stock" = put back into stock, "discarded" =
    // thrown away, "none" = not coming back.
    backState: text("back_state"),
    backAt: timestamp("back_at", { withTimezone: true }),
  },
  (t) => [
    index("order_items_order_idx").on(t.orderId),
    index("order_items_variant_idx").on(t.variantId),
  ],
).enableRLS();

// The record of who did what and when: every change made in the system
// writes one line here. Lines are never edited or removed by the app. The
// person's name is kept on the line itself, so it still reads right after
// their account is gone.
export const auditLog = pgTable(
  "audit_log",
  {
    id: id(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userName: text("user_name").notNull(),
    // orders, stock, products, staff, settings or account.
    area: text("area").notNull(),
    // A short code for the kind of change, e.g. "order.delivered".
    action: text("action").notNull(),
    // What it was done to ("Order FO003", "Linen Shirt") and what was done.
    subject: text("subject").notNull(),
    summary: text("summary").notNull(),
    orderId: uuid("order_id"),
    productId: uuid("product_id"),
  },
  (t) => [
    index("audit_log_at_idx").on(t.at),
    index("audit_log_order_idx").on(t.orderId),
    index("audit_log_area_idx").on(t.area, t.at),
  ],
).enableRLS();

// Things that went wrong on the server (a page or a save that failed), kept
// so the System Admin can see that something broke and when. Old lines are
// cleared by themselves.
export const errorLog = pgTable(
  "error_log",
  {
    id: id(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    // The page or action it happened on, and what the error said.
    path: text("path").notNull(),
    message: text("message").notNull(),
    // The short code shown to the person on the "didn't load" screen.
    digest: text("digest"),
  },
  (t) => [index("error_log_at_idx").on(t.at)],
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
