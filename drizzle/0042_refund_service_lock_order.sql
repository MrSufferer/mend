CREATE OR REPLACE FUNCTION public.mend_operator_begin(p_id uuid, p_order uuid, p_session text, p_action text, p_actor text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE o public.orders; i uuid; reason text; t timestamptz; evidence jsonb;
BEGIN
 PERFORM 1 FROM public.service_availability WHERE id='merchant' FOR UPDATE;
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
END; $function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_blocker(p_order uuid, p_reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ BEGIN
 PERFORM 1 FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 IF p_reason IS NOT NULL AND p_reason NOT IN ('reserve_unfunded','allowance_exhausted') THEN RAISE EXCEPTION 'invalid_blocker'; END IF;
 UPDATE public.refunds SET blocker=p_reason,updated_at=clock_timestamp() WHERE order_id=p_order AND refunded_at IS NULL;
END; $function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_operation(p_order uuid, p_kind text, p_nonce integer DEFAULT NULL::integer, p_request jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r public.refunds; s public.refund_signers; tx public.refund_transactions; expected text;
BEGIN
 PERFORM 1 FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 IF (p_kind='registrar' AND session_user<>'mend_registrar') OR (p_kind='refund' AND session_user<>'mend_refund_worker') OR p_kind IS NULL OR p_kind NOT IN ('registrar','refund') THEN RAISE EXCEPTION 'wrong_signer_role'; END IF;
 SELECT * INTO s FROM public.refund_signers WHERE kind=p_kind FOR UPDATE;
 SELECT * INTO r FROM public.refunds WHERE order_id=p_order FOR UPDATE;
 IF NOT FOUND OR (p_kind='refund' AND r.registered_at IS NULL) THEN RETURN jsonb_build_object('reason','entitlement_required'); END IF;
 SELECT * INTO tx FROM public.refund_transactions WHERE order_id=p_order AND kind=p_kind AND state<>'reverted';
 IF FOUND THEN RETURN to_jsonb(tx); END IF;
 IF EXISTS(SELECT FROM public.refund_transactions WHERE kind=p_kind AND state NOT IN ('confirmed','reverted')) THEN RETURN jsonb_build_object('reason','signer_receipt_pending'); END IF;
 IF p_nonce IS NULL OR p_request IS NULL THEN RETURN jsonb_build_object('reason','not_reserved'); END IF;
 expected=CASE WHEN p_kind='registrar' THEN '0x24bf0f53' ELSE '0x4020ed14' END||substr(r.chain_order_id,3)||lpad(substr(r.payer,3),64,'0')||lpad(to_hex(r.amount_atomic::bigint),64,'0');
 IF p_request->>'data' IS DISTINCT FROM expected OR lower(p_request->>'to') IS DISTINCT FROM '0x76b29d6a6eab98b32415b8a6adf5d587d991e082' OR p_request->>'chainId' IS DISTINCT FROM '5042002' OR p_request->>'value' IS DISTINCT FROM '0' THEN RAISE EXCEPTION 'invalid_transaction_authority'; END IF;
 IF s.next_nonce>=0 AND s.next_nonce<>p_nonce THEN RETURN jsonb_build_object('reason','signer_nonce_unknown'); END IF;
 INSERT INTO public.refund_transactions(id,order_id,kind,nonce,calldata,request) VALUES(gen_random_uuid(),p_order,p_kind,p_nonce,expected,p_request) RETURNING * INTO tx;
 UPDATE public.refund_signers SET next_nonce=p_nonce+1 WHERE kind=p_kind;
 RETURN to_jsonb(tx);
END; $function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_receipt(p_id uuid, p_state text, p_receipt jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE tx public.refund_transactions; r public.refunds;
BEGIN
 PERFORM 1 FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 SELECT * INTO tx FROM public.refund_transactions WHERE id=p_id;
 PERFORM 1 FROM public.orders WHERE id=tx.order_id FOR UPDATE;
 SELECT * INTO r FROM public.refunds WHERE order_id=tx.order_id FOR UPDATE;
 SELECT * INTO tx FROM public.refund_transactions WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR (tx.kind='registrar' AND session_user<>'mend_registrar') OR (tx.kind='refund' AND session_user NOT IN ('mend_refund_worker','mend_registrar')) OR tx.hash IS NULL THEN RAISE EXCEPTION 'wrong_signer_role'; END IF;
 IF p_state IN ('confirmed','reverted') AND session_user<>'mend_registrar' THEN RAISE EXCEPTION 'independent_receipt_verifier_required'; END IF;
 IF tx.state IN ('confirmed','reverted') THEN RETURN; END IF;
 IF p_state IS NULL OR p_state NOT IN ('submitted','unknown','confirmed','reverted') THEN RAISE EXCEPTION 'invalid_receipt_state'; END IF;
 IF p_state='reverted' AND (p_receipt->>'transaction' IS DISTINCT FROM tx.hash OR p_receipt->>'payer' IS DISTINCT FROM r.payer OR p_receipt->>'amountAtomic' IS DISTINCT FROM r.amount_atomic OR p_receipt->>'chainOrderId' IS DISTINCT FROM r.chain_order_id OR p_receipt->>'chainId' IS DISTINCT FROM '5042002' OR lower(p_receipt->>'contract') IS DISTINCT FROM '0x76b29d6a6eab98b32415b8a6adf5d587d991e082' OR p_receipt->>'sender' IS DISTINCT FROM (SELECT address FROM public.refund_signers WHERE kind=tx.kind) OR p_receipt->>'status' IS DISTINCT FROM 'reverted' OR COALESCE(p_receipt->>'blockHash','') !~ '^0x[0-9a-fA-F]{64}$' OR COALESCE(p_receipt->>'blockNumber','') !~ '^[0-9]+$') THEN RAISE EXCEPTION 'matching_canonical_revert_required'; END IF;
 IF p_state='confirmed' AND (p_receipt->>'transaction' IS DISTINCT FROM tx.hash OR p_receipt->>'payer' IS DISTINCT FROM r.payer OR p_receipt->>'amountAtomic' IS DISTINCT FROM r.amount_atomic OR p_receipt->>'chainOrderId' IS DISTINCT FROM r.chain_order_id OR p_receipt->>'chainId' IS DISTINCT FROM '5042002' OR lower(p_receipt->>'contract') IS DISTINCT FROM '0x76b29d6a6eab98b32415b8a6adf5d587d991e082' OR p_receipt->>'status' IS DISTINCT FROM 'success' OR p_receipt->>'blockHash' IS NULL OR p_receipt->>'blockNumber' IS NULL) THEN RAISE EXCEPTION 'matching_successful_receipt_required'; END IF;
 UPDATE public.refund_transactions SET state=p_state,receipt=p_receipt WHERE id=p_id;
 IF tx.kind='registrar' THEN
  UPDATE public.refunds SET registration_hash=tx.hash,state=CASE WHEN p_state='confirmed' THEN 'registered' ELSE state END,registered_at=CASE WHEN p_state='confirmed' THEN clock_timestamp() ELSE registered_at END,updated_at=clock_timestamp() WHERE order_id=r.order_id;
 ELSE
  UPDATE public.refunds SET refund_hash=tx.hash,state=CASE WHEN p_state='confirmed' THEN 'refunded' WHEN p_state='submitted' THEN 'submitted' WHEN p_state='reverted' THEN 'registered' ELSE 'receipt_unknown' END,refunded_at=CASE WHEN p_state='confirmed' THEN clock_timestamp() ELSE NULL END,receipt=p_receipt,updated_at=clock_timestamp() WHERE order_id=r.order_id;
 END IF;
 IF p_state='confirmed' THEN UPDATE public.orders SET disposition=CASE WHEN tx.kind='registrar' THEN 'refund_registered' ELSE 'refunded' END,status=CASE WHEN tx.kind='registrar' THEN 'refund_pending' ELSE 'refunded' END WHERE id=r.order_id; END IF;
END; $function$
;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_signed(p_id uuid, p_raw text, p_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE tx public.refund_transactions;
BEGIN
 PERFORM 1 FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 SELECT * INTO tx FROM public.refund_transactions WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR (tx.kind='registrar' AND session_user<>'mend_registrar') OR (tx.kind='refund' AND session_user<>'mend_refund_worker') THEN RAISE EXCEPTION 'wrong_signer_role'; END IF;
 IF tx.hash IS NOT NULL THEN IF tx.hash IS DISTINCT FROM p_hash OR tx.raw_transaction IS DISTINCT FROM p_raw THEN RAISE EXCEPTION 'signed_transaction_immutable'; END IF; RETURN to_jsonb(tx); END IF;
 IF p_raw IS NULL OR p_hash IS NULL OR p_raw !~ '^0x[0-9a-f]+$' OR length(p_raw)>8192 OR p_hash !~ '^0x[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_signed_transaction'; END IF;
 UPDATE public.refund_transactions SET raw_transaction=p_raw,hash=p_hash,state='signed' WHERE id=p_id RETURNING * INTO tx;
 RETURN to_jsonb(tx);
END; $function$
;