CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY NOT NULL,
	"submission_id" uuid NOT NULL,
	"capability_hash" text NOT NULL,
	"owner_wallet" text,
	"status" text DEFAULT 'unpaid' NOT NULL,
	"terms" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"upload_created_at" timestamp with time zone NOT NULL,
	"upload_expires_at" timestamp with time zone NOT NULL,
	"upload_key" text NOT NULL,
	"upload_size" integer NOT NULL,
	"upload_sha256" text NOT NULL,
	"pages" integer NOT NULL,
	CONSTRAINT "orders_submission_id_unique" UNIQUE("submission_id")
);
--> statement-breakpoint
CREATE TABLE "recovery_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"policy" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"capability_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"rejected" text
);
--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orders_owner_created" ON "orders" USING btree ("owner_wallet","created_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "submission_capability_idempotency" ON "submissions" USING btree ("capability_hash","idempotency_key");
--> statement-breakpoint
REVOKE ALL ON public.orders, public.submissions, public.recovery_policies FROM PUBLIC, mend_web, mend_conversion, mend_registrar, mend_worker;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO mend_web, mend_conversion, mend_registrar, mend_worker;
--> statement-breakpoint
GRANT SELECT ON public.orders, public.submissions, public.recovery_policies TO mend_web;
--> statement-breakpoint
GRANT INSERT ON public.orders, public.submissions TO mend_web;
--> statement-breakpoint
GRANT UPDATE (rejected) ON public.submissions TO mend_web;
--> statement-breakpoint
GRANT UPDATE (owner_wallet) ON public.orders TO mend_web;
--> statement-breakpoint
GRANT SELECT ON public.orders TO mend_conversion, mend_registrar, mend_worker;
