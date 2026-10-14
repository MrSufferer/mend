CREATE TABLE "refund_sweeps" (
	"invocation_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid,
	"scheduled_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "refund_sweeps" ADD CONSTRAINT "refund_sweeps_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
REVOKE ALL ON public.refund_sweeps FROM PUBLIC,mend_web,mend_worker,mend_conversion,mend_registrar,mend_refund_worker;
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_sweep(p_invocation uuid,p_scheduled timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE selected uuid;
BEGIN
 IF p_invocation IS NULL OR p_scheduled IS NULL OR NOT isfinite(p_scheduled) OR p_scheduled>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid_sweep'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_invocation::text,110));
 IF EXISTS(SELECT FROM public.refund_sweeps WHERE invocation_id=p_invocation) THEN RETURN (SELECT order_id FROM public.refund_sweeps WHERE invocation_id=p_invocation); END IF;
 SELECT order_id INTO selected FROM public.mend_refund_queue() LIMIT 1;
 INSERT INTO public.refund_sweeps(invocation_id,order_id,scheduled_at) VALUES(p_invocation,selected,p_scheduled);
 RETURN selected;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mend_refund_sweep(uuid,timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mend_refund_sweep(uuid,timestamptz) TO mend_refund_worker;
