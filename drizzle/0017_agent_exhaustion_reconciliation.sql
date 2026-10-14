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
 IF d='unresolved' AND EXISTS(SELECT FROM public.recovery_cases WHERE order_id=i.order_id AND calls_used>=12) THEN p_outcome='budget_exhausted'; END IF;
 UPDATE public.agent_invocations SET finished_at=clock_timestamp(),outcome=p_outcome WHERE id=p_inv;
 UPDATE public.recovery_cases SET escalation=CASE WHEN p_outcome='investigated' THEN NULL ELSE p_outcome END,updated_at=clock_timestamp() WHERE order_id=i.order_id;
END; $$;
--> statement-breakpoint
CREATE FUNCTION public.mend_agent_reconcile() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE oid uuid; n integer=0;
BEGIN
 FOR oid IN SELECT o.id FROM public.orders o WHERE o.disposition='unresolved' AND EXISTS(SELECT FROM public.recovery_cases c WHERE c.order_id=o.id AND (c.calls_used>=12 OR EXISTS(SELECT FROM public.agent_invocations i WHERE i.order_id=o.id AND i.finished_at IS NULL AND i.deadline<=clock_timestamp()))) ORDER BY o.paid_at,o.id LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
  UPDATE public.agent_invocations SET finished_at=clock_timestamp(),outcome='invocation_timeout' WHERE order_id=oid AND finished_at IS NULL AND deadline<=clock_timestamp();
  UPDATE public.recovery_cases SET escalation=CASE WHEN calls_used>=12 THEN 'budget_exhausted' ELSE 'invocation_timeout' END,updated_at=clock_timestamp() WHERE order_id=oid;
  n=n+1;
 END LOOP;
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_reconcile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_reconcile() TO mend_worker;
