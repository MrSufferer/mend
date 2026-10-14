-- Retry selection is auditable; evidence remains explanatory, never admission authority.
CREATE OR REPLACE FUNCTION public.mend_agent_record(p_inv uuid,p_action uuid,p_tool text,p_outcome text,p_evidence jsonb,p_observe integer DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE oid uuid;
BEGIN
 oid=public.mend_agent_assert(p_inv);
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 PERFORM public.mend_agent_assert(p_inv);
 IF p_tool NOT IN ('inspect_order','inspect_execution','inspect_output','related_orders','observe_later','restore_result','retry_once') OR length(p_outcome)>64 OR octet_length(p_evidence::text)>8192 THEN RAISE EXCEPTION 'invalid_agent_action'; END IF;
 IF p_observe IS NOT NULL THEN
  IF p_tool<>'observe_later' OR p_observe<60 OR p_observe>900 THEN RAISE EXCEPTION 'invalid_observation'; END IF;
  UPDATE public.recovery_cases SET observe_at=clock_timestamp()+make_interval(secs=>p_observe),updated_at=clock_timestamp() WHERE order_id=oid;
 END IF;
 INSERT INTO public.agent_actions(id,invocation_id,order_id,tool,outcome,evidence) VALUES(p_action,p_inv,oid,p_tool,p_outcome,p_evidence);
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_record(uuid,uuid,text,text,jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_record(uuid,uuid,text,text,jsonb,integer) TO mend_worker;
