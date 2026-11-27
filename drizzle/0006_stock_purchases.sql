CREATE TABLE "stock_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"product_id" uuid NOT NULL,
	"units" integer NOT NULL,
	"total_cost" numeric(12, 2),
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stock_purchases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_purchases" ADD CONSTRAINT "stock_purchases_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_purchases_product_idx" ON "stock_purchases" USING btree ("product_id","created_at");--> statement-breakpoint
-- Give stock that is already in the system a purchase record to fill in:
-- one per product for its opening stock, and one for each later delivery.
INSERT INTO "stock_purchases" ("product_id", "units", "note", "created_by", "created_at")
SELECT v."product_id",
       sum(m."change")::int,
       CASE WHEN m."reason" = 'opening' THEN 'Opening stock' ELSE 'Stock received' END,
       (array_agg(m."user_id"))[1],
       m."created_at"
FROM "stock_movements" m
JOIN "variants" v ON v."id" = m."variant_id"
WHERE m."reason" IN ('opening', 'purchase') AND m."change" > 0
GROUP BY v."product_id", m."reason", m."created_at";
