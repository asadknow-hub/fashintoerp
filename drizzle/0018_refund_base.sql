ALTER TABLE "orders" ADD COLUMN "refund_base" numeric(12, 2);--> statement-breakpoint
-- Exchanges made so far: what was paid on the order each one replaces.
UPDATE "orders" x SET "refund_base" = CASE WHEN o."payment" = 'cod' THEN o."cod_amount" ELSE o."total" END
FROM "orders" o
WHERE o."id" = x."exchange_of_id" AND x."refund_base" IS NULL;
--> statement-breakpoint
-- An exchange is never "paid beforehand": its COD is what counts, even when zero.
UPDATE "orders" SET "payment" = 'cod' WHERE "exchange_of_id" IS NOT NULL AND "payment" <> 'cod';
