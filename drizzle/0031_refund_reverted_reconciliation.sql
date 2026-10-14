DROP INDEX "refund_operation";--> statement-breakpoint
CREATE UNIQUE INDEX "refund_operation" ON "refund_transactions" USING btree ("order_id","kind") WHERE "refund_transactions"."state" <> 'reverted';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_operation(p_order uuid,p_kind text,p_nonce integer DEFAULT NULL,p_request jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.refunds; s public.refund_signers; tx public.refund_transactions; expected text;
BEGIN
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
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_receipt(p_id uuid,p_state text,p_receipt jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tx public.refund_transactions; r public.refunds;
BEGIN
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
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_verify_operation(p_order uuid,p_kind text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT jsonb_build_object('id',id,'hash',hash,'state',state) FROM public.refund_transactions WHERE order_id=p_order AND kind=p_kind AND state<>'reverted'; $$;
