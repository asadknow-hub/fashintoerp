CREATE TABLE "order_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"body" text NOT NULL,
	"user_id" uuid,
	"user_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "order_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_notes" ADD CONSTRAINT "order_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "order_notes_order_idx" ON "order_notes" USING btree ("order_id","created_at");--> statement-breakpoint
-- The notes written so far are kept. Every note saved since the activity
-- log exists comes over with who wrote it and when...
INSERT INTO "order_notes" ("order_id", "body", "user_id", "user_name", "created_at")
SELECT a."order_id", substring(a."summary" from length('Changed the note to: ') + 1), a."user_id", a."user_name", a."at"
FROM "audit_log" a
JOIN "orders" o ON o."id" = a."order_id"
WHERE a."action" = 'order.note' AND a."summary" LIKE 'Changed the note to: %';--> statement-breakpoint
-- ...and a note that is on an order without such a record (typed when the
-- order was taken, or before the log existed) comes over under the name of
-- whoever took the order.
INSERT INTO "order_notes" ("order_id", "body", "user_id", "user_name", "created_at")
SELECT o."id", o."notes", o."created_by", coalesce(u."name", 'Earlier note'), o."created_at"
FROM "orders" o
LEFT JOIN "users" u ON u."id" = o."created_by"
WHERE coalesce(trim(o."notes"), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM "order_notes" n
    WHERE n."order_id" = o."id" AND n."body" = left(o."notes", 200)
  );
