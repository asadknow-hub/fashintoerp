ALTER TABLE "products" ADD COLUMN "sku" text;--> statement-breakpoint
-- Existing products take their code from the first part of an item SKU.
UPDATE "products" p
SET "sku" = (
  SELECT split_part(v."sku", '-', 1)
  FROM "variants" v
  WHERE v."product_id" = p."id"
  ORDER BY v."created_at", v."sku"
  LIMIT 1
)
WHERE p."sku" IS NULL;
