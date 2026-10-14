ALTER TABLE "refund_transactions" ADD COLUMN "request" jsonb NOT NULL;--> statement-breakpoint
INSERT INTO public.refund_signers(kind,address,next_nonce) VALUES('registrar','0xf313a44e910d6b7164cd587be1aeef2123e5cb6c',-1),('refund','0xc6c5084dc5baf8634b2285af448d7bf524826522',-1);
--> statement-breakpoint
REVOKE SELECT ON public.refund_transactions,public.refund_signers FROM mend_registrar,mend_refund_worker;
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_operation(p_order uuid,p_kind text,p_nonce integer DEFAULT NULL,p_request jsonb DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.refunds; s public.refund_signers; tx public.refund_transactions; expected text;
BEGIN
 IF (p_kind='registrar' AND session_user<>'mend_registrar') OR (p_kind='refund' AND session_user<>'mend_refund_worker') OR p_kind IS NULL OR p_kind NOT IN ('registrar','refund') THEN RAISE EXCEPTION 'wrong_signer_role'; END IF;
 SELECT * INTO s FROM public.refund_signers WHERE kind=p_kind FOR UPDATE;
 SELECT * INTO r FROM public.refunds WHERE order_id=p_order FOR UPDATE;
 IF NOT FOUND OR (p_kind='refund' AND r.registered_at IS NULL) THEN RETURN jsonb_build_object('reason','entitlement_required'); END IF;
 SELECT * INTO tx FROM public.refund_transactions WHERE order_id=p_order AND kind=p_kind;
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
REVOKE ALL ON FUNCTION public.mend_refund_operation(uuid,text,integer,jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mend_refund_operation(uuid,text,integer,jsonb) TO mend_registrar,mend_refund_worker;
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_signed(p_id uuid,p_raw text,p_hash text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tx public.refund_transactions;
BEGIN
 SELECT * INTO tx FROM public.refund_transactions WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR (tx.kind='registrar' AND session_user<>'mend_registrar') OR (tx.kind='refund' AND session_user<>'mend_refund_worker') THEN RAISE EXCEPTION 'wrong_signer_role'; END IF;
 IF tx.hash IS NOT NULL THEN IF tx.hash IS DISTINCT FROM p_hash OR tx.raw_transaction IS DISTINCT FROM p_raw THEN RAISE EXCEPTION 'signed_transaction_immutable'; END IF; RETURN to_jsonb(tx); END IF;
 IF p_raw IS NULL OR p_hash IS NULL OR p_raw !~ '^0x[0-9a-f]+$' OR length(p_raw)>8192 OR p_hash !~ '^0x[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_signed_transaction'; END IF;
 UPDATE public.refund_transactions SET raw_transaction=p_raw,hash=p_hash,state='signed' WHERE id=p_id RETURNING * INTO tx;
 RETURN to_jsonb(tx);
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mend_refund_signed(uuid,text,text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mend_refund_signed(uuid,text,text) TO mend_registrar,mend_refund_worker;
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_receipt(p_id uuid,p_state text,p_receipt jsonb DEFAULT NULL) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE tx public.refund_transactions; r public.refunds;
BEGIN
 SELECT * INTO tx FROM public.refund_transactions WHERE id=p_id;
 PERFORM 1 FROM public.orders WHERE id=tx.order_id FOR UPDATE;
 SELECT * INTO r FROM public.refunds WHERE order_id=tx.order_id FOR UPDATE;
 SELECT * INTO tx FROM public.refund_transactions WHERE id=p_id FOR UPDATE;
 IF NOT FOUND OR (tx.kind='registrar' AND session_user<>'mend_registrar') OR (tx.kind='refund' AND session_user NOT IN ('mend_refund_worker','mend_registrar')) OR tx.hash IS NULL THEN RAISE EXCEPTION 'wrong_signer_role'; END IF;
 IF p_state IN ('confirmed','reverted') AND session_user<>'mend_registrar' THEN RAISE EXCEPTION 'independent_receipt_verifier_required'; END IF;
 IF tx.state='confirmed' THEN RETURN; END IF;
 IF p_state IS NULL OR p_state NOT IN ('submitted','unknown','confirmed','reverted') THEN RAISE EXCEPTION 'invalid_receipt_state'; END IF;
 IF p_state='confirmed' AND (p_receipt->>'transaction' IS DISTINCT FROM tx.hash OR p_receipt->>'payer' IS DISTINCT FROM r.payer OR p_receipt->>'amountAtomic' IS DISTINCT FROM r.amount_atomic OR p_receipt->>'chainOrderId' IS DISTINCT FROM r.chain_order_id OR p_receipt->>'chainId' IS DISTINCT FROM '5042002' OR lower(p_receipt->>'contract') IS DISTINCT FROM '0x76b29d6a6eab98b32415b8a6adf5d587d991e082' OR p_receipt->>'status' IS DISTINCT FROM 'success' OR p_receipt->>'blockHash' IS NULL OR p_receipt->>'blockNumber' IS NULL) THEN RAISE EXCEPTION 'matching_successful_receipt_required'; END IF;
 UPDATE public.refund_transactions SET state=p_state,receipt=p_receipt WHERE id=p_id;
 IF tx.kind='registrar' THEN
  UPDATE public.refunds SET registration_hash=tx.hash,state=CASE WHEN p_state='confirmed' THEN 'registered' ELSE state END,registered_at=CASE WHEN p_state='confirmed' THEN clock_timestamp() ELSE registered_at END,updated_at=clock_timestamp() WHERE order_id=r.order_id;
 ELSE
  UPDATE public.refunds SET refund_hash=tx.hash,state=CASE WHEN p_state='confirmed' THEN 'refunded' WHEN p_state='submitted' THEN 'submitted' ELSE 'receipt_unknown' END,refunded_at=CASE WHEN p_state='confirmed' THEN clock_timestamp() ELSE NULL END,receipt=p_receipt,updated_at=clock_timestamp() WHERE order_id=r.order_id;
 END IF;
 IF p_state='confirmed' THEN UPDATE public.orders SET disposition=CASE WHEN tx.kind='registrar' THEN 'refund_registered' ELSE 'refunded' END,status=CASE WHEN tx.kind='registrar' THEN 'refund_pending' ELSE 'refunded' END WHERE id=r.order_id; END IF;
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mend_refund_receipt(uuid,text,jsonb) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mend_refund_receipt(uuid,text,jsonb) TO mend_registrar,mend_refund_worker;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_guard_delivery() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.disposition='delivery' AND NEW.disposition<>'delivery' THEN RAISE EXCEPTION 'delivery_disposition_immutable'; END IF;
 IF OLD.delivered_at IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'delivery_status_immutable'; END IF;
 IF OLD.paid_at IS NOT NULL AND (NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.terms IS DISTINCT FROM OLD.terms) THEN RAISE EXCEPTION 'purchased_policy_immutable'; END IF;
 IF OLD.disposition NOT IN ('unresolved','delivery') AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.disposition IS DISTINCT FROM OLD.disposition) AND NOT (OLD.disposition='refund_fenced' AND NEW.disposition='refund_registered' AND NEW.status='refund_pending' AND EXISTS(SELECT FROM public.refunds WHERE order_id=OLD.id AND registered_at IS NOT NULL)) AND NOT (OLD.disposition='refund_registered' AND NEW.disposition='refunded' AND NEW.status='refunded' AND EXISTS(SELECT FROM public.refunds WHERE order_id=OLD.id AND refunded_at IS NOT NULL)) THEN RAISE EXCEPTION 'refund_disposition_fenced'; END IF;
 IF NEW.result IS DISTINCT FROM OLD.result OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
  IF OLD.disposition NOT IN ('unresolved','delivery') THEN RAISE EXCEPTION 'refund_disposition_fenced'; END IF;
  IF OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN RAISE EXCEPTION 'delivery_immutable'; END IF;
  IF NEW.delivered_at IS NOT NULL THEN NEW.disposition='delivery'; END IF;
 END IF;
 IF OLD.disposition NOT IN ('unresolved','delivery') AND NEW.disposition='delivery' THEN RAISE EXCEPTION 'refund_disposition_fenced'; END IF;
 RETURN NEW;
END; $$;
