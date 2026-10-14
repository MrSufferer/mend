CREATE TABLE "processing_failures" (
	"attempt_id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"generation" integer NOT NULL,
	"diagnostic" text NOT NULL,
	"confirmed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_availability" (
	"id" text PRIMARY KEY DEFAULT 'merchant' NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"generation" integer DEFAULT 0 NOT NULL,
	"failure_generation" integer DEFAULT 0 NOT NULL,
	"paused_at" timestamp with time zone,
	CONSTRAINT "single_merchant" CHECK ("service_availability"."id"='merchant')
);
--> statement-breakpoint
CREATE TABLE "service_incidents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_kind" text NOT NULL,
	"actor" text NOT NULL,
	"reason" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"generation" integer NOT NULL,
	"failure_generation" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "admitted_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD COLUMN "admission_generation" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "processing_failures" ADD CONSTRAINT "processing_failures_attempt_id_execution_attempts_id_fk" FOREIGN KEY ("attempt_id") REFERENCES "public"."execution_attempts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "processing_failures" ADD CONSTRAINT "processing_failures_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "processing_failure_window" ON "processing_failures" USING btree ("confirmed_at");--> statement-breakpoint
INSERT INTO public.service_availability(id) VALUES('merchant');
REVOKE ALL ON public.service_availability,public.processing_failures,public.service_incidents FROM PUBLIC,mend_web,mend_worker,mend_conversion,mend_registrar,mend_refund_worker,mend_payment_reconciler;
GRANT SELECT ON public.service_availability,public.service_incidents TO mend_web;
GRANT SELECT ON public.processing_failures TO mend_worker;
-- Already persisted authorizations are admitted obligations. Freeze their admission metadata.
REVOKE INSERT,UPDATE ON public.payment_attempts FROM mend_web;
GRANT UPDATE(submitted_at,transaction,scan_block,reconciled_at) ON public.payment_attempts TO mend_web;
CREATE FUNCTION public.mend_admit_payment(p_order uuid,p_payer text,p_nonce text,p_payload jsonb,p_requirements jsonb,p_block text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.service_availability; o public.orders; a public.payment_attempts;
BEGIN
 SELECT * INTO s FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('error','order_not_found'); END IF;
 SELECT * INTO a FROM public.payment_attempts WHERE order_id=p_order;
 IF FOUND THEN
  IF a.payer<>p_payer OR a.nonce<>p_nonce THEN RETURN jsonb_build_object('error','payment_conflict'); END IF;
  RETURN jsonb_build_object('admitted',true,'existing',true,'generation',a.admission_generation);
 END IF;
 IF s.paused THEN RETURN jsonb_build_object('error','purchases_paused'); END IF;
 IF o.paid_at IS NOT NULL OR o.upload_expires_at<=clock_timestamp() THEN RETURN jsonb_build_object('error','upload_expired'); END IF;
 IF o.owner_wallet IS NOT NULL AND o.owner_wallet<>p_payer THEN RETURN jsonb_build_object('error','payer_mismatch'); END IF;
 IF p_payer !~ '^0x[0-9a-f]{40}$' OR p_nonce !~ '^0x[0-9a-f]{64}$' OR p_block !~ '^[0-9]+$' OR p_payload IS NULL OR p_requirements IS NULL THEN RAISE EXCEPTION 'invalid_authorization'; END IF;
 IF EXISTS(SELECT FROM public.payment_attempts WHERE payer=p_payer AND nonce=p_nonce) THEN RETURN jsonb_build_object('error','payment_reused'); END IF;
 INSERT INTO public.payment_attempts(order_id,payer,nonce,payload,requirements,start_block,scan_block,admission_generation,admitted_at) VALUES(p_order,p_payer,p_nonce,p_payload,p_requirements,p_block,p_block,s.generation,clock_timestamp());
 RETURN jsonb_build_object('admitted',true,'generation',s.generation);
END; $$;
REVOKE ALL ON FUNCTION public.mend_admit_payment(uuid,text,text,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_admit_payment(uuid,text,text,jsonb,jsonb,text) TO mend_web;
