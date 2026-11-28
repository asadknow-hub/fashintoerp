CREATE TABLE "error_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"path" text NOT NULL,
	"message" text NOT NULL,
	"digest" text
);
--> statement-breakpoint
ALTER TABLE "error_log" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "error_log_at_idx" ON "error_log" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_log_area_idx" ON "audit_log" USING btree ("area","at");--> statement-breakpoint
CREATE INDEX "order_items_variant_idx" ON "order_items" USING btree ("variant_id");--> statement-breakpoint
-- One FO number, one order. It was first added in 0014, but only when the
-- orders had no repeats at that moment; it is tried again here. If two
-- orders still share an FO number it is left out (the app's own check keeps
-- guarding new orders) rather than stopping this update.
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM "orders"
		WHERE "tracking_number" IS NOT NULL
		GROUP BY upper("tracking_number")
		HAVING count(*) > 1
	) THEN
		CREATE UNIQUE INDEX IF NOT EXISTS "orders_ref_unique"
			ON "orders" (upper("tracking_number"))
			WHERE "tracking_number" IS NOT NULL;
	END IF;
END $$;--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at" DESC NULLS LAST,"id");--> statement-breakpoint
CREATE INDEX "orders_exchange_of_idx" ON "orders" USING btree ("exchange_of_id") WHERE "orders"."exchange_of_id" IS NOT NULL;--> statement-breakpoint
-- These two were made by hand in 0020; they are now part of the schema, so
-- they are only created where they are missing.
CREATE UNIQUE INDEX IF NOT EXISTS "users_one_admin" ON "users" USING btree ((true)) WHERE "users"."role" = 'admin';--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_role_known";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_known" CHECK ("users"."role" IN ('admin', 'owner', 'staff'));