CREATE FUNCTION public.mend_operator_pause(p_id uuid,p_session text,p_actor text,p_reason text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.service_availability;
BEGIN
 SELECT * INTO s FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 -- The server binds p_actor to configured operator authority. Recheck SIWE after waiting.
 IF NOT EXISTS(SELECT FROM public.auth_sessions WHERE token_hash=p_session AND wallet=p_actor AND chain_id=5042002 AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RETURN jsonb_build_object('error','operator_session_expired'); END IF;
 IF p_reason IS NULL OR length(btrim(p_reason))<3 OR length(p_reason)>240 THEN RAISE EXCEPTION 'invalid_pause_reason'; END IF;
 IF EXISTS(SELECT FROM public.service_incidents WHERE id=p_id AND actor_kind='operator' AND actor=p_actor) THEN RETURN jsonb_build_object('paused',s.paused,'generation',s.generation); END IF;
 UPDATE public.service_availability SET paused=true,generation=generation+1,paused_at=clock_timestamp() WHERE id='merchant' RETURNING * INTO s;
 INSERT INTO public.service_incidents(id,actor_kind,actor,reason,evidence,generation,failure_generation) VALUES(p_id,'operator',p_actor,btrim(p_reason),jsonb_build_object('attemptIds','[]'::jsonb,'orderIds',COALESCE((SELECT jsonb_agg(order_id ORDER BY order_id) FROM (SELECT DISTINCT order_id FROM public.processing_failures WHERE confirmed_at>=clock_timestamp()-interval '5 minutes') f),'[]'::jsonb)),s.generation,s.failure_generation);
 RETURN jsonb_build_object('paused',true,'generation',s.generation);
END; $$;
REVOKE ALL ON FUNCTION public.mend_operator_pause(uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_operator_pause(uuid,text,text,text) TO mend_web;
--> statement-breakpoint
CREATE FUNCTION public.mend_agent_pause(p_inv uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.service_availability; oid uuid; t timestamptz; evidence jsonb; n integer;
BEGIN
 SELECT * INTO s FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 oid=public.mend_agent_assert(p_inv);
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 PERFORM public.mend_agent_assert(p_inv);
 IF EXISTS(SELECT FROM public.service_incidents WHERE id=p_inv) THEN RETURN jsonb_build_object('paused',s.paused,'existing',true); END IF;
 t=clock_timestamp();
 IF NOT EXISTS(SELECT FROM public.processing_failures WHERE order_id=oid AND confirmed_at>=t-interval '5 minutes' AND confirmed_at<=t) THEN RETURN jsonb_build_object('paused',false,'reason','related_failure_evidence_required'); END IF;
 SELECT count(*) INTO n FROM public.processing_failures WHERE confirmed_at>=t-interval '5 minutes' AND confirmed_at<=t;
 IF n<2 THEN RETURN jsonb_build_object('paused',false,'reason','related_failure_evidence_required'); END IF;
 SELECT jsonb_build_object('attemptIds',jsonb_agg(attempt_id ORDER BY attempt_id),'orderIds',(SELECT jsonb_agg(x.order_id ORDER BY x.order_id) FROM (SELECT DISTINCT order_id FROM public.processing_failures WHERE confirmed_at>=t-interval '5 minutes' AND confirmed_at<=t) x)) INTO evidence FROM public.processing_failures WHERE confirmed_at>=t-interval '5 minutes' AND confirmed_at<=t;
 UPDATE public.service_availability SET paused=true,generation=generation+1,paused_at=t WHERE id='merchant' RETURNING * INTO s;
 INSERT INTO public.service_incidents(id,actor_kind,actor,reason,evidence,generation,failure_generation,created_at) VALUES(p_inv,'agent',p_inv::text,'Agent requested an earlier pause using related confirmed processing failures',evidence,s.generation,s.failure_generation,t);
 RETURN jsonb_build_object('paused',true,'generation',s.generation,'evidence',evidence);
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_pause(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_pause(uuid) TO mend_worker;
--> statement-breakpoint
-- Preserve the existing action bounds; add only the restrictive pause tool.
-- Retry selection is auditable; evidence remains explanatory, never admission authority.
CREATE OR REPLACE FUNCTION public.mend_agent_record(p_inv uuid,p_action uuid,p_tool text,p_outcome text,p_evidence jsonb,p_observe integer DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE oid uuid;
BEGIN
 oid=public.mend_agent_assert(p_inv);
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 PERFORM public.mend_agent_assert(p_inv);
 IF p_tool NOT IN ('inspect_order','inspect_execution','inspect_output','related_orders','observe_later','restore_result','retry_once','request_pause') OR length(p_outcome)>64 OR octet_length(p_evidence::text)>8192 THEN RAISE EXCEPTION 'invalid_agent_action'; END IF;
 IF p_observe IS NOT NULL THEN
  IF p_tool<>'observe_later' OR p_observe<60 OR p_observe>900 THEN RAISE EXCEPTION 'invalid_observation'; END IF;
  UPDATE public.recovery_cases SET observe_at=clock_timestamp()+make_interval(secs=>p_observe),updated_at=clock_timestamp() WHERE order_id=oid;
 END IF;
 INSERT INTO public.agent_actions(id,invocation_id,order_id,tool,outcome,evidence) VALUES(p_action,p_inv,oid,p_tool,p_outcome,p_evidence);
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_record(uuid,uuid,text,text,jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_record(uuid,uuid,text,text,jsonb,integer) TO mend_worker;
