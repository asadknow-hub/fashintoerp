ALTER TABLE "orders" ADD COLUMN "old_items_received" boolean;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "old_items_received_at" timestamp with time zone;--> statement-breakpoint
DO $$
BEGIN
	-- One FO number, one order. Only added when the orders already in the
	-- system have no repeats, so an old repeat can't stop an update.
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
END $$;
