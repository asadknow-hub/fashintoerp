CREATE TABLE "stock_purchase_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"purchase_id" uuid NOT NULL,
	"variant_id" uuid NOT NULL,
	"quantity" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_purchase_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price_2" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price_3" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "price_4" numeric(12, 2);--> statement-breakpoint
ALTER TABLE "stock_purchase_lines" ADD CONSTRAINT "stock_purchase_lines_purchase_id_stock_purchases_id_fk" FOREIGN KEY ("purchase_id") REFERENCES "public"."stock_purchases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_purchase_lines" ADD CONSTRAINT "stock_purchase_lines_variant_id_variants_id_fk" FOREIGN KEY ("variant_id") REFERENCES "public"."variants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_purchase_lines_purchase_idx" ON "stock_purchase_lines" USING btree ("purchase_id");--> statement-breakpoint
CREATE INDEX "stock_purchase_lines_variant_idx" ON "stock_purchase_lines" USING btree ("variant_id");--> statement-breakpoint
INSERT INTO "stock_purchase_lines" ("purchase_id", "variant_id", "quantity")
SELECT p."id", m."variant_id", sum(m."change")::int
FROM "stock_purchases" p
JOIN "variants" v ON v."product_id" = p."product_id"
JOIN "stock_movements" m ON m."variant_id" = v."id"
	AND m."created_at" = p."created_at"
	AND m."reason" IN ('opening', 'purchase')
	AND m."change" > 0
WHERE p."units" = (
	SELECT coalesce(sum(m2."change"), 0)
	FROM "stock_movements" m2
	JOIN "variants" v2 ON v2."id" = m2."variant_id"
	WHERE v2."product_id" = p."product_id"
		AND m2."created_at" = p."created_at"
		AND m2."reason" IN ('opening', 'purchase')
		AND m2."change" > 0
)
GROUP BY p."id", m."variant_id";
