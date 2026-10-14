DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname='mend_payment_reconciler') THEN CREATE ROLE mend_payment_reconciler LOGIN; END IF; END $$;
--> statement-breakpoint
REVOKE ALL ON public.orders,public.payment_attempts,public.auth_sessions,public.auth_challenges,public.execution_attempts,public.reconciliation_sweeps FROM mend_payment_reconciler;
GRANT USAGE ON SCHEMA public TO mend_payment_reconciler;
GRANT SELECT ON public.orders,public.payment_attempts TO mend_payment_reconciler;
GRANT UPDATE (status,paid_at,payment_transaction,payment_receipt,payer_wallet,owner_wallet) ON public.orders TO mend_payment_reconciler;
GRANT UPDATE (scan_block,transaction) ON public.payment_attempts TO mend_payment_reconciler;
GRANT SELECT (order_id) ON public.payment_attempts TO mend_conversion;
