ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text USING "role"::text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'staff';--> statement-breakpoint
DROP TYPE "public"."user_role";--> statement-breakpoint
-- Three roles now: the one System Admin ("admin"), partners ("owner"), staff.
-- The account that set the system up (the oldest owner) is the System Admin;
-- every other owner stays an Owner.
UPDATE "users" SET "role" = 'admin'
WHERE "id" = (SELECT "id" FROM "users" WHERE "role" = 'owner' ORDER BY "created_at", "id" LIMIT 1)
  AND NOT EXISTS (SELECT 1 FROM "users" WHERE "role" = 'admin');--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_known" CHECK ("role" IN ('admin', 'owner', 'staff'));--> statement-breakpoint
-- There is only ever one System Admin.
CREATE UNIQUE INDEX "users_one_admin" ON "users" ((true)) WHERE "role" = 'admin';
