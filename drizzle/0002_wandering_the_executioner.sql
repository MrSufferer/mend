CREATE TABLE "auth_challenges" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"message" text NOT NULL,
	"binding_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "auth_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"wallet" text NOT NULL,
	"chain_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
GRANT SELECT, INSERT ON public.auth_challenges, public.auth_sessions TO mend_web;
--> statement-breakpoint
GRANT UPDATE (consumed_at) ON public.auth_challenges TO mend_web;
--> statement-breakpoint
GRANT UPDATE (revoked_at) ON public.auth_sessions TO mend_web;
