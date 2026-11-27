CREATE TABLE "delivery_companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"rate" numeric(12, 2) DEFAULT '0' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "delivery_companies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_company_id" uuid;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "portal_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "dispatched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivery_charge" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_delivery_company_id_delivery_companies_id_fk" FOREIGN KEY ("delivery_company_id") REFERENCES "public"."delivery_companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
UPDATE "orders" SET
	"portal_at" = coalesce("portal_at", "created_at"),
	"dispatched_at" = CASE WHEN "status" IN ('shipped', 'delivered') THEN coalesce("dispatched_at", "created_at") END,
	"delivered_at" = CASE WHEN "status" = 'delivered' THEN coalesce("delivered_at", "created_at") END
WHERE "status" IN ('confirmed', 'packed', 'shipped', 'delivered');
