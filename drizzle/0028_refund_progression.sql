ALTER TABLE "operator_requests" DROP CONSTRAINT "operator_action";--> statement-breakpoint
ALTER TABLE "operator_requests" ADD CONSTRAINT "operator_action" CHECK ("operator_requests"."action" IN ('investigate','check','restore','retry','refund'));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_operator_begin(p_id uuid,p_order uuid,p_session text,p_action text,p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.orders; i uuid; reason text; t timestamptz; evidence jsonb;
BEGIN
 IF p_action IS NULL OR p_action NOT IN ('investigate','check','restore','retry','refund') THEN RAISE EXCEPTION 'invalid_action'; END IF;
 IF NOT EXISTS(SELECT FROM public.auth_sessions WHERE token_hash=p_session AND wallet=p_actor AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'session_expired'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found'; END IF;
 t=clock_timestamp();
 evidence=jsonb_build_object('paymentConfirmed',o.paid_at IS NOT NULL AND o.payment_receipt IS NOT NULL,'disposition',o.disposition,'deadline',o.paid_at+(o.terms->>'deliverySeconds')::int*interval '1 second','callsUsed',COALESCE((SELECT calls_used FROM public.recovery_cases WHERE order_id=p_order),0));
 IF o.paid_at IS NULL OR o.payment_receipt IS NULL OR o.disposition<>'unresolved' THEN reason='no_unresolved_paid_obligation'; END IF;
 UPDATE public.agent_invocations SET finished_at=t,outcome='abandoned' WHERE order_id=p_order AND finished_at IS NULL AND deadline<=t;
 IF reason IS NULL AND EXISTS(SELECT FROM public.agent_invocations WHERE order_id=p_order AND finished_at IS NULL) THEN reason='investigation_running'; END IF;
 IF reason IS NULL AND p_action='investigate' AND COALESCE((SELECT calls_used FROM public.recovery_cases WHERE order_id=p_order),0)>=12 THEN reason='budget_exhausted'; END IF;
 IF reason IS NULL AND p_action<>'investigate' THEN
  i=gen_random_uuid();
  INSERT INTO public.agent_invocations(id,order_id,deadline,purpose) VALUES(i,p_order,t+interval '60 seconds','operator');
 END IF;
 INSERT INTO public.operator_requests(id,order_id,actor,session_hash,action,invocation_id,deadline,finished_at,outcome,request_evidence,outcome_evidence)
 VALUES(p_id,p_order,p_actor,p_session,p_action,i,t+interval '60 seconds',CASE WHEN reason IS NOT NULL THEN t END,CASE WHEN reason IS NULL THEN 'requested' ELSE 'skipped' END,evidence,CASE WHEN reason IS NOT NULL THEN jsonb_build_object('reason',reason) END);
 RETURN jsonb_build_object('id',p_id,'invocationId',i,'reason',reason);
END; $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_fence(p_order uuid,p_payment jsonb DEFAULT NULL,p_request uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.orders; a public.execution_attempts; c public.refund_checks; r public.refunds; t timestamptz; s public.operator_requests;
BEGIN
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
 SELECT * INTO c FROM public.refund_checks WHERE order_id=p_order;
 IF NOT FOUND OR c.outcome<>'absent' OR c.checked_at<t-interval '10 seconds' OR c.checked_at>t OR c.attempt_ids IS DISTINCT FROM (SELECT jsonb_agg(id::text ORDER BY generation) FROM public.execution_attempts WHERE order_id=p_order) THEN RETURN jsonb_build_object('reason','output_check_required'); END IF;
 IF p_payment IS NULL OR p_payment->>'transaction' IS DISTINCT FROM o.payment_transaction OR p_payment->>'payer' IS DISTINCT FROM o.payer_wallet OR p_payment->>'amountAtomic' IS DISTINCT FROM '1000000' OR p_payment->>'chainId' IS DISTINCT FROM '5042002' OR p_payment->>'checkedAt' IS NULL OR (p_payment->>'checkedAt')::timestamptz<t-interval '10 seconds' OR (p_payment->>'checkedAt')::timestamptz>t THEN RETURN jsonb_build_object('reason','canonical_payment_required'); END IF;
 IF p_request IS NOT NULL THEN
  SELECT * INTO s FROM public.operator_requests WHERE id=p_request AND order_id=p_order FOR UPDATE;
  IF FOUND THEN PERFORM 1 FROM public.auth_sessions WHERE token_hash=s.session_hash FOR SHARE; END IF;
  IF s.id IS NULL OR s.action<>'refund' OR s.finished_at IS NOT NULL OR s.deadline<=t OR NOT EXISTS(SELECT FROM public.auth_sessions WHERE token_hash=s.session_hash AND wallet=s.actor AND revoked_at IS NULL AND expires_at>t) THEN RETURN jsonb_build_object('reason','operator_request_stale'); END IF;
 END IF;
 INSERT INTO public.refunds(order_id,chain_order_id,payer,amount_atomic,state,fenced_at) VALUES(p_order,'0x'||replace(p_order::text,'-','')||repeat('0',32),o.payer_wallet,'1000000','registration_pending',t) RETURNING * INTO r;
 UPDATE public.orders SET disposition='refund_fenced',status='refund_pending' WHERE id=p_order;
 RETURN to_jsonb(r);
END; $$;

--> statement-breakpoint
GRANT SELECT ON public.payment_attempts TO mend_registrar;
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_verify_operation(p_order uuid,p_kind text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT jsonb_build_object('id',id,'hash',hash,'state',state) FROM public.refund_transactions WHERE order_id=p_order AND kind=p_kind; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mend_refund_verify_operation(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mend_refund_verify_operation(uuid,text) TO mend_registrar;
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_queue() RETURNS TABLE(order_id uuid) LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT o.id FROM public.orders o LEFT JOIN public.refunds r ON r.order_id=o.id LEFT JOIN public.refund_checks c ON c.order_id=o.id
 WHERE o.paid_at IS NOT NULL AND o.delivered_at IS NULL AND o.disposition IN ('unresolved','refund_fenced','refund_registered')
 AND (r.order_id IS NOT NULL OR (EXISTS(SELECT FROM public.execution_attempts WHERE order_id=o.id) AND NOT EXISTS(SELECT FROM public.execution_attempts WHERE order_id=o.id AND (stopped_at IS NULL OR publisher_finished_at IS NULL OR publication_fenced_at IS NULL)) AND o.paid_at+(o.terms->>'deliverySeconds')::int*interval '1 second'<=clock_timestamp() AND (c.checked_at IS NULL OR c.checked_at<clock_timestamp()-interval '15 minutes')))
 ORDER BY CASE WHEN r.order_id IS NOT NULL THEN 0 ELSE 1 END,COALESCE(r.updated_at,c.checked_at,o.paid_at),o.id;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mend_refund_queue() FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mend_refund_queue() TO mend_refund_worker;
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_blocker(p_order uuid,p_reason text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$ BEGIN
 IF p_reason IS NOT NULL AND p_reason NOT IN ('reserve_unfunded','allowance_exhausted') THEN RAISE EXCEPTION 'invalid_blocker'; END IF;
 UPDATE public.refunds SET blocker=p_reason,updated_at=clock_timestamp() WHERE order_id=p_order AND refunded_at IS NULL;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mend_refund_blocker(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mend_refund_blocker(uuid,text) TO mend_refund_worker;
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_operator_dispatch(p_request uuid,p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.operator_requests;
BEGIN
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request;
 IF NOT FOUND OR r.actor IS DISTINCT FROM p_actor OR r.action IS DISTINCT FROM 'refund' THEN RAISE EXCEPTION 'invalid_request'; END IF;
 PERFORM 1 FROM public.orders WHERE id=r.order_id FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=r.invocation_id FOR UPDATE;
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request FOR UPDATE;
 IF r.dispatched_at IS NOT NULL THEN RETURN jsonb_build_object('reason','request_already_dispatched'); END IF;
 PERFORM public.mend_operator_assert(p_request,'refund',p_actor);
 UPDATE public.operator_requests SET dispatched_at=clock_timestamp() WHERE id=p_request;
 RETURN jsonb_build_object('orderId',r.order_id);
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mend_refund_operator_dispatch(uuid,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mend_refund_operator_dispatch(uuid,text) TO mend_registrar;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mend_operator_finish(uuid,text,jsonb) TO mend_registrar;
