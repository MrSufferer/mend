CREATE TABLE "agent_sweeps" (
	"id" text PRIMARY KEY NOT NULL,
	"scheduled_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"order_id" uuid
);
--> statement-breakpoint
ALTER TABLE "agent_sweeps" ADD CONSTRAINT "agent_sweeps_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
REVOKE ALL ON public.agent_sweeps FROM PUBLIC,mend_web,mend_worker,mend_conversion,mend_registrar;
GRANT SELECT ON public.agent_sweeps TO mend_web;
GRANT SELECT,INSERT,UPDATE ON public.agent_sweeps TO mend_worker;
