ALTER TABLE "settings" ALTER COLUMN "currency" SET DEFAULT 'AED';--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "phone2" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "customers" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "area" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "street" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "phone2" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "cod_amount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "instruction" text;--> statement-breakpoint
-- The system works in one currency only.
UPDATE "settings" SET "currency" = 'AED';--> statement-breakpoint
-- Orders taken before this change were cash on delivery for their full total.
UPDATE "orders" SET "cod_amount" = "total" WHERE "payment" = 'cod';--> statement-breakpoint
UPDATE "orders" o SET "city" = c."city", "street" = c."address"
FROM "customers" c WHERE c."id" = o."customer_id" AND o."city" IS NULL;
