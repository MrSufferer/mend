ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_generation_bound" CHECK ("execution_attempts"."generation" IN (0,1));--> statement-breakpoint
-- Conversion admission owns the immutable purchased deadline and every generation.
REVOKE INSERT ON public.execution_attempts FROM mend_conversion;
CREATE FUNCTION public.mend_claim_execution(p_order uuid,p_attempt uuid,p_invocation text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.orders; a public.execution_attempts; d timestamptz;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.paid_at IS NULL OR o.payment_receipt IS NULL OR o.owner_wallet IS NULL THEN RETURN jsonb_build_object('reason','payment_required'); END IF;
 SELECT * INTO a FROM public.execution_attempts WHERE order_id=p_order ORDER BY generation DESC LIMIT 1 FOR UPDATE;
 IF FOUND THEN RETURN jsonb_build_object('reason','existing_execution','attemptId',a.id,'state',a.state); END IF;
 d=o.paid_at+(o.terms->>'deliverySeconds')::int*interval '1 second';
 IF o.disposition<>'unresolved' THEN RETURN jsonb_build_object('reason','disposition_fenced'); END IF;
 IF d<=clock_timestamp() OR o.upload_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('reason','deadline_elapsed'); END IF;
 INSERT INTO public.execution_attempts(id,order_id,generation,state,deadline,invocation_id) VALUES(p_attempt,p_order,0,'running',d,p_invocation);
 RETURN jsonb_build_object('attemptId',p_attempt);
END; $$;
REVOKE ALL ON FUNCTION public.mend_claim_execution(uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_claim_execution(uuid,uuid,text) TO mend_conversion;
--> statement-breakpoint
-- Only the conversion role may attest a fresh actual storage inspection. The worker
-- supplies neither an order identity nor stopping/absence/policy authority.
CREATE FUNCTION public.mend_agent_retry_claim(p_inv uuid,p_parent uuid,p_attempt uuid,p_execution_invocation text,p_absent_at timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE oid uuid; o public.orders; a public.execution_attempts; d timestamptz; t timestamptz;
BEGIN
 oid=public.mend_agent_assert(p_inv);
 SELECT * INTO o FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 PERFORM 1 FROM public.execution_attempts WHERE order_id=oid ORDER BY generation FOR UPDATE;
 PERFORM public.mend_agent_assert(p_inv);
 t=clock_timestamp();
 IF o.disposition<>'unresolved' OR o.delivered_at IS NOT NULL OR o.result IS NOT NULL THEN RETURN jsonb_build_object('reason','disposition_fenced'); END IF;
 IF o.paid_at IS NULL OR o.payment_receipt IS NULL OR o.owner_wallet IS NULL THEN RETURN jsonb_build_object('reason','payment_required'); END IF;
 d=o.paid_at+(o.terms->>'deliverySeconds')::int*interval '1 second';
 IF d<=t OR o.upload_expires_at<=t THEN RETURN jsonb_build_object('reason','deadline_elapsed'); END IF;
 IF (o.terms->>'maxRetries')::int IS DISTINCT FROM 1 THEN RETURN jsonb_build_object('reason','policy_disallows_retry'); END IF;
 IF EXISTS(SELECT FROM public.execution_attempts WHERE order_id=oid AND generation=1) THEN RETURN jsonb_build_object('reason','retry_exists'); END IF;
 IF (SELECT count(*) FROM public.execution_attempts WHERE order_id=oid)<>1 THEN RETURN jsonb_build_object('reason','execution_unknown'); END IF;
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_parent AND order_id=oid AND generation=0;
 IF NOT FOUND OR a.stopped_at IS NULL OR a.publisher_finished_at IS NULL OR a.publication_fenced_at IS NULL THEN RETURN jsonb_build_object('reason','execution_unknown'); END IF;
 IF a.final_output_check IS DISTINCT FROM 'absent' OR a.output_publication IS NOT NULL THEN RETURN jsonb_build_object('reason','output_unknown'); END IF;
 IF p_absent_at IS NULL OR p_absent_at>t OR p_absent_at<t-interval '10 seconds' THEN RETURN jsonb_build_object('reason','inspection_stale'); END IF;
 INSERT INTO public.execution_attempts(id,order_id,generation,state,deadline,invocation_id) VALUES(p_attempt,oid,1,'running',d,p_execution_invocation);
 RETURN jsonb_build_object('attemptId',p_attempt,'generation',1,'deadline',d);
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_retry_claim(uuid,uuid,uuid,text,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_retry_claim(uuid,uuid,uuid,text,timestamptz) TO mend_conversion;
