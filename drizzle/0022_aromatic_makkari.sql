CREATE TABLE "operator_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"actor" text NOT NULL,
	"session_hash" text NOT NULL,
	"action" text NOT NULL,
	"invocation_id" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text DEFAULT 'requested' NOT NULL,
	"request_evidence" jsonb NOT NULL,
	"outcome_evidence" jsonb
);
--> statement-breakpoint
ALTER TABLE "agent_invocations" ADD COLUMN "purpose" text DEFAULT 'model' NOT NULL;--> statement-breakpoint
ALTER TABLE "operator_requests" ADD CONSTRAINT "operator_requests_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "operator_requests" ADD CONSTRAINT "operator_requests_invocation_id_agent_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."agent_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE public.operator_requests ADD COLUMN dispatched_at timestamptz;
ALTER TABLE public.agent_invocations ADD CONSTRAINT invocation_purpose CHECK(purpose IN ('model','operator'));
ALTER TABLE public.operator_requests ADD CONSTRAINT operator_action CHECK(action IN ('investigate','check','restore','retry'));
CREATE INDEX operator_request_history ON public.operator_requests(order_id,requested_at DESC);
REVOKE ALL ON public.operator_requests FROM PUBLIC,mend_web,mend_worker,mend_conversion,mend_registrar;
-- Session binding is private; only the web projection reads requests.
GRANT SELECT ON public.operator_requests TO mend_web;
CREATE FUNCTION public.mend_operator_begin(p_id uuid,p_order uuid,p_session text,p_action text,p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.orders; i uuid; reason text; t timestamptz; evidence jsonb;
BEGIN
 IF p_action NOT IN ('investigate','check','restore','retry') THEN RAISE EXCEPTION 'invalid_action'; END IF;
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
REVOKE ALL ON FUNCTION public.mend_operator_begin(uuid,uuid,text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_operator_begin(uuid,uuid,text,text,text) TO mend_web;
--> statement-breakpoint
CREATE FUNCTION public.mend_operator_assert(p_request uuid,p_action text,p_actor text) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.operator_requests;
BEGIN
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request;
 IF NOT FOUND OR r.action<>p_action OR r.actor<>p_actor OR r.finished_at IS NOT NULL OR r.deadline<=clock_timestamp() OR r.invocation_id IS NULL THEN RAISE EXCEPTION 'operator_request_stale'; END IF;
 IF NOT EXISTS(SELECT FROM public.auth_sessions WHERE token_hash=r.session_hash AND wallet=r.actor AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'operator_session_expired'; END IF;
 PERFORM public.mend_agent_assert(r.invocation_id);
 RETURN r.invocation_id;
END; $$;
REVOKE ALL ON FUNCTION public.mend_operator_assert(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_operator_assert(uuid,text,text) TO mend_conversion;
--> statement-breakpoint
CREATE FUNCTION public.mend_operator_finish(p_request uuid,p_outcome text,p_evidence jsonb) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.operator_requests;
BEGIN
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM 1 FROM public.orders WHERE id=r.order_id FOR UPDATE;
 IF r.invocation_id IS NOT NULL THEN PERFORM 1 FROM public.agent_invocations WHERE id=r.invocation_id FOR UPDATE; END IF;
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request FOR UPDATE;
 IF r.finished_at IS NOT NULL THEN RETURN; END IF;
 IF p_outcome NOT IN ('checked','completed','skipped','uncertain','investigated') OR octet_length(p_evidence::text)>16384 THEN RAISE EXCEPTION 'invalid_outcome'; END IF;
 UPDATE public.operator_requests SET outcome=p_outcome,outcome_evidence=p_evidence,finished_at=clock_timestamp() WHERE id=p_request;
 IF r.invocation_id IS NOT NULL THEN UPDATE public.agent_invocations SET finished_at=clock_timestamp(),outcome='operator_'||p_outcome WHERE id=r.invocation_id AND finished_at IS NULL; END IF;
 -- Deterministic inspection/actions never reset model budget or clear escalation.
END; $$;
REVOKE ALL ON FUNCTION public.mend_operator_finish(uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_operator_finish(uuid,text,jsonb) TO mend_web,mend_conversion;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_agent_claim(p_inv uuid,p_call uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE oid uuid; n integer;
BEGIN
 oid=public.mend_agent_assert(p_inv);
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 PERFORM public.mend_agent_assert(p_inv);
 IF EXISTS(SELECT FROM public.agent_invocations WHERE id=p_inv AND purpose<>'model') THEN RAISE EXCEPTION 'model_not_permitted'; END IF;
 UPDATE public.recovery_cases SET calls_used=calls_used+1,updated_at=clock_timestamp() WHERE order_id=oid AND calls_used<12 RETURNING calls_used INTO n;
 IF n IS NULL THEN RAISE EXCEPTION 'budget_exhausted'; END IF;
 INSERT INTO public.agent_calls(id,invocation_id,order_id,ordinal) VALUES(p_call,p_inv,oid,n);
 RETURN n;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_agent_assert(p_inv uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.agent_invocations;
BEGIN
 SELECT * INTO i FROM public.agent_invocations WHERE id=p_inv;
 IF NOT FOUND OR i.finished_at IS NOT NULL OR i.deadline<=clock_timestamp() THEN RAISE EXCEPTION 'invocation_expired'; END IF;
 IF i.purpose='operator' AND NOT EXISTS(SELECT FROM public.operator_requests r JOIN public.auth_sessions s ON s.token_hash=r.session_hash AND s.wallet=r.actor WHERE r.invocation_id=p_inv AND r.finished_at IS NULL AND r.deadline>clock_timestamp() AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'operator_session_expired'; END IF;
 RETURN i.order_id;
END; $$;
--> statement-breakpoint
CREATE FUNCTION public.mend_operator_dispatch(p_request uuid,p_actor text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r public.operator_requests; i uuid;
BEGIN
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request;
 IF NOT FOUND OR r.action NOT IN ('check','restore','retry') THEN RAISE EXCEPTION 'invalid_request'; END IF;
 PERFORM 1 FROM public.orders WHERE id=r.order_id FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=r.invocation_id FOR UPDATE;
 SELECT * INTO r FROM public.operator_requests WHERE id=p_request FOR UPDATE;
 i=public.mend_operator_assert(p_request,r.action,p_actor);
 IF r.dispatched_at IS NOT NULL THEN RETURN jsonb_build_object('reason','request_already_dispatched'); END IF;
 UPDATE public.operator_requests SET dispatched_at=clock_timestamp() WHERE id=p_request;
 RETURN jsonb_build_object('invocationId',i,'action',r.action);
END; $$;
REVOKE ALL ON FUNCTION public.mend_operator_dispatch(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_operator_dispatch(uuid,text) TO mend_conversion;
