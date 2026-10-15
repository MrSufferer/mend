CREATE OR REPLACE FUNCTION public.mend_agent_record(p_inv uuid, p_action uuid, p_tool text, p_outcome text, p_evidence jsonb, p_observe integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE oid uuid;
BEGIN
 oid=public.mend_agent_assert(p_inv);
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 PERFORM public.mend_agent_assert(p_inv);
 IF p_tool NOT IN ('inspect_order','inspect_execution','inspect_output','related_orders','observe_later','restore_result','retry_once','request_pause','request_refund') OR length(p_outcome)>64 OR octet_length(p_evidence::text)>8192 THEN RAISE EXCEPTION 'invalid_agent_action'; END IF;
 IF p_observe IS NOT NULL THEN
  IF p_tool<>'observe_later' OR p_observe<60 OR p_observe>900 THEN RAISE EXCEPTION 'invalid_observation'; END IF;
  UPDATE public.recovery_cases SET observe_at=clock_timestamp()+make_interval(secs=>p_observe),updated_at=clock_timestamp() WHERE order_id=oid;
 END IF;
 INSERT INTO public.agent_actions(id,invocation_id,order_id,tool,outcome,evidence) VALUES(p_action,p_inv,oid,p_tool,p_outcome,p_evidence);
 RETURN true;
END; $function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_agent_dispatch(p_inv uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE oid uuid;
BEGIN
 PERFORM 1 FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 oid=public.mend_agent_assert(p_inv);
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv AND purpose='model' FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'agent_invocation_stale'; END IF;
 RETURN public.mend_agent_assert(p_inv);
END; $function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_fence(p_order uuid, p_payment jsonb DEFAULT NULL::jsonb, p_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE o public.orders; a public.execution_attempts; c public.refund_checks; r public.refunds; t timestamptz; s public.operator_requests;
BEGIN
 PERFORM 1 FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('reason','order_unknown'); END IF;
 SELECT * INTO r FROM public.refunds WHERE order_id=p_order;
 IF FOUND THEN RETURN to_jsonb(r); END IF;
 IF o.disposition<>'unresolved' OR o.delivered_at IS NOT NULL OR o.result IS NOT NULL THEN RETURN jsonb_build_object('reason','delivery_preferred'); END IF;
 PERFORM 1 FROM public.execution_attempts WHERE order_id=p_order ORDER BY generation FOR UPDATE;
 IF NOT EXISTS(SELECT FROM public.execution_attempts WHERE order_id=p_order) OR EXISTS(SELECT FROM public.execution_attempts WHERE order_id=p_order AND (stopped_at IS NULL OR publisher_finished_at IS NULL OR publication_fenced_at IS NULL)) THEN RETURN jsonb_build_object('reason','execution_unknown'); END IF;
 IF EXISTS(SELECT FROM public.execution_attempts WHERE order_id=p_order AND (final_output_check IS DISTINCT FROM 'absent' OR output_publication IS NOT NULL)) THEN RETURN jsonb_build_object('reason','output_unknown'); END IF;
 t=clock_timestamp();
 IF o.paid_at IS NULL OR o.payment_transaction IS NULL OR o.payer_wallet IS NULL OR o.payment_receipt IS NULL THEN RETURN jsonb_build_object('reason','payment_unknown'); END IF;
 IF o.terms->>'deliverySeconds' IS NULL OR o.terms->>'maxRetries' IS NULL OR (o.terms->>'deliverySeconds')::int NOT BETWEEN 1 AND 120 OR (o.terms->>'maxRetries')::int NOT BETWEEN 0 AND 1 THEN RETURN jsonb_build_object('reason','policy_unknown'); END IF;
 IF o.terms->'price'->>'amount' IS DISTINCT FROM '1' OR o.terms->'price'->>'network' IS DISTINCT FROM 'Arc testnet' OR o.terms->'price'->>'currency' IS DISTINCT FROM 'test USDC' OR o.terms->'automaticRefundAllowance'->>'currency' IS DISTINCT FROM 'test USDC' OR o.terms->'automaticRefundAllowance'->>'period' IS DISTINCT FROM 'UTC calendar day' OR COALESCE((o.terms->'automaticRefundAllowance'->>'amount')::numeric,0)<1 THEN RETURN jsonb_build_object('reason','policy_disallows_refund'); END IF;
 IF o.paid_at+(o.terms->>'deliverySeconds')::int*interval '1 second'>t AND (SELECT max(generation) FROM public.execution_attempts WHERE order_id=p_order)<(o.terms->>'maxRetries')::int THEN RETURN jsonb_build_object('reason','recovery_remaining'); END IF;
 IF p_request IS NOT NULL THEN
  SELECT * INTO s FROM public.operator_requests WHERE id=p_request AND order_id=p_order FOR UPDATE;
  IF FOUND THEN PERFORM 1 FROM public.auth_sessions WHERE token_hash=s.session_hash FOR SHARE; END IF;
  t=clock_timestamp();
  IF s.id IS NULL THEN
   PERFORM 1 FROM public.agent_invocations WHERE id=p_request AND order_id=p_order AND purpose='model' FOR UPDATE;
   IF NOT FOUND OR public.mend_agent_assert(p_request) IS DISTINCT FROM p_order THEN RETURN jsonb_build_object('reason','agent_invocation_stale'); END IF;
  ELSIF s.action<>'refund' OR s.finished_at IS NOT NULL OR s.deadline<=t OR NOT EXISTS(SELECT FROM public.auth_sessions WHERE token_hash=s.session_hash AND wallet=s.actor AND revoked_at IS NULL AND expires_at>t) THEN RETURN jsonb_build_object('reason','operator_request_stale'); END IF;
 END IF;
 t=clock_timestamp();
 SELECT * INTO c FROM public.refund_checks WHERE order_id=p_order;
 IF NOT FOUND OR c.outcome<>'absent' OR c.checked_at<t-interval '10 seconds' OR c.checked_at>t OR c.attempt_ids IS DISTINCT FROM (SELECT jsonb_agg(id::text ORDER BY generation) FROM public.execution_attempts WHERE order_id=p_order) THEN RETURN jsonb_build_object('reason','output_check_required'); END IF;
 IF p_payment IS NULL OR p_payment->>'transaction' IS DISTINCT FROM o.payment_transaction OR p_payment->>'payer' IS DISTINCT FROM o.payer_wallet OR p_payment->>'amountAtomic' IS DISTINCT FROM '1000000' OR p_payment->>'chainId' IS DISTINCT FROM '5042002' OR p_payment->>'checkedAt' IS NULL OR (p_payment->>'checkedAt')::timestamptz<t-interval '10 seconds' OR (p_payment->>'checkedAt')::timestamptz>t THEN RETURN jsonb_build_object('reason','canonical_payment_required'); END IF;
 INSERT INTO public.refunds(order_id,chain_order_id,payer,amount_atomic,state,fenced_at) VALUES(p_order,'0x'||replace(p_order::text,'-','')||repeat('0',32),o.payer_wallet,'1000000','registration_pending',t) RETURNING * INTO r;
 UPDATE public.orders SET disposition='refund_fenced',status='refund_pending' WHERE id=p_order;
 RETURN to_jsonb(r);
END; $function$
;
REVOKE ALL ON FUNCTION public.mend_refund_agent_dispatch(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_refund_agent_dispatch(uuid) TO mend_registrar;
