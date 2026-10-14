-- Legacy stop authority belongs to deterministic conversion, not model investigation.
REVOKE EXECUTE ON FUNCTION public.mend_request_stop(uuid) FROM mend_worker;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_agent_restore(p_inv uuid,p_attempt uuid,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE oid uuid; a public.execution_attempts;
BEGIN
 oid=public.mend_agent_assert(p_inv);
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt AND order_id=oid FOR UPDATE;
 -- All potentially blocking locks precede the final real-clock authority check.
 PERFORM public.mend_agent_assert(p_inv);
 IF NOT FOUND OR a.publisher_finished_at IS NULL THEN RETURN false; END IF;
 IF EXISTS(SELECT FROM public.execution_attempts WHERE order_id=oid AND publisher_finished_at IS NULL) THEN RETURN false; END IF;
 IF (p_result->>'expiresAt')::timestamptz<=clock_timestamp() THEN RETURN false; END IF;
 RETURN public.mend_restore_output(p_attempt,p_result);
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_agent_finish(p_inv uuid,p_outcome text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.agent_invocations; d text;
BEGIN
 SELECT * INTO i FROM public.agent_invocations WHERE id=p_inv;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT disposition INTO d FROM public.orders WHERE id=i.order_id FOR UPDATE;
 SELECT * INTO i FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 IF i.finished_at IS NOT NULL THEN RETURN; END IF;
 IF i.deadline<=clock_timestamp() THEN p_outcome='invocation_timeout'; END IF;
 IF p_outcome NOT IN ('investigated','model_unavailable','budget_exhausted','invocation_timeout','tool_error') THEN p_outcome='tool_error'; END IF;
 IF p_outcome='investigated' AND d='unresolved' AND NOT EXISTS(SELECT FROM public.agent_actions WHERE invocation_id=p_inv AND tool='observe_later') THEN p_outcome='insufficient_evidence'; END IF;
 UPDATE public.agent_invocations SET finished_at=clock_timestamp(),outcome=p_outcome WHERE id=p_inv;
 UPDATE public.recovery_cases SET escalation=CASE WHEN p_outcome='investigated' THEN NULL ELSE p_outcome END,updated_at=clock_timestamp() WHERE order_id=i.order_id;
END; $$;
