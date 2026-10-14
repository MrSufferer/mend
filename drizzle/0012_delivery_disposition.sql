CREATE OR REPLACE FUNCTION public.mend_guard_delivery() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF OLD.disposition='delivery' AND NEW.disposition<>'delivery' THEN RAISE EXCEPTION 'delivery_disposition_immutable'; END IF;
 IF OLD.delivered_at IS NOT NULL AND NEW.status IS DISTINCT FROM OLD.status THEN RAISE EXCEPTION 'delivery_status_immutable'; END IF;
 IF OLD.paid_at IS NOT NULL AND (NEW.paid_at IS DISTINCT FROM OLD.paid_at OR NEW.terms IS DISTINCT FROM OLD.terms) THEN RAISE EXCEPTION 'purchased_policy_immutable'; END IF;
 IF OLD.disposition NOT IN ('unresolved','delivery') AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.disposition IS DISTINCT FROM OLD.disposition) THEN RAISE EXCEPTION 'refund_disposition_fenced'; END IF;
 IF NEW.result IS DISTINCT FROM OLD.result OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN
  IF OLD.disposition NOT IN ('unresolved','delivery') THEN RAISE EXCEPTION 'refund_disposition_fenced'; END IF;
  IF OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at THEN RAISE EXCEPTION 'delivery_immutable'; END IF;
  IF NEW.delivered_at IS NOT NULL THEN NEW.disposition='delivery'; END IF;
 END IF;
 IF OLD.disposition NOT IN ('unresolved','delivery') AND NEW.disposition='delivery' THEN RAISE EXCEPTION 'refund_disposition_fenced'; END IF;
 RETURN NEW;
END; $$;

--> statement-breakpoint

UPDATE public.orders SET disposition='delivery' WHERE delivered_at IS NOT NULL AND disposition='unresolved';
