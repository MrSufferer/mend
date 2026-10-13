CREATE TABLE "payment_attempts" (
	"order_id" uuid PRIMARY KEY NOT NULL,
	"payer" text NOT NULL,
	"nonce" text NOT NULL,
	"payload" jsonb NOT NULL,
	"requirements" jsonb NOT NULL,
	"start_block" text NOT NULL,
	"scan_block" text NOT NULL,
	"transaction" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"submitted_at" timestamp with time zone,
	CONSTRAINT "payment_attempts_transaction_unique" UNIQUE("transaction")
);
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "paid_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_transaction" text;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payer_wallet" text;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_authorization_unique" ON "payment_attempts" USING btree ("payer","nonce");--> statement-breakpoint
ALTER TABLE "orders" ADD CONSTRAINT "orders_payment_transaction_unique" UNIQUE("payment_transaction");--> statement-breakpoint
REVOKE ALL ON public.payment_attempts FROM PUBLIC, mend_conversion, mend_registrar, mend_worker;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON public.payment_attempts TO mend_web;
--> statement-breakpoint
GRANT UPDATE (status, paid_at, payment_transaction, payer_wallet) ON public.orders TO mend_web;
