CREATE TABLE "execution_attempts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"state" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stopped_at" timestamp with time zone,
	"stop_reason" text,
	"parser_exit_code" integer,
	"diagnostic_code" text
);
--> statement-breakpoint
CREATE TABLE "result_downloads" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"wallet" text NOT NULL,
	"served_at" timestamp with time zone DEFAULT now() NOT NULL,
	"size" integer NOT NULL,
	"sha256" text NOT NULL
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "execution_started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "delivered_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "result" jsonb;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "last_download_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "result_downloads" ADD CONSTRAINT "result_downloads_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "execution_order_generation" ON "execution_attempts" USING btree ("order_id","generation");
--> statement-breakpoint
REVOKE ALL ON public.execution_attempts, public.result_downloads FROM PUBLIC, mend_web, mend_conversion, mend_worker, mend_registrar;
--> statement-breakpoint
GRANT SELECT ON public.execution_attempts, public.result_downloads TO mend_web, mend_conversion, mend_worker, mend_registrar;
--> statement-breakpoint
GRANT INSERT, UPDATE ON public.execution_attempts TO mend_conversion;
--> statement-breakpoint
GRANT INSERT ON public.result_downloads TO mend_web;
--> statement-breakpoint
GRANT UPDATE (status, execution_started_at, delivered_at, result) ON public.orders TO mend_conversion;
--> statement-breakpoint
GRANT UPDATE (last_download_at) ON public.orders TO mend_web;
