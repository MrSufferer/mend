-- Required evidence must retain object/array shape; JSON null is never authority.
CREATE OR REPLACE FUNCTION public.mend_agent_record(p_inv uuid, p_action uuid, p_tool text, p_outcome text, p_evidence jsonb, p_observe integer DEFAULT NULL::integer)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE oid uuid;
BEGIN
 oid=public.mend_agent_assert(p_inv);
 PERFORM 1 FROM public.orders WHERE id=oid FOR UPDATE;
 PERFORM 1 FROM public.agent_invocations WHERE id=p_inv FOR UPDATE;
 PERFORM public.mend_agent_assert(p_inv);
 IF p_tool IS NULL OR p_outcome IS NULL OR length(p_outcome)=0 OR jsonb_typeof(p_evidence) IS DISTINCT FROM 'object' OR p_tool NOT IN ('inspect_order','inspect_execution','inspect_output','related_orders','observe_later','restore_result','retry_once','request_pause','request_refund') OR length(p_outcome)>64 OR octet_length(p_evidence::text)>8192 THEN RAISE EXCEPTION 'invalid_agent_action'; END IF;
 IF p_observe IS NOT NULL THEN
  IF p_tool<>'observe_later' OR p_observe<60 OR p_observe>900 THEN RAISE EXCEPTION 'invalid_observation'; END IF;
  UPDATE public.recovery_cases SET observe_at=clock_timestamp()+make_interval(secs=>p_observe),updated_at=clock_timestamp() WHERE order_id=oid;
 END IF;
 INSERT INTO public.agent_actions(id,invocation_id,order_id,tool,outcome,evidence) VALUES(p_action,p_inv,oid,p_tool,p_outcome,p_evidence);
 RETURN true;
END; $function$
;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_capacity_commit(p_version bigint,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.refund_capacity; s public.service_availability; debt numeric; n integer; status text; result jsonb;
BEGIN
 SELECT * INTO s FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 SELECT * INTO c FROM public.refund_capacity WHERE id='merchant' FOR UPDATE;
 IF p_version IS DISTINCT FROM c.version THEN RETURN jsonb_build_object('status','stale'); END IF;
 IF jsonb_typeof(p) IS DISTINCT FROM 'object' OR p->>'chainId' IS DISTINCT FROM '5042002' OR p->>'contract' IS DISTINCT FROM '0x76b29d6a6eab98b32415b8a6adf5d587d991e082' OR COALESCE(p->>'blockHash','') !~ '^0x[0-9a-f]{64}$' OR COALESCE(p->>'blockNumber','') !~ '^[0-9]+$' OR COALESCE(p->>'balanceAtomic','') !~ '^[0-9]+$' OR COALESCE(p->>'allowanceAtomic','') !~ '^[0-9]+$' OR p->>'chainTimestamp' IS NULL OR p->>'allowanceResetAt' IS NULL OR jsonb_typeof(p->'outstandingOrderIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'repaidOrderIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'capacity_evidence_invalid'; END IF;
 IF (p->>'chainTimestamp')::timestamptz<clock_timestamp()-interval '120 seconds' OR (p->>'chainTimestamp')::timestamptz>clock_timestamp()+interval '15 seconds' OR (p->>'allowanceResetAt')::timestamptz IS DISTINCT FROM date_trunc('day',(p->>'chainTimestamp')::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 day' OR (p->>'allowanceAtomic')::numeric>10000000 THEN RAISE EXCEPTION 'capacity_evidence_stale'; END IF;
 IF EXISTS(SELECT FROM jsonb_array_elements((p->'outstandingOrderIds')||(p->'repaidOrderIds')) e WHERE jsonb_typeof(e) IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'capacity_backlog_mismatch'; END IF;
 -- Partition must match the whole current backlog exactly, once per order.
 IF EXISTS(SELECT FROM (SELECT value,count(*) n FROM jsonb_array_elements_text((p->'outstandingOrderIds')||(p->'repaidOrderIds')) GROUP BY value) x WHERE x.n<>1 OR NOT EXISTS(SELECT FROM public.refunds WHERE order_id::text=x.value AND refunded_at IS NULL)) OR (SELECT count(*) FROM public.refunds WHERE refunded_at IS NULL)<>jsonb_array_length(p->'outstandingOrderIds')+jsonb_array_length(p->'repaidOrderIds') THEN RAISE EXCEPTION 'capacity_backlog_mismatch'; END IF;
 -- Only the isolated canonical registrar may supply repayment inclusion evidence.
 SELECT COALESCE(sum(amount_atomic::numeric),0),count(*) INTO debt,n FROM public.refunds WHERE refunded_at IS NULL AND order_id::text IN (SELECT jsonb_array_elements_text(p->'outstandingOrderIds'));
 status=CASE WHEN (p->>'balanceAtomic')::numeric<debt OR (p->>'allowanceAtomic')::numeric<debt THEN 'deficit' ELSE 'sufficient' END;
 result=p||jsonb_build_object('status',status,'debtAtomic',debt::text,'orders',n,'version',p_version,'reserveDeficit',(p->>'balanceAtomic')::numeric<debt,'allowanceDeficit',(p->>'allowanceAtomic')::numeric<debt);
 UPDATE public.refund_capacity SET observation=result,observed_version=p_version,observed_at=clock_timestamp() WHERE id='merchant';
 UPDATE public.refunds SET blocker=CASE WHEN (p->>'balanceAtomic')::numeric<debt THEN 'reserve_unfunded' WHEN (p->>'allowanceAtomic')::numeric<debt THEN 'allowance_exhausted' ELSE NULL END WHERE refunded_at IS NULL AND blocker IS DISTINCT FROM CASE WHEN (p->>'balanceAtomic')::numeric<debt THEN 'reserve_unfunded' WHEN (p->>'allowanceAtomic')::numeric<debt THEN 'allowance_exhausted' ELSE NULL END;
 IF status='deficit' AND (NOT s.paused OR c.observation->>'status' IS DISTINCT FROM 'deficit') THEN
  UPDATE public.service_availability SET paused=true,generation=generation+1,paused_at=clock_timestamp() WHERE id='merchant' RETURNING * INTO s;
  INSERT INTO public.service_incidents(id,actor_kind,actor,reason,evidence,generation,failure_generation) VALUES(gen_random_uuid(),'deterministic','refund_capacity','Authorized refunds exceed observed reserve capacity',result||jsonb_build_object('attemptIds','[]'::jsonb,'orderIds',p->'outstandingOrderIds'),s.generation,s.failure_generation);
 END IF;
 RETURN result;
END; $$;
