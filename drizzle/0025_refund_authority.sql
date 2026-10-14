CREATE TABLE "refund_checks" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"checked_at" timestamp with time zone NOT NULL,
	"attempt_ids" jsonb NOT NULL,
	"outcome" text NOT NULL,
	CONSTRAINT "refund_check_outcome" CHECK ("refund_checks"."outcome" IN ('absent','delivery','unknown'))
);
--> statement-breakpoint
CREATE TABLE "refund_signers" (
	"kind" text PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"next_nonce" integer NOT NULL,
	CONSTRAINT "refund_signers_address_unique" UNIQUE("address"),
	CONSTRAINT "refund_signer_kind" CHECK ("refund_signers"."kind" IN ('registrar','refund'))
);
--> statement-breakpoint
CREATE TABLE "refund_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"nonce" integer NOT NULL,
	"calldata" text NOT NULL,
	"raw_transaction" text,
	"hash" text,
	"state" text DEFAULT 'reserved' NOT NULL,
	"receipt" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refund_transactions_hash_unique" UNIQUE("hash"),
	CONSTRAINT "refund_transaction_state" CHECK ("refund_transactions"."state" IN ('reserved','signed','submitted','unknown','confirmed','reverted'))
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"chain_order_id" text NOT NULL,
	"payer" text NOT NULL,
	"amount_atomic" text NOT NULL,
	"state" text NOT NULL,
	"fenced_at" timestamp with time zone NOT NULL,
	"registered_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"registration_hash" text,
	"refund_hash" text,
	"receipt" jsonb,
	"blocker" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refunds_chain_order_id_unique" UNIQUE("chain_order_id"),
	CONSTRAINT "refund_amount" CHECK ("refunds"."amount_atomic"='1000000'),
	CONSTRAINT "refund_state" CHECK ("refunds"."state" IN ('registration_pending','registered','submitted','receipt_unknown','refunded'))
);
--> statement-breakpoint
ALTER TABLE "refund_checks" ADD CONSTRAINT "refund_checks_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_order_id_refunds_order_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."refunds"("order_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refund_transactions" ADD CONSTRAINT "refund_transactions_kind_refund_signers_kind_fk" FOREIGN KEY ("kind") REFERENCES "public"."refund_signers"("kind") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "refund_operation" ON "refund_transactions" USING btree ("order_id","kind");--> statement-breakpoint
CREATE UNIQUE INDEX "refund_signer_nonce" ON "refund_transactions" USING btree ("kind","nonce");--> statement-breakpoint
DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='mend_refund_worker') THEN CREATE ROLE mend_refund_worker LOGIN; END IF; END $$;
--> statement-breakpoint
REVOKE ALL ON public.refund_checks,public.refunds,public.refund_signers,public.refund_transactions FROM PUBLIC,mend_web,mend_worker,mend_conversion,mend_registrar,mend_refund_worker;
--> statement-breakpoint
GRANT USAGE ON SCHEMA public TO mend_refund_worker;
--> statement-breakpoint
GRANT SELECT ON public.refunds TO mend_web,mend_worker,mend_conversion,mend_registrar,mend_refund_worker;
--> statement-breakpoint
GRANT SELECT ON public.refund_checks TO mend_registrar,mend_conversion;
--> statement-breakpoint
GRANT SELECT ON public.refund_signers,public.refund_transactions TO mend_registrar,mend_refund_worker;
--> statement-breakpoint
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_fence(p_order uuid,p_payment jsonb DEFAULT NULL,p_request uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
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
 IF o.terms->'price'->>'amount'<>'1' OR o.terms->'price'->>'network'<>'Arc testnet' OR o.terms->'price'->>'currency'<>'test USDC' OR (o.terms->'automaticRefundAllowance'->>'amount')::numeric<1 THEN RETURN jsonb_build_object('reason','policy_disallows_refund'); END IF;
 IF o.paid_at+(o.terms->>'deliverySeconds')::int*interval '1 second'>t AND (SELECT max(generation) FROM public.execution_attempts WHERE order_id=p_order)<(o.terms->>'maxRetries')::int THEN RETURN jsonb_build_object('reason','recovery_remaining'); END IF;
 SELECT * INTO c FROM public.refund_checks WHERE order_id=p_order;
 IF NOT FOUND OR c.outcome<>'absent' OR c.checked_at<t-interval '10 seconds' OR c.checked_at>t OR c.attempt_ids IS DISTINCT FROM (SELECT jsonb_agg(id::text ORDER BY generation) FROM public.execution_attempts WHERE order_id=p_order) THEN RETURN jsonb_build_object('reason','output_check_required'); END IF;
 IF p_payment IS NULL OR p_payment->>'transaction' IS DISTINCT FROM o.payment_transaction OR p_payment->>'payer' IS DISTINCT FROM o.payer_wallet OR p_payment->>'amountAtomic'<>'1000000' OR p_payment->>'chainId'<>'5042002' OR (p_payment->>'checkedAt')::timestamptz<t-interval '10 seconds' OR (p_payment->>'checkedAt')::timestamptz>t THEN RETURN jsonb_build_object('reason','canonical_payment_required'); END IF;
 IF p_request IS NOT NULL THEN
  SELECT * INTO s FROM public.operator_requests WHERE id=p_request AND order_id=p_order FOR UPDATE;
  IF NOT FOUND OR s.action<>'refund' OR s.finished_at IS NOT NULL OR s.deadline<=t OR NOT EXISTS(SELECT FROM public.auth_sessions WHERE token_hash=s.session_hash AND wallet=s.actor AND revoked_at IS NULL AND expires_at>t) THEN RETURN jsonb_build_object('reason','operator_request_stale'); END IF;
 END IF;
 INSERT INTO public.refunds(order_id,chain_order_id,payer,amount_atomic,state,fenced_at) VALUES(p_order,'0x'||replace(p_order::text,'-','')||repeat('0',32),o.payer_wallet,'1000000','registration_pending',t) RETURNING * INTO r;
 UPDATE public.orders SET disposition='refund_fenced',status='refund_pending' WHERE id=p_order;
 RETURN to_jsonb(r);
END; $$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION public.mend_refund_fence(uuid,jsonb,uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.mend_refund_fence(uuid,jsonb,uuid) TO mend_registrar;
--> statement-breakpoint
