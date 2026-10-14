CREATE TABLE "agent_actions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invocation_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"tool" text NOT NULL,
	"outcome" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"invocation_id" uuid NOT NULL,
	"order_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"claimed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "agent_invocations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"outcome" text
);
--> statement-breakpoint
CREATE TABLE "recovery_cases" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"calls_used" integer DEFAULT 0 NOT NULL,
	"escalation" text,
	"observe_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_invocation_id_agent_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."agent_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_actions" ADD CONSTRAINT "agent_actions_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_invocation_id_agent_invocations_id_fk" FOREIGN KEY ("invocation_id") REFERENCES "public"."agent_invocations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_calls" ADD CONSTRAINT "agent_calls_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_invocations" ADD CONSTRAINT "agent_invocations_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recovery_cases" ADD CONSTRAINT "recovery_cases_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_case_ordinal" ON "agent_calls" USING btree ("order_id","ordinal");--> statement-breakpoint
ALTER TABLE public.recovery_cases ADD CONSTRAINT case_model_budget CHECK(calls_used BETWEEN 0 AND 12);
CREATE UNIQUE INDEX agent_one_active ON public.agent_invocations(order_id) WHERE finished_at IS NULL;
REVOKE ALL ON public.recovery_cases,public.agent_invocations,public.agent_calls,public.agent_actions FROM PUBLIC,mend_web,mend_worker,mend_conversion,mend_registrar;
GRANT SELECT ON public.recovery_cases,public.agent_invocations,public.agent_calls,public.agent_actions TO mend_web,mend_worker,mend_conversion;
--> statement-breakpoint
CREATE FUNCTION public.mend_agent_begin(p_order uuid,p_inv uuid) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.orders; c public.recovery_cases; i public.agent_invocations;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND OR o.paid_at IS NULL OR o.payment_receipt IS NULL OR o.disposition<>'unresolved' THEN RETURN jsonb_build_object('error','no_unresolved_paid_obligation'); END IF;
 INSERT INTO public.recovery_cases(order_id) VALUES(p_order) ON CONFLICT DO NOTHING;
 UPDATE public.agent_invocations SET finished_at=clock_timestamp(),outcome='abandoned' WHERE order_id=p_order AND finished_at IS NULL AND deadline<=clock_timestamp();
 IF EXISTS(SELECT FROM public.agent_invocations WHERE order_id=p_order AND finished_at IS NULL) THEN RETURN jsonb_build_object('error','investigation_running'); END IF;
 SELECT * INTO c FROM public.recovery_cases WHERE order_id=p_order FOR UPDATE;
 IF c.calls_used>=12 THEN UPDATE public.recovery_cases SET escalation='budget_exhausted',updated_at=clock_timestamp() WHERE order_id=p_order; RETURN jsonb_build_object('error','budget_exhausted'); END IF;
 INSERT INTO public.agent_invocations(id,order_id,deadline) VALUES(p_inv,p_order,clock_timestamp()+interval '60 seconds') RETURNING * INTO i;
 RETURN to_jsonb(i)||jsonb_build_object('remaining',12-c.calls_used);
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_begin(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_begin(uuid,uuid) TO mend_worker;
--> statement-breakpoint
CREATE FUNCTION public.mend_agent_assert(p_inv uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.agent_invocations;
BEGIN
 SELECT * INTO i FROM public.agent_invocations WHERE id=p_inv;
 IF NOT FOUND OR i.finished_at IS NOT NULL OR i.deadline<=clock_timestamp() THEN RAISE EXCEPTION 'invocation_expired'; END IF;
 RETURN i.order_id;
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_assert(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_assert(uuid) TO mend_worker,mend_conversion;
--> statement-breakpoint
CREATE FUNCTION public.mend_agent_claim(p_inv uuid,p_call uuid) RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE oid uuid; n integer;
BEGIN
 oid=public.mend_agent_assert(p_inv);
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 PERFORM public.mend_agent_assert(p_inv);
 UPDATE public.recovery_cases SET calls_used=calls_used+1,updated_at=clock_timestamp() WHERE order_id=oid AND calls_used<12 RETURNING calls_used INTO n;
 IF n IS NULL THEN RAISE EXCEPTION 'budget_exhausted'; END IF;
 INSERT INTO public.agent_calls(id,invocation_id,order_id,ordinal) VALUES(p_call,p_inv,oid,n);
 RETURN n;
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_claim(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_claim(uuid,uuid) TO mend_worker;
--> statement-breakpoint
CREATE FUNCTION public.mend_agent_record(p_inv uuid,p_action uuid,p_tool text,p_outcome text,p_evidence jsonb,p_observe integer DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE oid uuid;
BEGIN
 oid=public.mend_agent_assert(p_inv);
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 PERFORM public.mend_agent_assert(p_inv);
 IF p_tool NOT IN ('inspect_order','inspect_execution','inspect_output','related_orders','observe_later','restore_result') OR length(p_outcome)>64 OR octet_length(p_evidence::text)>8192 THEN RAISE EXCEPTION 'invalid_agent_action'; END IF;
 IF p_observe IS NOT NULL THEN
  IF p_tool<>'observe_later' OR p_observe<60 OR p_observe>900 THEN RAISE EXCEPTION 'invalid_observation'; END IF;
  UPDATE public.recovery_cases SET observe_at=clock_timestamp()+make_interval(secs=>p_observe),updated_at=clock_timestamp() WHERE order_id=oid;
 END IF;
 INSERT INTO public.agent_actions(id,invocation_id,order_id,tool,outcome,evidence) VALUES(p_action,p_inv,oid,p_tool,p_outcome,p_evidence);
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_record(uuid,uuid,text,text,jsonb,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_record(uuid,uuid,text,text,jsonb,integer) TO mend_worker;
--> statement-breakpoint
CREATE FUNCTION public.mend_agent_finish(p_inv uuid,p_outcome text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE i public.agent_invocations;
BEGIN
 SELECT * INTO i FROM public.agent_invocations WHERE id=p_inv;
 IF NOT FOUND THEN RETURN; END IF;
 PERFORM 1 FROM public.orders WHERE id=i.order_id FOR UPDATE;
 SELECT * INTO i FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 IF i.finished_at IS NOT NULL THEN RETURN; END IF;
 IF i.deadline<=clock_timestamp() THEN p_outcome='invocation_timeout'; END IF;
 IF p_outcome NOT IN ('investigated','model_unavailable','budget_exhausted','invocation_timeout','tool_error') THEN p_outcome='tool_error'; END IF;
 UPDATE public.agent_invocations SET finished_at=clock_timestamp(),outcome=p_outcome WHERE id=p_inv;
 UPDATE public.recovery_cases SET escalation=CASE WHEN p_outcome='investigated' THEN NULL ELSE p_outcome END,updated_at=clock_timestamp() WHERE order_id=i.order_id;
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_finish(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_finish(uuid,text) TO mend_worker;
--> statement-breakpoint
CREATE FUNCTION public.mend_agent_restore(p_inv uuid,p_attempt uuid,p_result jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE oid uuid; result boolean;
BEGIN
 oid=public.mend_agent_assert(p_inv);
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 PERFORM public.mend_agent_assert(p_inv);
 IF NOT EXISTS(SELECT FROM public.execution_attempts WHERE id=p_attempt AND order_id=oid AND publisher_finished_at IS NOT NULL) THEN RETURN false; END IF;
 IF (p_result->>'expiresAt')::timestamptz<=clock_timestamp() THEN RETURN false; END IF;
 result=public.mend_restore_output(p_attempt,p_result);
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.mend_agent_restore(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_agent_restore(uuid,uuid,jsonb) TO mend_conversion;
