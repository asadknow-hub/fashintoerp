ALTER TABLE "settings" ADD COLUMN "last_backup_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "recovery_hash" text;