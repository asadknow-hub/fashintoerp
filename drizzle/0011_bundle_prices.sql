ALTER TABLE "order_items" ADD COLUMN "discount" numeric(12, 2) DEFAULT '0' NOT NULL;--> statement-breakpoint
UPDATE "products" SET
	"price_4" = coalesce("price_4", "price_3", "price_2") * 4,
	"price_3" = coalesce("price_3", "price_2") * 3,
	"price_2" = "price_2" * 2
WHERE "price_2" IS NOT NULL OR "price_3" IS NOT NULL OR "price_4" IS NOT NULL;
