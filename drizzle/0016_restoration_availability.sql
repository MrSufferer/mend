-- Record actual availability after the publication locks, not transaction start.
CREATE OR REPLACE FUNCTION public.mend_restore_output(p_attempt uuid,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.execution_attempts; d text;
BEGIN
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt;
 SELECT disposition INTO d FROM public.orders WHERE id=a.order_id FOR UPDATE;
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt FOR UPDATE;
 IF a.publisher_finished_at IS NULL OR a.output_publication IS NULL OR p_result->>'sha256' IS DISTINCT FROM a.output_publication->>'sha256' OR p_result->>'key' IS DISTINCT FROM a.output_publication->>'key' THEN RETURN false; END IF;
 IF d<>'unresolved' OR (p_result->>'expiresAt')::timestamptz<=clock_timestamp() OR EXISTS(SELECT FROM public.execution_attempts WHERE order_id=a.order_id AND publisher_finished_at IS NULL) THEN RETURN false; END IF;
 UPDATE public.orders SET result=p_result,delivered_at=clock_timestamp(),status='delivered' WHERE id=a.order_id;
 RETURN true;
END; $$;
