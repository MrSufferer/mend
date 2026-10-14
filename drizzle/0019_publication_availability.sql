-- Initial publication establishes availability only after its final blocking lock.
CREATE OR REPLACE FUNCTION public.mend_finish_execution(p_attempt uuid,p_check text,p_result jsonb DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.execution_attempts; d text; published_at timestamptz;
BEGIN
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT disposition INTO d FROM public.orders WHERE id=a.order_id FOR UPDATE;
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt FOR UPDATE;
 IF a.publisher_finished_at IS NOT NULL THEN RETURN a.final_output_check='valid'; END IF;
 IF a.stopped_at IS NULL OR p_check IS NULL OR p_check NOT IN ('valid','absent','unknown') THEN RAISE EXCEPTION 'exit_and_output_check_required'; END IF;
 IF p_check='valid' AND (p_result IS NULL OR a.output_publication IS NULL OR p_result->>'key' IS DISTINCT FROM a.output_publication->>'key' OR p_result->>'sha256' IS DISTINCT FROM a.output_publication->>'sha256') THEN RAISE EXCEPTION 'manifest_required'; END IF;
 IF p_check='absent' AND a.output_publication IS NOT NULL THEN RAISE EXCEPTION 'prepared_output_not_absence'; END IF;
 published_at=clock_timestamp();
 -- Expiry is a retention boundary, never proof of output absence or refund eligibility.
 IF p_check='valid' AND ((p_result->>'expiresAt') IS NULL OR (p_result->>'expiresAt')::timestamptz<=published_at) THEN p_check='unknown'; END IF;
 IF p_check='valid' AND d='unresolved' THEN
  UPDATE public.orders SET result=p_result,delivered_at=published_at,status='delivered' WHERE id=a.order_id;
 END IF;
 UPDATE public.execution_attempts SET publisher_finished_at=published_at,publication_fenced_at=published_at,final_output_check=p_check,
 state=CASE WHEN p_check='valid' AND d='unresolved' THEN 'completed' ELSE 'stopped' END,
 output_publication=CASE WHEN p_check='valid' THEN output_publication||'{"state":"committed"}'::jsonb ELSE output_publication END WHERE id=p_attempt;
 RETURN p_check='valid' AND d='unresolved';
END; $$;
