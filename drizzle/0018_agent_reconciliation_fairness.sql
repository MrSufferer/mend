CREATE OR REPLACE FUNCTION public.mend_agent_reconcile() RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE oid uuid; n integer=0;
BEGIN
 FOR oid IN SELECT o.id FROM public.orders o WHERE o.disposition='unresolved' AND EXISTS(SELECT FROM public.recovery_cases c WHERE c.order_id=o.id AND ((c.calls_used>=12 AND c.escalation IS DISTINCT FROM 'budget_exhausted') OR EXISTS(SELECT FROM public.agent_invocations i WHERE i.order_id=o.id AND i.finished_at IS NULL AND i.deadline<=clock_timestamp()))) ORDER BY o.paid_at,o.id LIMIT 10 FOR UPDATE SKIP LOCKED LOOP
  UPDATE public.agent_invocations SET finished_at=clock_timestamp(),outcome='invocation_timeout' WHERE order_id=oid AND finished_at IS NULL AND deadline<=clock_timestamp();
  UPDATE public.recovery_cases SET escalation=CASE WHEN calls_used>=12 THEN 'budget_exhausted' ELSE 'invocation_timeout' END,updated_at=clock_timestamp() WHERE order_id=oid;
  n=n+1;
 END LOOP;
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_reconcile() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_reconcile() TO mend_worker;
