ALTER TABLE "orders" ADD COLUMN "recovery_observation" jsonb;--> statement-breakpoint
GRANT UPDATE (recovery_observation) ON public.orders TO mend_conversion;
--> statement-breakpoint
CREATE FUNCTION public.mend_restore_output(p_attempt uuid,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.execution_attempts; d text;
BEGIN
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt;
 SELECT disposition INTO d FROM public.orders WHERE id=a.order_id FOR UPDATE;
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt FOR UPDATE;
 IF a.publisher_finished_at IS NULL OR a.output_publication IS NULL OR p_result->>'sha256' IS DISTINCT FROM a.output_publication->>'sha256' OR p_result->>'key' IS DISTINCT FROM a.output_publication->>'key' THEN RETURN false; END IF;
 IF d<>'unresolved' THEN RETURN false; END IF;
 UPDATE public.orders SET result=p_result,delivered_at=now(),status='delivered' WHERE id=a.order_id;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.mend_restore_output(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_restore_output(uuid,jsonb) TO mend_conversion;
