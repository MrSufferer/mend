CREATE TABLE "refund_capacity" (
	"id" text PRIMARY KEY DEFAULT 'merchant' NOT NULL,
	"version" bigint DEFAULT 0 NOT NULL,
	"observed_version" bigint,
	"observation" jsonb,
	"observed_at" timestamp with time zone,
	CONSTRAINT "refund_capacity_merchant" CHECK ("refund_capacity"."id"='merchant')
);

--> statement-breakpoint
INSERT INTO public.refund_capacity(id) VALUES('merchant');
REVOKE ALL ON public.refund_capacity FROM PUBLIC,mend_web,mend_worker,mend_conversion,mend_registrar,mend_refund_worker;
GRANT SELECT ON public.refund_capacity TO mend_web,mend_registrar,mend_refund_worker;
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_capacity_changed() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 UPDATE public.refund_capacity SET version=version+1 WHERE id='merchant';
 RETURN NULL;
END; $$;
REVOKE ALL ON FUNCTION public.mend_refund_capacity_changed() FROM PUBLIC;
CREATE TRIGGER refund_capacity_changed AFTER INSERT OR DELETE OR UPDATE OF chain_order_id,payer,amount_atomic,state,refund_hash,refunded_at ON public.refunds FOR EACH STATEMENT EXECUTE FUNCTION public.mend_refund_capacity_changed();
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_capacity_backlog() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v bigint; bindings jsonb;
BEGIN
 PERFORM 1 FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 SELECT version INTO v FROM public.refund_capacity WHERE id='merchant';
 SELECT COALESCE(jsonb_agg(jsonb_build_object('order_id',order_id,'chain_order_id',chain_order_id,'payer',payer,'amount_atomic',amount_atomic,'refund_hash',refund_hash) ORDER BY order_id),'[]') INTO bindings FROM public.refunds WHERE refunded_at IS NULL;
 RETURN jsonb_build_object('version',v,'bindings',bindings);
END; $$;
REVOKE ALL ON FUNCTION public.mend_refund_capacity_backlog() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_refund_capacity_backlog() TO mend_registrar;
--> statement-breakpoint
CREATE FUNCTION public.mend_refund_capacity_commit(p_version bigint,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE c public.refund_capacity; s public.service_availability; debt numeric; n integer; status text; result jsonb;
BEGIN
 SELECT * INTO s FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 SELECT * INTO c FROM public.refund_capacity WHERE id='merchant' FOR UPDATE;
 IF p_version IS DISTINCT FROM c.version THEN RETURN jsonb_build_object('status','stale'); END IF;
 IF p IS NULL OR p->>'chainId' IS DISTINCT FROM '5042002' OR p->>'contract' IS DISTINCT FROM '0x76b29d6a6eab98b32415b8a6adf5d587d991e082' OR COALESCE(p->>'blockHash','') !~ '^0x[0-9a-f]{64}$' OR COALESCE(p->>'blockNumber','') !~ '^[0-9]+$' OR COALESCE(p->>'balanceAtomic','') !~ '^[0-9]+$' OR COALESCE(p->>'allowanceAtomic','') !~ '^[0-9]+$' OR p->>'chainTimestamp' IS NULL OR p->>'allowanceResetAt' IS NULL OR jsonb_typeof(p->'outstandingOrderIds') IS DISTINCT FROM 'array' OR jsonb_typeof(p->'repaidOrderIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'capacity_evidence_invalid'; END IF;
 IF (p->>'chainTimestamp')::timestamptz<clock_timestamp()-interval '120 seconds' OR (p->>'chainTimestamp')::timestamptz>clock_timestamp()+interval '15 seconds' OR (p->>'allowanceResetAt')::timestamptz IS DISTINCT FROM date_trunc('day',(p->>'chainTimestamp')::timestamptz AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'+interval '1 day' OR (p->>'allowanceAtomic')::numeric>10000000 THEN RAISE EXCEPTION 'capacity_evidence_stale'; END IF;
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
  INSERT INTO public.service_incidents(id,actor_kind,actor,reason,evidence,generation,failure_generation) VALUES(gen_random_uuid(),'deterministic','refund_capacity','Authorized refunds exceed observed reserve capacity',result,s.generation,s.failure_generation);
 END IF;
 RETURN result;
END; $$;
REVOKE ALL ON FUNCTION public.mend_refund_capacity_commit(bigint,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_refund_capacity_commit(bigint,jsonb) TO mend_registrar;
