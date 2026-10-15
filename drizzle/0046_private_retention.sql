-- Content only: durable operational records and historical publication evidence survive.
CREATE TABLE public.content_retention (
 kind text NOT NULL CHECK(kind IN ('staging','upload','output')), object_key text NOT NULL,
 created_at timestamptz, expires_at timestamptz NOT NULL,
 tombstoned_at timestamptz, checked_at timestamptz, deleted_at timestamptz,
 claimed_until timestamptz, failure text CHECK(failure IS NULL OR failure IN ('storage_unknown','object_present')),
 CHECK((kind='staging' AND object_key ~ '^staging/[0-9a-f-]{36}\.pdf$') OR (kind='upload' AND object_key ~ '^accepted/[0-9a-f-]{36}\.pdf$') OR (kind='output' AND object_key ~ '^results/[0-9a-f-]{36}/[0-9a-f-]{36}\.txt$')),
 CONSTRAINT content_retention_kind_object_key_pk PRIMARY KEY(kind,object_key)
);
CREATE INDEX content_retention_due ON public.content_retention(expires_at,checked_at);
REVOKE ALL ON public.content_retention FROM PUBLIC,mend_web,mend_worker,mend_registrar,mend_refund_worker,mend_conversion,mend_payment_reconciler;
GRANT SELECT ON public.content_retention TO mend_conversion;
--> statement-breakpoint
CREATE FUNCTION public.mend_retention_inventory() RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 INSERT INTO content_retention(kind,object_key,created_at,expires_at)
 SELECT 'staging','staging/'||id||'.pdf',created_at,expires_at+interval '5 minutes' FROM submissions s WHERE NOT EXISTS(SELECT FROM content_retention r WHERE r.kind='staging' AND r.object_key='staging/'||s.id||'.pdf') ORDER BY s.created_at LIMIT 100 ON CONFLICT DO NOTHING;
 INSERT INTO content_retention(kind,object_key,created_at,expires_at)
 SELECT 'upload','accepted/'||submission_id||'.pdf',upload_created_at,upload_expires_at FROM orders o WHERE o.upload_key='accepted/'||o.submission_id||'.pdf' AND NOT EXISTS(SELECT FROM content_retention r WHERE r.kind='upload' AND r.object_key=o.upload_key) ORDER BY o.upload_expires_at LIMIT 100 ON CONFLICT DO NOTHING;
 -- Interrupted finalize has a deterministic accepted key, even without an order.
 -- Unknown original creation uses the earlier submission clock for privacy only.
 INSERT INTO content_retention(kind,object_key,expires_at)
 SELECT 'upload','accepted/'||id||'.pdf',created_at+interval '7 days' FROM submissions s WHERE NOT EXISTS(SELECT FROM content_retention r WHERE r.kind='upload' AND r.object_key='accepted/'||s.id||'.pdf') ORDER BY s.created_at LIMIT 100 ON CONFLICT DO NOTHING;
 INSERT INTO content_retention(kind,object_key,created_at,expires_at)
 SELECT 'output',result->>'key',(result->>'createdAt')::timestamptz,(result->>'expiresAt')::timestamptz FROM orders o WHERE result IS NOT NULL AND EXISTS(SELECT FROM execution_attempts a WHERE a.order_id=o.id AND o.result->>'key'='results/'||o.id||'/'||a.id||'.txt') AND NOT EXISTS(SELECT FROM content_retention r WHERE r.kind='output' AND r.object_key=o.result->>'key') ORDER BY o.created_at LIMIT 100 ON CONFLICT DO NOTHING;
 INSERT INTO content_retention(kind,object_key,expires_at)
 SELECT 'output','results/'||order_id||'/'||id||'.txt',(output_publication->>'preparedAt')::timestamptz+interval '7 days' FROM execution_attempts a WHERE output_publication IS NOT NULL AND NOT EXISTS(SELECT FROM content_retention r WHERE r.kind='output' AND r.object_key='results/'||a.order_id||'/'||a.id||'.txt') ORDER BY a.started_at LIMIT 100 ON CONFLICT DO NOTHING;
END; $$;
--> statement-breakpoint
CREATE FUNCTION public.mend_retention_clock(p_attempt uuid,p_created timestamptz) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a execution_attempts; r content_retention;
BEGIN
 SELECT * INTO a FROM execution_attempts WHERE id=p_attempt;
 IF a.output_publication IS NULL OR p_created IS NULL OR p_created>clock_timestamp() OR p_created<(a.output_publication->>'preparedAt')::timestamptz-interval '1 second' THEN RAISE EXCEPTION 'retention_clock_unknown'; END IF;
 INSERT INTO content_retention(kind,object_key,created_at,expires_at) VALUES('output',a.output_publication->>'key',p_created,p_created+interval '7 days') ON CONFLICT DO NOTHING;
 SELECT * INTO r FROM content_retention WHERE kind='output' AND object_key=a.output_publication->>'key' FOR UPDATE;
 IF r.created_at IS NULL AND p_created<r.expires_at THEN
  UPDATE content_retention SET created_at=p_created,expires_at=CASE WHEN tombstoned_at IS NULL AND expires_at>clock_timestamp() THEN p_created+interval '7 days' ELSE LEAST(expires_at,p_created+interval '7 days') END WHERE kind=r.kind AND object_key=r.object_key RETURNING * INTO r;
 END IF;
 IF r.created_at IS DISTINCT FROM p_created THEN RAISE EXCEPTION 'retention_clock_changed'; END IF;
 RETURN jsonb_build_object('createdAt',r.created_at,'expiresAt',r.expires_at,'tombstoned',r.tombstoned_at IS NOT NULL);
END; $$;
--> statement-breakpoint
CREATE FUNCTION public.mend_retention_claim() RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE ids jsonb;
BEGIN
 PERFORM mend_retention_inventory();
 WITH due AS (SELECT kind,object_key FROM content_retention WHERE expires_at<=clock_timestamp() AND (claimed_until IS NULL OR claimed_until<clock_timestamp()) ORDER BY checked_at ASC NULLS FIRST,expires_at LIMIT 12 FOR UPDATE SKIP LOCKED), claimed AS (
 UPDATE content_retention r SET tombstoned_at=COALESCE(tombstoned_at,clock_timestamp()),claimed_until=clock_timestamp()+interval '1 minute' FROM due d WHERE r.kind=d.kind AND r.object_key=d.object_key RETURNING r.kind,r.object_key)
 SELECT COALESCE(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) INTO ids FROM claimed;
 RETURN ids;
END; $$;
CREATE FUNCTION public.mend_retention_finish(p_kind text,p_key text,p_outcome text) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_outcome IS NULL OR p_outcome NOT IN ('absent','object_present','storage_unknown') THEN RAISE EXCEPTION 'invalid_retention_outcome'; END IF;
 UPDATE content_retention SET checked_at=clock_timestamp(),claimed_until=NULL,deleted_at=CASE WHEN p_outcome='absent' THEN clock_timestamp() ELSE NULL END,failure=CASE WHEN p_outcome='absent' THEN NULL ELSE p_outcome END WHERE kind=p_kind AND object_key=p_key AND tombstoned_at IS NOT NULL AND expires_at<=clock_timestamp();
 IF NOT FOUND THEN RAISE EXCEPTION 'retention_not_claimed'; END IF;
END; $$;
REVOKE ALL ON FUNCTION public.mend_retention_inventory(),public.mend_retention_clock(uuid,timestamptz),public.mend_retention_claim(),public.mend_retention_finish(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_retention_clock(uuid,timestamptz),public.mend_retention_claim(),public.mend_retention_finish(text,text,text) TO mend_conversion;
--> statement-breakpoint
-- Immutable assessments bind the complete attempt/publication/tombstone identity.
CREATE TABLE public.postexpiry_output_checks(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),order_id uuid NOT NULL CONSTRAINT postexpiry_output_checks_order_id_orders_id_fk REFERENCES orders(id),checked_at timestamptz NOT NULL DEFAULT clock_timestamp(),identity jsonb NOT NULL);
REVOKE ALL ON public.postexpiry_output_checks FROM PUBLIC,mend_web,mend_worker,mend_registrar,mend_refund_worker,mend_conversion,mend_payment_reconciler;
CREATE FUNCTION public.mend_retention_identity(p_order uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_agg(jsonb_build_object('id',a.id,'generation',a.generation,'publication',a.output_publication,'stopped',a.stopped_at,'finished',a.publisher_finished_at,'fenced',a.publication_fenced_at,'key',r.object_key,'created',r.created_at,'expiry',r.expires_at,'tombstone',r.tombstoned_at,'checked',r.checked_at,'deleted',r.deleted_at,'failure',r.failure) ORDER BY a.generation) FROM execution_attempts a LEFT JOIN content_retention r ON r.kind='output' AND r.object_key='results/'||a.order_id||'/'||a.id||'.txt' WHERE a.order_id=p_order
$$;
CREATE FUNCTION public.mend_postexpiry_valid(p_order uuid) RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 -- Callers hold order/attempt locks first. Keep observations fixed through the
 -- refund decision; a concurrent finish must serialize before or after it.
 PERFORM 1 FROM content_retention r JOIN execution_attempts a ON r.kind='output' AND r.object_key='results/'||a.order_id||'/'||a.id||'.txt' WHERE a.order_id=p_order ORDER BY r.object_key FOR UPDATE OF r;
 RETURN EXISTS(SELECT FROM postexpiry_output_checks c WHERE c.order_id=p_order AND c.checked_at BETWEEN clock_timestamp()-interval '10 seconds' AND clock_timestamp() AND c.identity=mend_retention_identity(p_order))
 AND NOT EXISTS(SELECT FROM execution_attempts a WHERE a.order_id=p_order AND a.output_publication IS NOT NULL AND NOT EXISTS(SELECT FROM content_retention r WHERE r.kind='output' AND r.object_key=a.output_publication->>'key' AND r.failure IS NULL AND r.deleted_at BETWEEN clock_timestamp()-interval '10 seconds' AND clock_timestamp()));
END; $$;
CREATE FUNCTION public.mend_postexpiry_check(p_order uuid,p_attempts jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 PERFORM 1 FROM orders WHERE id=p_order AND delivered_at IS NULL AND result IS NULL AND disposition='unresolved' FOR UPDATE;
 IF NOT FOUND THEN RETURN false; END IF;
 PERFORM 1 FROM execution_attempts WHERE order_id=p_order ORDER BY generation FOR UPDATE;
 PERFORM 1 FROM content_retention r JOIN execution_attempts a ON r.kind='output' AND r.object_key='results/'||a.order_id||'/'||a.id||'.txt' WHERE a.order_id=p_order ORDER BY r.object_key FOR UPDATE OF r;
 IF p_attempts IS NULL OR p_attempts IS DISTINCT FROM (SELECT jsonb_agg(id::text ORDER BY generation) FROM execution_attempts WHERE order_id=p_order) OR EXISTS(SELECT FROM execution_attempts a WHERE a.order_id=p_order AND (a.stopped_at IS NULL OR a.publisher_finished_at IS NULL OR a.publication_fenced_at IS NULL OR (a.output_publication IS NOT NULL AND NOT EXISTS(SELECT FROM content_retention r WHERE r.kind='output' AND r.object_key=a.output_publication->>'key' AND r.created_at IS NOT NULL AND r.expires_at<=clock_timestamp() AND r.tombstoned_at IS NOT NULL AND r.failure IS NULL AND r.deleted_at BETWEEN clock_timestamp()-interval '10 seconds' AND clock_timestamp())))) THEN RETURN false; END IF;
 INSERT INTO postexpiry_output_checks(order_id,identity) VALUES(p_order,mend_retention_identity(p_order));
 RETURN true;
END; $$;
REVOKE ALL ON FUNCTION public.mend_retention_identity(uuid),public.mend_postexpiry_valid(uuid),public.mend_postexpiry_check(uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_postexpiry_check(uuid,jsonb) TO mend_conversion;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_fence(p_order uuid, p_payment jsonb DEFAULT NULL::jsonb, p_request uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE o public.orders; a public.execution_attempts; c public.refund_checks; r public.refunds; t timestamptz; s public.operator_requests;
BEGIN
 PERFORM 1 FROM public.service_availability WHERE id='merchant' FOR UPDATE;
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 IF NOT FOUND THEN RETURN jsonb_build_object('reason','order_unknown'); END IF;
 SELECT * INTO r FROM public.refunds WHERE order_id=p_order;
 IF FOUND THEN RETURN to_jsonb(r); END IF;
 IF o.disposition<>'unresolved' OR o.delivered_at IS NOT NULL OR o.result IS NOT NULL THEN RETURN jsonb_build_object('reason','delivery_preferred'); END IF;
 PERFORM 1 FROM public.execution_attempts WHERE order_id=p_order ORDER BY generation FOR UPDATE;
 IF NOT EXISTS(SELECT FROM public.execution_attempts WHERE order_id=p_order) OR EXISTS(SELECT FROM public.execution_attempts WHERE order_id=p_order AND (stopped_at IS NULL OR publisher_finished_at IS NULL OR publication_fenced_at IS NULL)) THEN RETURN jsonb_build_object('reason','execution_unknown'); END IF;
 IF NOT public.mend_postexpiry_valid(p_order) AND EXISTS(SELECT FROM public.execution_attempts WHERE order_id=p_order AND (final_output_check IS DISTINCT FROM 'absent' OR output_publication IS NOT NULL)) THEN RETURN jsonb_build_object('reason','output_unknown'); END IF;
 t=clock_timestamp();
 IF o.paid_at IS NULL OR o.payment_transaction IS NULL OR o.payer_wallet IS NULL OR o.payment_receipt IS NULL THEN RETURN jsonb_build_object('reason','payment_unknown'); END IF;
 IF o.terms->>'deliverySeconds' IS NULL OR o.terms->>'maxRetries' IS NULL OR (o.terms->>'deliverySeconds')::int NOT BETWEEN 1 AND 120 OR (o.terms->>'maxRetries')::int NOT BETWEEN 0 AND 1 THEN RETURN jsonb_build_object('reason','policy_unknown'); END IF;
 IF o.terms->'price'->>'amount' IS DISTINCT FROM '1' OR o.terms->'price'->>'network' IS DISTINCT FROM 'Arc testnet' OR o.terms->'price'->>'currency' IS DISTINCT FROM 'test USDC' OR o.terms->'automaticRefundAllowance'->>'currency' IS DISTINCT FROM 'test USDC' OR o.terms->'automaticRefundAllowance'->>'period' IS DISTINCT FROM 'UTC calendar day' OR COALESCE((o.terms->'automaticRefundAllowance'->>'amount')::numeric,0)<1 THEN RETURN jsonb_build_object('reason','policy_disallows_refund'); END IF;
 IF o.paid_at+(o.terms->>'deliverySeconds')::int*interval '1 second'>t AND (SELECT max(generation) FROM public.execution_attempts WHERE order_id=p_order)<(o.terms->>'maxRetries')::int THEN RETURN jsonb_build_object('reason','recovery_remaining'); END IF;
 IF p_request IS NOT NULL THEN
  SELECT * INTO s FROM public.operator_requests WHERE id=p_request AND order_id=p_order FOR UPDATE;
  IF FOUND THEN PERFORM 1 FROM public.auth_sessions WHERE token_hash=s.session_hash FOR SHARE; END IF;
  t=clock_timestamp();
  IF s.id IS NULL THEN
   PERFORM 1 FROM public.agent_invocations WHERE id=p_request AND order_id=p_order AND purpose='model' FOR UPDATE;
   IF NOT FOUND OR public.mend_agent_assert(p_request) IS DISTINCT FROM p_order THEN RETURN jsonb_build_object('reason','agent_invocation_stale'); END IF;
  ELSIF s.action<>'refund' OR s.finished_at IS NOT NULL OR s.deadline<=t OR NOT EXISTS(SELECT FROM public.auth_sessions WHERE token_hash=s.session_hash AND wallet=s.actor AND revoked_at IS NULL AND expires_at>t) THEN RETURN jsonb_build_object('reason','operator_request_stale'); END IF;
 END IF;
 t=clock_timestamp();
 SELECT * INTO c FROM public.refund_checks WHERE order_id=p_order;
 IF NOT FOUND OR c.outcome<>'absent' OR c.checked_at<t-interval '10 seconds' OR c.checked_at>t OR c.attempt_ids IS DISTINCT FROM (SELECT jsonb_agg(id::text ORDER BY generation) FROM public.execution_attempts WHERE order_id=p_order) THEN RETURN jsonb_build_object('reason','output_check_required'); END IF;
 IF p_payment IS NULL OR p_payment->>'transaction' IS DISTINCT FROM o.payment_transaction OR p_payment->>'payer' IS DISTINCT FROM o.payer_wallet OR p_payment->>'amountAtomic' IS DISTINCT FROM '1000000' OR p_payment->>'chainId' IS DISTINCT FROM '5042002' OR p_payment->>'checkedAt' IS NULL OR (p_payment->>'checkedAt')::timestamptz<t-interval '10 seconds' OR (p_payment->>'checkedAt')::timestamptz>t THEN RETURN jsonb_build_object('reason','canonical_payment_required'); END IF;
 INSERT INTO public.refunds(order_id,chain_order_id,payer,amount_atomic,state,fenced_at) VALUES(p_order,'0x'||replace(p_order::text,'-','')||repeat('0',32),o.payer_wallet,'1000000','registration_pending',t) RETURNING * INTO r;
 UPDATE public.orders SET disposition='refund_fenced',status='refund_pending' WHERE id=p_order;
 RETURN to_jsonb(r);
END; $function$
;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_refund_output_check(p_order uuid,p_attempts jsonb,p_outcome text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE o public.orders; t timestamptz; outcome text=p_outcome;
BEGIN
 SELECT * INTO o FROM public.orders WHERE id=p_order FOR UPDATE;
 PERFORM 1 FROM public.execution_attempts WHERE order_id=p_order ORDER BY generation FOR UPDATE;
 IF NOT FOUND OR p_outcome IS NULL OR p_outcome NOT IN ('absent','delivery','unknown') THEN RAISE EXCEPTION 'invalid_output_check'; END IF;
 IF p_attempts IS DISTINCT FROM (SELECT jsonb_agg(id::text ORDER BY generation) FROM public.execution_attempts WHERE order_id=p_order) OR EXISTS(SELECT FROM public.execution_attempts WHERE order_id=p_order AND (stopped_at IS NULL OR publisher_finished_at IS NULL OR publication_fenced_at IS NULL)) THEN outcome='unknown'; END IF;
 IF outcome='absent' AND NOT public.mend_postexpiry_valid(p_order) AND EXISTS(SELECT FROM public.execution_attempts WHERE order_id=p_order AND (final_output_check IS DISTINCT FROM 'absent' OR output_publication IS NOT NULL)) THEN outcome='unknown'; END IF;
 IF o.delivered_at IS NOT NULL THEN outcome='delivery'; END IF;
 t=clock_timestamp();
 INSERT INTO public.refund_checks(order_id,checked_at,attempt_ids,outcome) VALUES(p_order,t,p_attempts,outcome) ON CONFLICT(order_id) DO UPDATE SET checked_at=t,attempt_ids=p_attempts,outcome=EXCLUDED.outcome;
 RETURN jsonb_build_object('outcome',outcome,'checkedAt',t);
END; $$;
--> statement-breakpoint
CREATE FUNCTION public.mend_content_publication_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE r content_retention;
BEGIN
 IF TG_TABLE_NAME='orders' THEN
 IF NEW.result IS NOT NULL THEN
  SELECT * INTO r FROM content_retention WHERE kind='output' AND object_key=NEW.result->>'key' FOR UPDATE;
  IF NOT FOUND OR r.created_at IS NULL OR r.tombstoned_at IS NOT NULL OR r.expires_at<=clock_timestamp() OR (NEW.result->>'createdAt')::timestamptz IS DISTINCT FROM r.created_at OR (NEW.result->>'expiresAt')::timestamptz IS DISTINCT FROM r.expires_at THEN RAISE EXCEPTION 'content_expired_or_unverified'; END IF;
 END IF;
 ELSIF TG_TABLE_NAME='execution_attempts' THEN
 IF NEW.output_publication IS NOT NULL THEN
  SELECT * INTO r FROM content_retention WHERE kind='output' AND object_key=NEW.output_publication->>'key' FOR UPDATE;
  IF FOUND AND (r.tombstoned_at IS NOT NULL OR r.expires_at<=clock_timestamp()) THEN RAISE EXCEPTION 'content_expired'; END IF;
 END IF;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER content_result_guard BEFORE UPDATE OF result ON orders FOR EACH ROW WHEN(NEW.result IS DISTINCT FROM OLD.result) EXECUTE FUNCTION mend_content_publication_guard();
CREATE TRIGGER content_prepare_guard BEFORE UPDATE OF output_publication ON execution_attempts FOR EACH ROW WHEN(NEW.output_publication IS DISTINCT FROM OLD.output_publication) EXECUTE FUNCTION mend_content_publication_guard();
REVOKE ALL ON FUNCTION public.mend_content_publication_guard() FROM PUBLIC;

--> statement-breakpoint
CREATE FUNCTION public.mend_content_write(p_attempt uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a execution_attempts;
BEGIN
 SELECT * INTO a FROM execution_attempts WHERE id=p_attempt FOR UPDATE;
 IF a.output_publication IS NULL OR a.publication_fenced_at IS NOT NULL OR a.publisher_finished_at IS NOT NULL THEN RETURN false; END IF;
 INSERT INTO content_retention(kind,object_key,expires_at) VALUES('output',a.output_publication->>'key',(a.output_publication->>'preparedAt')::timestamptz+interval '7 days') ON CONFLICT DO NOTHING;
 RETURN EXISTS(SELECT FROM content_retention WHERE kind='output' AND object_key=a.output_publication->>'key' AND tombstoned_at IS NULL AND expires_at>clock_timestamp());
END; $$;
REVOKE ALL ON FUNCTION public.mend_content_write(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_content_write(uuid) TO mend_conversion;
--> statement-breakpoint
-- Finalize binds the original staging creation clock, never the accepted-copy mtime.
CREATE FUNCTION public.mend_upload_retention() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.upload_key IS DISTINCT FROM 'accepted/'||NEW.submission_id||'.pdf' THEN RETURN NEW; END IF;
 IF NOT EXISTS(SELECT FROM submissions WHERE id=NEW.submission_id AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'submission_expired'; END IF;
 INSERT INTO content_retention(kind,object_key,created_at,expires_at) VALUES('upload',NEW.upload_key,NEW.upload_created_at,NEW.upload_expires_at)
 ON CONFLICT(kind,object_key) DO UPDATE SET created_at=EXCLUDED.created_at,expires_at=EXCLUDED.expires_at WHERE content_retention.created_at IS NULL AND content_retention.tombstoned_at IS NULL;
 IF EXISTS(SELECT FROM content_retention WHERE kind='upload' AND object_key=NEW.upload_key AND (tombstoned_at IS NOT NULL OR expires_at<=clock_timestamp() OR created_at IS DISTINCT FROM NEW.upload_created_at OR expires_at IS DISTINCT FROM NEW.upload_expires_at)) THEN RAISE EXCEPTION 'content_expired'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER upload_retention AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION mend_upload_retention();
REVOKE ALL ON FUNCTION public.mend_upload_retention() FROM PUBLIC;
--> statement-breakpoint
CREATE FUNCTION public.mend_retention_status() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
 SELECT jsonb_build_object('pending',count(*) FILTER(WHERE expires_at<=CURRENT_TIMESTAMP AND deleted_at IS NULL),'failed',count(*) FILTER(WHERE failure IS NOT NULL),'lastCheckedAt',max(checked_at)) FROM content_retention
$$;
REVOKE ALL ON FUNCTION public.mend_retention_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mend_retention_status() TO mend_web;
