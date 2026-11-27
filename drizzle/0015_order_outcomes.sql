ALTER TABLE "delivery_companies" ADD COLUMN "opened_fee" numeric(12, 2) DEFAULT '10' NOT NULL;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "back_state" text;--> statement-breakpoint
ALTER TABLE "order_items" ADD COLUMN "back_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "return_charge" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cancel_fee" numeric(12, 2);--> statement-breakpoint
-- Orders that were already cancelled or returned had their pieces put back
-- into stock at that moment, so those pieces are settled.
UPDATE "order_items" i SET "back_state" = 'stock', "back_at" = now()
FROM "orders" o
WHERE o."id" = i."order_id" AND o."status" IN ('cancelled', 'returned');
--> statement-breakpoint
-- The same for an order whose pieces came back through an exchange.
UPDATE "order_items" i SET "back_state" = 'stock', "back_at" = coalesce(x."old_items_received_at", now())
FROM "orders" x
WHERE x."exchange_of_id" = i."order_id" AND x."old_items_received" = true AND i."back_state" IS NULL;
--> statement-breakpoint
UPDATE "orders" SET "cancelled_at" = "created_at" WHERE "status" = 'cancelled' AND "cancelled_at" IS NULL;
--> statement-breakpoint
-- Returns made so far were not charged a return trip beyond what the customer paid.
UPDATE "orders" SET "return_charge" = "return_fee" WHERE "status" = 'returned' AND "return_fee" IS NOT NULL;
