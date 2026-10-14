ALTER TABLE "payment_attempts" ADD COLUMN "reconciled_at" timestamp with time zone;--> statement-breakpoint
GRANT UPDATE (reconciled_at) ON public.payment_attempts TO mend_payment_reconciler;
