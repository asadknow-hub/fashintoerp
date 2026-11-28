ALTER TABLE "order_items" ADD COLUMN "unit_cost" numeric(12, 2);--> statement-breakpoint
-- One cost rule from now on: a piece of a product costs what its purchase
-- batches cost on average (all the money paid ÷ all the pieces bought, over
-- the batches that have an amount). Products with no amount on any batch
-- keep the costs typed by hand.
UPDATE "variants" v SET "cost" = round(b.total / b.units, 2)
FROM (
	SELECT "product_id", sum("total_cost") AS total, sum("units") AS units
	FROM "stock_purchases"
	WHERE "total_cost" IS NOT NULL
	GROUP BY "product_id"
	HAVING sum("units") > 0
) b
WHERE v."product_id" = b."product_id";--> statement-breakpoint
-- Orders taken before costs were kept on their lines get today's cost, the
-- best figure there is for them.
UPDATE "order_items" i SET "unit_cost" = v."cost"
FROM "variants" v
WHERE v."id" = i."variant_id" AND i."unit_cost" IS NULL AND v."cost" > 0;
