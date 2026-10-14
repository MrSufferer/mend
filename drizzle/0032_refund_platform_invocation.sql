DROP FUNCTION public.mend_refund_sweep(uuid,timestamptz);
--> statement-breakpoint
ALTER TABLE public.refund_sweeps ALTER COLUMN invocation_id TYPE text USING invocation_id::text;
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_sweep(p_invocation text,p_scheduled timestamptz) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE selected uuid;
BEGIN
 IF p_invocation IS NULL OR p_invocation !~ '^[-A-Za-z0-9_]{1,256}$' OR p_scheduled IS NULL OR NOT isfinite(p_scheduled) OR p_scheduled>clock_timestamp()+interval '5 minutes' THEN RAISE EXCEPTION 'invalid_sweep'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_invocation::text,110));
 IF EXISTS(SELECT FROM public.refund_sweeps WHERE invocation_id=p_invocation) THEN RETURN (SELECT order_id FROM public.refund_sweeps WHERE invocation_id=p_invocation); END IF;
 SELECT order_id INTO selected FROM public.mend_refund_queue() LIMIT 1;
 INSERT INTO public.refund_sweeps(invocation_id,order_id,scheduled_at) VALUES(p_invocation,selected,p_scheduled);
 RETURN selected;
END $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mend_refund_sweep(text,timestamptz) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mend_refund_sweep(text,timestamptz) TO mend_refund_worker;
