ALTER TABLE "orders" ADD COLUMN "returned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "return_fee" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "exchange_of_id" uuid;