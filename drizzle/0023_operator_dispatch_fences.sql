-- A replay observes the original dispatch even if its lease/session has expired.
CREATE OR REPLACE FUNCTION public.mend_operator_dispatch(p_request uuid,p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.operator_requests; i uuid;
BEGIN
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request;
 IF NOT FOUND OR r.action NOT IN ('check','restore','retry') OR r.actor<>p_actor THEN RAISE EXCEPTION 'invalid_request'; END IF;
 PERFORM 1 FROM public.orders WHERE id=r.order_id FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=r.invocation_id FOR UPDATE;
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request FOR UPDATE;
 IF r.dispatched_at IS NOT NULL THEN RETURN jsonb_build_object('reason','request_already_dispatched'); END IF;
 i=public.mend_operator_assert(p_request,r.action,p_actor);
 UPDATE public.operator_requests SET dispatched_at=clock_timestamp() WHERE id=p_request;
 RETURN jsonb_build_object('invocationId',i,'action',r.action);
END; $$;
--> statement-breakpoint
CREATE FUNCTION public.mend_operator_investigate(p_request uuid,p_inv uuid,p_actor text,p_order uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.operator_requests; started jsonb;
BEGIN
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request;
 IF NOT FOUND OR r.action<>'investigate' OR r.actor<>p_actor OR r.order_id<>p_order THEN RAISE EXCEPTION 'invalid_operator_request'; END IF;
 PERFORM 1 FROM public.orders WHERE id=r.order_id FOR UPDATE;
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request FOR UPDATE;
 IF r.finished_at IS NOT NULL OR r.deadline<=clock_timestamp() OR r.dispatched_at IS NOT NULL THEN RETURN jsonb_build_object('error','operator_request_stale'); END IF;
 IF NOT EXISTS(SELECT FROM public.auth_sessions WHERE token_hash=r.session_hash AND wallet=r.actor AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN
  PERFORM public.mend_operator_finish(p_request,'skipped','{"reason":"operator_session_expired"}'::jsonb);
  RETURN jsonb_build_object('error','operator_session_expired');
 END IF;
 started=public.mend_agent_begin(r.order_id,p_inv);
 IF started->>'error' IS NOT NULL THEN
  PERFORM public.mend_operator_finish(p_request,'skipped',jsonb_build_object('reason',started->>'error'));
 ELSE
  UPDATE public.operator_requests SET invocation_id=p_inv,dispatched_at=clock_timestamp() WHERE id=p_request;
 END IF;
 RETURN started;
END; $$;
REVOKE ALL ON FUNCTION public.mend_operator_investigate(uuid,uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_operator_investigate(uuid,uuid,text,uuid) TO mend_worker;
--> statement-breakpoint
-- Model dispatch revalidates the operator session after all admission locks, too.
CREATE OR REPLACE FUNCTION public.mend_agent_assert(p_inv uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.agent_invocations; r public.operator_requests;
BEGIN
 SELECT * INTO i FROM public.agent_invocations WHERE id=p_inv;
 IF NOT FOUND OR i.finished_at IS NOT NULL OR i.deadline<=clock_timestamp() THEN RAISE EXCEPTION 'invocation_expired'; END IF;
 SELECT * INTO r FROM public.operator_requests WHERE invocation_id=p_inv;
 IF FOUND THEN
  IF r.finished_at IS NOT NULL OR r.deadline<=clock_timestamp() OR NOT EXISTS(SELECT FROM public.auth_sessions s WHERE s.token_hash=r.session_hash AND s.wallet=r.actor AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'operator_session_expired'; END IF;
 ELSIF i.purpose='operator' THEN RAISE EXCEPTION 'operator_request_missing'; END IF;
 RETURN i.order_id;
END; $$;

--> statement-breakpoint
CREATE FUNCTION public.mend_operator_investigation_finish(p_request uuid,p_inv uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.operator_requests; i public.agent_invocations;
BEGIN
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request AND action='investigate' AND invocation_id=p_inv;
 IF NOT FOUND THEN RETURN; END IF;
 SELECT * INTO i FROM public.agent_invocations WHERE id=p_inv AND purpose='model' AND finished_at IS NOT NULL;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM public.mend_operator_finish(p_request,'investigated',jsonb_build_object('invocationId',p_inv,'outcome',i.outcome,'callsUsed',(SELECT calls_used FROM public.recovery_cases WHERE order_id=r.order_id)));
END; $$;
REVOKE ALL ON FUNCTION public.mend_operator_investigation_finish(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_operator_investigation_finish(uuid,uuid) TO mend_worker;
