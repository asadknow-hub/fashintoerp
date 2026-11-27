CREATE TABLE "shipper_ref_claims" (
	"ref" text NOT NULL,
	"user_id" uuid NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shipper_ref_claims_ref_user_id_pk" PRIMARY KEY("ref","user_id")
);
--> statement-breakpoint
ALTER TABLE "shipper_ref_claims" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "shipper_ref_claims" ADD CONSTRAINT "shipper_ref_claims_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;