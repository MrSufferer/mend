-- Conversion alone confirms definite processing failures. Observations, leases,
-- deadlines and unknown publication are never counted as confirmed failures.
CREATE FUNCTION public.mend_fail_execution(p_attempt uuid,p_check text,p_diagnostic text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE s public.service_availability; a public.execution_attempts; o public.orders; t timestamptz; n integer; inserted integer; evidence jsonb;
BEGIN
 SELECT * INTO s FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt;
 IF NOT FOUND THEN RAISE EXCEPTION 'attempt_missing'; END IF;
 SELECT * INTO o FROM public.orders WHERE id=a.order_id FOR UPDATE;
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt FOR UPDATE;
 IF p_diagnostic IS NULL OR p_diagnostic NOT IN ('upload_integrity','pdf_conversion_failed','deadline_stopped','infrastructure_error') THEN RAISE EXCEPTION 'invalid_diagnostic'; END IF;
 PERFORM public.mend_finish_execution(p_attempt,p_check,NULL);
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt;
 UPDATE public.execution_attempts SET diagnostic_code=COALESCE(diagnostic_code,p_diagnostic) WHERE id=p_attempt;
 UPDATE public.orders SET status='processing_failed' WHERE id=a.order_id AND delivered_at IS NULL AND disposition='unresolved';
 inserted=0;
 IF o.paid_at IS NOT NULL AND o.payment_receipt IS NOT NULL AND a.stopped_at IS NOT NULL AND a.publisher_finished_at IS NOT NULL AND a.publication_fenced_at IS NOT NULL AND a.final_output_check='absent' AND a.output_publication IS NULL AND p_diagnostic IN ('upload_integrity','pdf_conversion_failed') AND (a.diagnostic_code IS NULL OR a.diagnostic_code=p_diagnostic) THEN
  t=clock_timestamp();
  INSERT INTO public.processing_failures(attempt_id,order_id,generation,diagnostic,confirmed_at) VALUES(a.id,a.order_id,a.generation,p_diagnostic,t) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS inserted=ROW_COUNT;
  IF inserted=1 THEN
   UPDATE public.service_availability SET failure_generation=failure_generation+1 WHERE id='merchant' RETURNING * INTO s;
   SELECT count(*) INTO n FROM public.processing_failures WHERE confirmed_at>=t-interval '5 minutes' AND confirmed_at<=t;
   IF n>=3 AND NOT s.paused THEN
    UPDATE public.service_availability SET paused=true,generation=generation+1,paused_at=t WHERE id='merchant' RETURNING * INTO s;
    SELECT jsonb_build_object('attemptIds',jsonb_agg(attempt_id ORDER BY attempt_id),'orderIds',(SELECT jsonb_agg(x.order_id ORDER BY x.order_id) FROM (SELECT DISTINCT order_id FROM public.processing_failures WHERE confirmed_at>=t-interval '5 minutes' AND confirmed_at<=t) x)) INTO evidence FROM public.processing_failures WHERE confirmed_at>=t-interval '5 minutes' AND confirmed_at<=t;
    INSERT INTO public.service_incidents(id,actor_kind,actor,reason,evidence,generation,failure_generation,created_at) VALUES(gen_random_uuid(),'deterministic','processing_threshold','Three confirmed processing failures within five minutes',evidence,s.generation,s.failure_generation,t);
   END IF;
  END IF;
 END IF;
 RETURN jsonb_build_object('recorded',inserted=1,'paused',s.paused,'failureGeneration',s.failure_generation);
END; $$;
REVOKE ALL ON FUNCTION public.mend_fail_execution(uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_fail_execution(uuid,text,text) TO mend_conversion;
