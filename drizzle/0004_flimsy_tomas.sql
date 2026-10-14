ALTER TABLE "orders" ADD COLUMN "payment_receipt" jsonb;--> statement-breakpoint
GRANT UPDATE (payment_receipt) ON public.orders TO mend_web;
