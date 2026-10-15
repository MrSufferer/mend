-- Synthetic health work has no order, payment or signing authority.
CREATE TABLE public.service_health_runs (
 id uuid PRIMARY KEY, nonce text NOT NULL CHECK(nonce ~ '^[a-f0-9]{32}$'),
 actor text NOT NULL, session_hash text NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('check','resume_recheck')), source_id uuid CONSTRAINT service_health_runs_source_id_service_health_runs_id_fk REFERENCES public.service_health_runs(id),
 generation integer NOT NULL, failure_generation integer NOT NULL, paused_at timestamptz, capacity_version bigint NOT NULL,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(), deadline timestamptz NOT NULL DEFAULT clock_timestamp()+interval '20 seconds',
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes', finished_at timestamptz, resumed_at timestamptz,
 status text NOT NULL DEFAULT 'running' CHECK(status IN ('running','passed','failed','unknown')),
 validation_at timestamptz, parser_at timestamptz, storage_at timestamptz, payment_at timestamptz, capacity_at timestamptz, retrieval_at timestamptz,
 diagnostic text, input_hash text, input_size integer, output_hash text, output_size integer, output_created_at timestamptz,
 conversion_claimed boolean NOT NULL DEFAULT false, registrar_claimed boolean NOT NULL DEFAULT false, cleaned_at timestamptz,
 CHECK(input_hash IS NULL OR input_hash ~ '^[a-f0-9]{64}$'), CHECK(output_hash IS NULL OR output_hash ~ '^[a-f0-9]{64}$'),
 CHECK(input_size IS NULL OR input_size BETWEEN 1 AND 10485760),CHECK(output_size IS NULL OR output_size BETWEEN 1 AND 10485760)
);
CREATE INDEX service_health_expiry ON public.service_health_runs(expires_at) WHERE cleaned_at IS NULL;
REVOKE ALL ON public.service_health_runs FROM PUBLIC,mend_web,mend_conversion,mend_registrar,mend_worker,mend_refund_worker;
--> statement-breakpoint
-- All later proof writes recheck the initiating session after service/capacity/work locks.
CREATE FUNCTION public.mend_health_assert(p_id uuid) RETURNS public.service_health_runs LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h public.service_health_runs;
BEGIN
 PERFORM 1 FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 PERFORM 1 FROM public.refund_capacity WHERE id='merchant' FOR UPDATE;
 SELECT * INTO h FROM public.service_health_runs WHERE id=p_id FOR UPDATE;
 IF h.id IS NULL OR h.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'health_expired'; END IF;
 PERFORM 1 FROM public.auth_sessions WHERE token_hash=h.session_hash AND wallet=h.actor AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'operator_session_expired'; END IF;
 RETURN h;
END; $$;
REVOKE ALL ON FUNCTION public.mend_health_assert(uuid) FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.mend_health_begin(p_id uuid,p_nonce text,p_session text,p_actor text,p_source uuid DEFAULT NULL) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.service_availability;c public.refund_capacity;h public.service_health_runs;
BEGIN
 SELECT * INTO s FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 SELECT * INTO c FROM public.refund_capacity WHERE id='merchant' FOR UPDATE;
 PERFORM 1 FROM public.auth_sessions WHERE token_hash=p_session AND wallet=p_actor AND revoked_at IS NULL AND expires_at>clock_timestamp() FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'operator_session_expired'; END IF;
 IF EXISTS(SELECT FROM public.service_health_runs WHERE session_hash=p_session AND status='running' AND deadline>clock_timestamp()) THEN RAISE EXCEPTION 'health_already_running'; END IF;
 IF p_source IS NOT NULL THEN
  SELECT * INTO h FROM public.service_health_runs WHERE id=p_source FOR UPDATE;
  IF h.id IS NULL OR h.session_hash<>p_session OR h.actor<>p_actor OR h.status<>'passed' OR h.finished_at<clock_timestamp()-interval '120 seconds' OR NOT s.paused OR h.generation<>s.generation OR h.failure_generation<>s.failure_generation OR h.paused_at IS DISTINCT FROM s.paused_at OR h.started_at<=s.paused_at OR h.capacity_version<>c.version THEN RAISE EXCEPTION 'health_stale'; END IF;
 END IF;
 INSERT INTO public.service_health_runs(id,nonce,actor,session_hash,purpose,source_id,generation,failure_generation,paused_at,capacity_version)
 VALUES(p_id,p_nonce,p_actor,p_session,CASE WHEN p_source IS NULL THEN 'check' ELSE 'resume_recheck' END,p_source,s.generation,s.failure_generation,s.paused_at,c.version);
 RETURN p_id;
END; $$;
REVOKE ALL ON FUNCTION public.mend_health_begin(uuid,text,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_health_begin(uuid,text,text,text,uuid) TO mend_web;
--> statement-breakpoint
CREATE FUNCTION public.mend_health_web(p_id uuid,p_session text,p_actor text,p_action text,p_hash text DEFAULT NULL,p_size integer DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h public.service_health_runs;s public.service_availability;c public.refund_capacity;
BEGIN
 h=public.mend_health_assert(p_id);
 IF h.session_hash IS DISTINCT FROM p_session OR h.actor IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'health_not_found'; END IF;
 SELECT * INTO s FROM public.service_availability WHERE id='merchant';SELECT * INTO c FROM public.refund_capacity WHERE id='merchant';
 IF p_action='validated' THEN
  IF h.status<>'running' OR h.deadline<=clock_timestamp() OR p_hash IS NULL OR p_size IS NULL THEN RAISE EXCEPTION 'health_expired'; END IF;
  UPDATE public.service_health_runs SET validation_at=clock_timestamp(),input_hash=p_hash,input_size=p_size WHERE id=p_id;
 ELSIF p_action='retrieved' THEN
  IF h.status<>'running' AND h.status<>'passed' THEN RAISE EXCEPTION 'health_unavailable'; END IF;
  IF h.storage_at IS NULL OR h.output_hash IS NULL OR h.output_size IS NULL OR h.output_hash IS DISTINCT FROM p_hash OR h.output_size IS DISTINCT FROM p_size THEN RAISE EXCEPTION 'health_output_invalid'; END IF;
  IF h.validation_at IS NULL OR h.parser_at IS NULL OR h.payment_at IS NULL OR h.capacity_at IS NULL OR h.started_at<clock_timestamp()-interval '120 seconds' OR h.generation<>s.generation OR h.failure_generation<>s.failure_generation OR h.paused_at IS DISTINCT FROM s.paused_at OR h.capacity_version<>c.version OR c.observed_version IS DISTINCT FROM c.version OR c.observed_at IS NULL OR c.observed_at<clock_timestamp()-interval '120 seconds' OR c.observation->>'status' IS DISTINCT FROM 'sufficient' THEN RAISE EXCEPTION 'health_stale'; END IF;
  UPDATE public.service_health_runs SET retrieval_at=COALESCE(retrieval_at,clock_timestamp()),finished_at=COALESCE(finished_at,clock_timestamp()),status='passed' WHERE id=p_id;
 ELSIF p_action='unknown' THEN
  UPDATE public.service_health_runs SET status='unknown',diagnostic='health_incomplete',finished_at=clock_timestamp() WHERE id=p_id AND status='running';
 ELSIF p_action<>'read' THEN RAISE EXCEPTION 'invalid_health_action'; END IF;
 UPDATE public.service_health_runs SET status='unknown',diagnostic='health_deadline',finished_at=clock_timestamp() WHERE id=p_id AND status='running' AND deadline<=clock_timestamp();
 SELECT * INTO h FROM public.service_health_runs WHERE id=p_id;
 -- Private web return only. Browser projection is a separate explicit allowlist.
 RETURN (to_jsonb(h)-'session_hash')||jsonb_build_object('current',h.generation=s.generation AND h.failure_generation=s.failure_generation AND h.paused_at IS NOT DISTINCT FROM s.paused_at AND h.capacity_version=c.version AND c.observed_version IS NOT DISTINCT FROM c.version AND c.observed_at>clock_timestamp()-interval '120 seconds' AND c.observation->>'status'='sufficient');
END; $$;
REVOKE ALL ON FUNCTION public.mend_health_web(uuid,text,text,text,text,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_health_web(uuid,text,text,text,text,integer) TO mend_web;
--> statement-breakpoint
CREATE FUNCTION public.mend_health_conversion(p_id uuid,p_action text,p_hash text DEFAULT NULL,p_size integer DEFAULT NULL,p_created timestamptz DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h public.service_health_runs;
BEGIN
 h=public.mend_health_assert(p_id);
 IF h.status<>'running' OR h.deadline<=clock_timestamp() THEN RAISE EXCEPTION 'health_expired'; END IF;
 IF p_action='claim' THEN
  IF h.validation_at IS NULL OR h.input_hash IS NULL OR h.input_size IS NULL OR h.conversion_claimed THEN RAISE EXCEPTION 'health_not_ready'; END IF;
  UPDATE public.service_health_runs SET conversion_claimed=true WHERE id=p_id;
 ELSIF p_action='complete' THEN
  IF NOT h.conversion_claimed OR h.parser_at IS NOT NULL OR p_hash IS NULL OR p_size IS NULL OR p_created IS NULL OR p_created<h.started_at-interval '2 seconds' OR p_created>clock_timestamp()+interval '15 seconds' THEN RAISE EXCEPTION 'health_output_invalid'; END IF;
  UPDATE public.service_health_runs SET parser_at=clock_timestamp(),storage_at=clock_timestamp(),output_hash=p_hash,output_size=p_size,output_created_at=p_created WHERE id=p_id;
 ELSIF p_action='failed' THEN UPDATE public.service_health_runs SET status='failed',diagnostic='document_failed',finished_at=clock_timestamp() WHERE id=p_id;
 ELSE RAISE EXCEPTION 'invalid_health_action'; END IF;
 RETURN jsonb_build_object('id',h.id,'nonce',h.nonce,'input_hash',h.input_hash,'input_size',h.input_size,'started_at',h.started_at,'deadline',h.deadline,'expires_at',h.expires_at);
END; $$;
REVOKE ALL ON FUNCTION public.mend_health_conversion(uuid,text,text,integer,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_health_conversion(uuid,text,text,integer,timestamptz) TO mend_conversion;
--> statement-breakpoint
CREATE FUNCTION public.mend_health_registrar(p_id uuid,p_action text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h public.service_health_runs;c public.refund_capacity;
BEGIN
 h=public.mend_health_assert(p_id);
 IF h.status<>'running' OR h.deadline<=clock_timestamp() THEN RAISE EXCEPTION 'health_expired'; END IF;
 IF p_action='claim' THEN
  IF h.registrar_claimed THEN RAISE EXCEPTION 'health_not_ready'; END IF;
  UPDATE public.service_health_runs SET registrar_claimed=true WHERE id=p_id;
 ELSIF p_action='complete' THEN
  SELECT * INTO c FROM public.refund_capacity WHERE id='merchant';
  IF NOT h.registrar_claimed OR h.payment_at IS NOT NULL OR h.capacity_version<>c.version OR c.observed_version IS DISTINCT FROM c.version OR c.observed_at IS NULL OR c.observed_at<h.started_at OR c.observation->>'status' IS DISTINCT FROM 'sufficient' THEN RAISE EXCEPTION 'capacity_unavailable'; END IF;
  UPDATE public.service_health_runs SET payment_at=clock_timestamp(),capacity_at=c.observed_at WHERE id=p_id;
 ELSIF p_action='failed' THEN UPDATE public.service_health_runs SET status='failed',diagnostic='payment_or_capacity_failed',finished_at=clock_timestamp() WHERE id=p_id;
 ELSE RAISE EXCEPTION 'invalid_health_action'; END IF;
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.mend_health_registrar(uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_health_registrar(uuid,text) TO mend_registrar;
--> statement-breakpoint
CREATE FUNCTION public.mend_operator_resume(p_source uuid,p_recheck uuid,p_session text,p_actor text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE h public.service_health_runs;o public.service_health_runs;s public.service_availability;c public.refund_capacity;
BEGIN
 h=public.mend_health_assert(p_recheck);
 SELECT * INTO s FROM public.service_availability WHERE id='merchant';SELECT * INTO c FROM public.refund_capacity WHERE id='merchant';
 SELECT * INTO o FROM public.service_health_runs WHERE id=p_source FOR UPDATE;
 IF h.session_hash IS DISTINCT FROM p_session OR h.actor IS DISTINCT FROM p_actor OR h.source_id IS DISTINCT FROM p_source OR h.purpose<>'resume_recheck' OR o.id IS NULL OR o.session_hash IS DISTINCT FROM p_session OR o.actor IS DISTINCT FROM p_actor THEN RAISE EXCEPTION 'health_not_found'; END IF;
 IF h.resumed_at IS NOT NULL AND NOT s.paused AND s.generation=h.generation+1 AND s.failure_generation=h.failure_generation THEN RETURN true; END IF;
 IF NOT s.paused OR h.resumed_at IS NOT NULL OR h.status<>'passed' OR o.status<>'passed' OR h.finished_at IS NULL OR o.finished_at IS NULL OR o.finished_at<clock_timestamp()-interval '120 seconds' OR h.started_at<clock_timestamp()-interval '120 seconds' OR h.started_at<=s.paused_at OR o.started_at<=s.paused_at OR h.generation<>s.generation OR o.generation<>s.generation OR h.failure_generation<>s.failure_generation OR o.failure_generation<>s.failure_generation OR h.paused_at IS DISTINCT FROM s.paused_at OR o.paused_at IS DISTINCT FROM s.paused_at OR h.capacity_version<>c.version OR o.capacity_version<>c.version OR c.observed_version IS DISTINCT FROM c.version OR c.observed_at IS NULL OR c.observed_at<h.started_at OR c.observed_at<clock_timestamp()-interval '120 seconds' OR c.observation->>'status' IS DISTINCT FROM 'sufficient' THEN RAISE EXCEPTION 'health_stale'; END IF;
 UPDATE public.service_availability SET paused=false,generation=generation+1 WHERE id='merchant' RETURNING * INTO s;
 UPDATE public.service_health_runs SET resumed_at=clock_timestamp() WHERE id=p_recheck;
 INSERT INTO public.service_incidents(id,actor_kind,actor,reason,evidence,generation,failure_generation) VALUES(p_recheck,'operator',p_actor,'Operator resumed after a fresh health check',jsonb_build_object('attemptIds','[]'::jsonb,'orderIds','[]'::jsonb,'healthId',p_source,'recheckId',p_recheck),s.generation,s.failure_generation);
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.mend_operator_resume(uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_operator_resume(uuid,uuid,text,text) TO mend_web;
--> statement-breakpoint
CREATE FUNCTION public.mend_health_cleanup(p_done uuid DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.service_health_runs SET status='unknown',diagnostic='health_deadline',finished_at=clock_timestamp() WHERE status='running' AND deadline<=clock_timestamp();
 IF p_done IS NOT NULL THEN UPDATE public.service_health_runs SET cleaned_at=clock_timestamp() WHERE id=p_done AND expires_at<=clock_timestamp(); END IF;
 DELETE FROM public.service_health_runs WHERE id IN (SELECT h.id FROM public.service_health_runs h WHERE h.cleaned_at IS NOT NULL AND h.expires_at<clock_timestamp()-interval '1 day' AND NOT EXISTS(SELECT FROM public.service_health_runs child WHERE child.source_id=h.id) ORDER BY h.expires_at LIMIT 20);
 RETURN COALESCE((SELECT jsonb_agg(id) FROM (SELECT id FROM public.service_health_runs WHERE expires_at<=clock_timestamp() AND cleaned_at IS NULL ORDER BY expires_at LIMIT 3) expired),'[]'::jsonb);
END; $$;
REVOKE ALL ON FUNCTION public.mend_health_cleanup(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_health_cleanup(uuid) TO mend_conversion;
