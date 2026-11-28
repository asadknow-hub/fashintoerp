ALTER TABLE "login_attempts" ADD COLUMN "ip" text;--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","created_at");