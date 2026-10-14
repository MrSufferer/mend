CREATE OR REPLACE FUNCTION public.mend_guard_execution() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
 IF NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.generation IS DISTINCT FROM OLD.generation OR NEW.deadline IS DISTINCT FROM OLD.deadline OR NEW.invocation_id IS DISTINCT FROM OLD.invocation_id THEN RAISE EXCEPTION 'execution_identity_immutable'; END IF;
 IF OLD.publisher_finished_at IS NOT NULL AND
 (NEW.publisher_finished_at IS DISTINCT FROM OLD.publisher_finished_at OR NEW.publication_fenced_at IS DISTINCT FROM OLD.publication_fenced_at OR NEW.final_output_check IS DISTINCT FROM OLD.final_output_check OR NEW.output_publication IS DISTINCT FROM OLD.output_publication) THEN RAISE EXCEPTION 'terminal_execution_immutable'; END IF;
 IF OLD.stop_requested_at IS NOT NULL AND NEW.stop_requested_at IS DISTINCT FROM OLD.stop_requested_at THEN RAISE EXCEPTION 'stop_request_immutable'; END IF;
 IF OLD.stopped_at IS NOT NULL AND (NEW.stopped_at IS DISTINCT FROM OLD.stopped_at OR NEW.parser_exit_code IS DISTINCT FROM OLD.parser_exit_code OR NEW.stop_reason IS DISTINCT FROM OLD.stop_reason) THEN RAISE EXCEPTION 'parser_exit_immutable'; END IF;
 IF NEW.publisher_finished_at IS NOT NULL AND (NEW.publication_fenced_at IS NULL OR NEW.stopped_at IS NULL OR NEW.final_output_check IS NULL OR NEW.final_output_check NOT IN ('valid','absent','unknown')) THEN RAISE EXCEPTION 'terminal_requires_exit_and_fence'; END IF;
 RETURN NEW;
END; $$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_guard_delivery() RETURNS trigger LANGUAGE plpgsql SET search_path=public,pg_temp AS $$
BEGIN
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
CREATE OR REPLACE FUNCTION public.mend_prepare_output(p_attempt uuid,p_publication jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.execution_attempts; d text;
BEGIN
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT disposition INTO d FROM public.orders WHERE id=a.order_id FOR UPDATE;
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt FOR UPDATE;
 IF d<>'unresolved' OR a.publisher_finished_at IS NOT NULL OR a.stop_requested_at IS NOT NULL THEN RETURN false; END IF;
 UPDATE public.execution_attempts SET output_publication=p_publication WHERE id=p_attempt;
 RETURN true;
END; $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.mend_finish_execution(p_attempt uuid,p_check text,p_result jsonb DEFAULT NULL) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE a public.execution_attempts; d text;
BEGIN
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt;
 IF NOT FOUND THEN RETURN false; END IF;
 SELECT disposition INTO d FROM public.orders WHERE id=a.order_id FOR UPDATE;
 SELECT * INTO a FROM public.execution_attempts WHERE id=p_attempt FOR UPDATE;
 IF a.publisher_finished_at IS NOT NULL THEN RETURN a.final_output_check='valid'; END IF;
 IF a.stopped_at IS NULL OR p_check IS NULL OR p_check NOT IN ('valid','absent','unknown') THEN RAISE EXCEPTION 'exit_and_output_check_required'; END IF;
 IF p_check='valid' AND (p_result IS NULL OR a.output_publication IS NULL OR p_result->>'key' IS DISTINCT FROM a.output_publication->>'key' OR p_result->>'sha256' IS DISTINCT FROM a.output_publication->>'sha256') THEN RAISE EXCEPTION 'manifest_required'; END IF;
 IF p_check='absent' AND a.output_publication IS NOT NULL THEN RAISE EXCEPTION 'prepared_output_not_absence'; END IF;
 IF p_check='valid' AND d='unresolved' THEN
  UPDATE public.orders SET result=p_result,delivered_at=now(),status='delivered' WHERE id=a.order_id;
 END IF;
 UPDATE public.execution_attempts SET publisher_finished_at=now(),publication_fenced_at=now(),final_output_check=p_check,
 state=CASE WHEN p_check='valid' AND d='unresolved' THEN 'completed' ELSE 'stopped' END,
 output_publication=CASE WHEN p_check='valid' THEN output_publication||'{"state":"committed"}'::jsonb ELSE output_publication END WHERE id=p_attempt;
 RETURN p_check='valid' AND d='unresolved';
END; $$;

--> statement-breakpoint
-- Retired conversion isolates lose their direct delivery/publication authority.
REVOKE UPDATE (result,delivered_at) ON public.orders FROM mend_conversion;
REVOKE UPDATE ON public.execution_attempts FROM mend_conversion;
GRANT UPDATE (stopped_at,stop_reason,parser_exit_code,diagnostic_code) ON public.execution_attempts TO mend_conversion;
