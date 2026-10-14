import {sql} from 'drizzle-orm';
import { pgTable, text, boolean, integer,index, timestamp, jsonb, uuid, uniqueIndex, check } from 'drizzle-orm/pg-core';
import type {PaymentPayload,PaymentRequirements} from '@x402/core/types';
import type { PurchasedTerms, RecoveryPolicy } from './terms';
export const policies = pgTable('recovery_policies', {
  id:uuid('id').primaryKey(), createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),
  policy:jsonb('policy').$type<RecoveryPolicy>().notNull(),
});
export const submissions = pgTable('submissions', {
  id:uuid('id').primaryKey(), capabilityHash:text('capability_hash').notNull(), idempotencyKey:text('idempotency_key').notNull(),
  size:integer('size').notNull(), sha256:text('sha256').notNull(), terms:jsonb('terms').$type<PurchasedTerms>().notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),
  expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(), rejected:text('rejected'),
}, (t)=>[uniqueIndex('submission_capability_idempotency').on(t.capabilityHash,t.idempotencyKey)]);
export const orders = pgTable('orders', {
  id:uuid('id').primaryKey(), submissionId:uuid('submission_id').references(()=>submissions.id).notNull().unique(),
  capabilityHash:text('capability_hash').notNull(), ownerWallet:text('owner_wallet'),
  recoveryObservation:jsonb('recovery_observation').$type<{checkedAt:string;outcome:string;execution?:'stopped'|'unknown';stopRequested?:boolean;attemptId?:string}>(), disposition:text('disposition').notNull().default('unresolved'), status:text('status').notNull().default('unpaid'), paidAt:timestamp('paid_at',{withTimezone:true}), paymentTransaction:text('payment_transaction').unique(), paymentReceipt:jsonb('payment_receipt').$type<{status:'success',blockNumber:string,blockHash:string,amountAtomic:string,decimals:6,gasUsed:string,effectiveGasPrice:string}>(), payerWallet:text('payer_wallet'), terms:jsonb('terms').$type<PurchasedTerms>().notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(), uploadCreatedAt:timestamp('upload_created_at',{withTimezone:true}).notNull(),
  uploadExpiresAt:timestamp('upload_expires_at',{withTimezone:true}).notNull(), uploadKey:text('upload_key').notNull(),
  uploadSize:integer('upload_size').notNull(), uploadSha256:text('upload_sha256').notNull(), pages:integer('pages').notNull(),
  executionStartedAt:timestamp('execution_started_at',{withTimezone:true}), deliveredAt:timestamp('delivered_at',{withTimezone:true}),
  result:jsonb('result').$type<{key:string,sha256:string,size:number,createdAt:string,expiresAt:string,verifiedAt:string}>(),
  lastDownloadAt:timestamp('last_download_at',{withTimezone:true}),
},t=>[uniqueIndex('orders_owner_created').on(t.ownerWallet,t.createdAt,t.id)]);
export type Order = typeof orders.$inferSelect;

export const authChallenges = pgTable('auth_challenges', {
  id:uuid('id').primaryKey(), wallet:text('wallet').notNull(), message:text('message').notNull(),
  bindingHash:text('binding_hash').notNull(), expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(),
  consumedAt:timestamp('consumed_at',{withTimezone:true}),
});
export const authSessions = pgTable('auth_sessions', {
  tokenHash:text('token_hash').primaryKey(), wallet:text('wallet').notNull(), chainId:integer('chain_id').notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),
  expiresAt:timestamp('expires_at',{withTimezone:true}).notNull(), revokedAt:timestamp('revoked_at',{withTimezone:true}),
});

export const paymentAttempts=pgTable('payment_attempts',{
 admittedAt:timestamp('admitted_at',{withTimezone:true}).defaultNow().notNull(),admissionGeneration:integer('admission_generation').notNull().default(0),
 orderId:uuid('order_id').primaryKey().references(()=>orders.id), payer:text('payer').notNull(), nonce:text('nonce').notNull(),
 payload:jsonb('payload').$type<PaymentPayload>().notNull(), requirements:jsonb('requirements').$type<PaymentRequirements>().notNull(),
 startBlock:text('start_block').notNull(), scanBlock:text('scan_block').notNull(), transaction:text('transaction').unique(),
 reconciledAt:timestamp('reconciled_at',{withTimezone:true}),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(), submittedAt:timestamp('submitted_at',{withTimezone:true}),
},t=>[uniqueIndex('payment_authorization_unique').on(t.payer,t.nonce)]);
export type PaymentAttempt=typeof paymentAttempts.$inferSelect;

export const executionAttempts=pgTable('execution_attempts',{
 id:uuid('id').primaryKey(),orderId:uuid('order_id').notNull().references(()=>orders.id),generation:integer('generation').notNull(),
 state:text('state').notNull(),startedAt:timestamp('started_at',{withTimezone:true}).defaultNow().notNull(),
 stoppedAt:timestamp('stopped_at',{withTimezone:true}),stopReason:text('stop_reason'),parserExitCode:integer('parser_exit_code'),
 diagnosticCode:text('diagnostic_code'),
 stopRequestedAt:timestamp('stop_requested_at',{withTimezone:true}), publisherFinishedAt:timestamp('publisher_finished_at',{withTimezone:true}),
 publicationFencedAt:timestamp('publication_fenced_at',{withTimezone:true}), finalOutputCheck:text('final_output_check'),
 invocationId:text('invocation_id'), deadline:timestamp('deadline',{withTimezone:true}),
 outputPublication:jsonb('output_publication').$type<{state:'prepared'|'committed';key:string;sha256:string;size:number;preparedAt:string}>(),
},t=>[uniqueIndex('execution_order_generation').on(t.orderId,t.generation),check('execution_generation_bound',sql`${t.generation} IN (0,1)`)]);
export const resultDownloads=pgTable('result_downloads',{
 id:uuid('id').primaryKey(),orderId:uuid('order_id').notNull().references(()=>orders.id),wallet:text('wallet').notNull(),
 servedAt:timestamp('served_at',{withTimezone:true}).defaultNow().notNull(),size:integer('size').notNull(),sha256:text('sha256').notNull(),
});

export const reconciliationSweeps=pgTable('reconciliation_sweeps',{
 id:text('id').primaryKey(),scheduledAt:timestamp('scheduled_at',{withTimezone:true}).notNull(),
 startedAt:timestamp('started_at',{withTimezone:true}).defaultNow().notNull(),completedAt:timestamp('completed_at',{withTimezone:true}),observedOrders:integer('observed_orders').notNull().default(0),
});

export const recoveryCases=pgTable('recovery_cases',{
 orderId:uuid('order_id').primaryKey().references(()=>orders.id),callsUsed:integer('calls_used').notNull().default(0),
 escalation:text('escalation'),observeAt:timestamp('observe_at',{withTimezone:true}),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull(),
});
export const agentInvocations=pgTable('agent_invocations',{
 id:uuid('id').primaryKey(),orderId:uuid('order_id').notNull().references(()=>orders.id),startedAt:timestamp('started_at',{withTimezone:true}).defaultNow().notNull(),
 purpose:text('purpose').notNull().default('model'),deadline:timestamp('deadline',{withTimezone:true}).notNull(),finishedAt:timestamp('finished_at',{withTimezone:true}),outcome:text('outcome'),
},t=>[check('invocation_purpose',sql`${t.purpose} IN ('model','operator')`)]);
export const agentCalls=pgTable('agent_calls',{
 id:uuid('id').primaryKey(),invocationId:uuid('invocation_id').notNull().references(()=>agentInvocations.id),orderId:uuid('order_id').notNull().references(()=>orders.id),ordinal:integer('ordinal').notNull(),
 claimedAt:timestamp('claimed_at',{withTimezone:true}).defaultNow().notNull(),
},t=>[uniqueIndex('agent_case_ordinal').on(t.orderId,t.ordinal)]);
export const agentActions=pgTable('agent_actions',{
 id:uuid('id').primaryKey(),invocationId:uuid('invocation_id').notNull().references(()=>agentInvocations.id),orderId:uuid('order_id').notNull().references(()=>orders.id),
 tool:text('tool').notNull(),outcome:text('outcome').notNull(),evidence:jsonb('evidence').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),
});

export const agentSweeps=pgTable('agent_sweeps',{
 id:text('id').primaryKey(),scheduledAt:timestamp('scheduled_at',{withTimezone:true}).notNull(),
 startedAt:timestamp('started_at',{withTimezone:true}).defaultNow().notNull(),completedAt:timestamp('completed_at',{withTimezone:true}),orderId:uuid('order_id').references(()=>orders.id),
});

export const operatorRequests=pgTable('operator_requests',{
 id:uuid('id').primaryKey(),orderId:uuid('order_id').notNull().references(()=>orders.id),
 actor:text('actor').notNull(),sessionHash:text('session_hash').notNull(),action:text('action').notNull(),
 invocationId:uuid('invocation_id').references(()=>agentInvocations.id),requestedAt:timestamp('requested_at',{withTimezone:true}).defaultNow().notNull(),
 deadline:timestamp('deadline',{withTimezone:true}).notNull(),dispatchedAt:timestamp('dispatched_at',{withTimezone:true}),finishedAt:timestamp('finished_at',{withTimezone:true}),
 outcome:text('outcome').notNull().default('requested'),requestEvidence:jsonb('request_evidence').notNull(),outcomeEvidence:jsonb('outcome_evidence'),
},t=>[check('operator_action',sql`${t.action} IN ('investigate','check','restore','retry','refund')`),index('operator_request_history').on(t.orderId,t.requestedAt.desc()),uniqueIndex('operator_request_invocation').on(t.invocationId)]);

export const refundChecks=pgTable('refund_checks',{
 orderId:uuid('order_id').primaryKey().references(()=>orders.id),checkedAt:timestamp('checked_at',{withTimezone:true}).notNull(),
 attemptIds:jsonb('attempt_ids').$type<string[]>().notNull(),outcome:text('outcome').notNull(),
},t=>[check('refund_check_outcome',sql`${t.outcome} IN ('absent','delivery','unknown')`)]);
export const refunds=pgTable('refunds',{
 orderId:uuid('order_id').primaryKey().references(()=>orders.id),chainOrderId:text('chain_order_id').notNull().unique(),
 payer:text('payer').notNull(),amountAtomic:text('amount_atomic').notNull(),state:text('state').notNull(),
 fencedAt:timestamp('fenced_at',{withTimezone:true}).notNull(),registeredAt:timestamp('registered_at',{withTimezone:true}),refundedAt:timestamp('refunded_at',{withTimezone:true}),
 registrationHash:text('registration_hash'),refundHash:text('refund_hash'),receipt:jsonb('receipt'),blocker:text('blocker'),updatedAt:timestamp('updated_at',{withTimezone:true}).defaultNow().notNull(),
},t=>[check('refund_amount',sql`${t.amountAtomic}='1000000'`),check('refund_state',sql`${t.state} IN ('registration_pending','registered','submitted','receipt_unknown','refunded')`)]);
export const refundSigners=pgTable('refund_signers',{
 kind:text('kind').primaryKey(),address:text('address').notNull().unique(),nextNonce:integer('next_nonce').notNull(),
},t=>[check('refund_signer_kind',sql`${t.kind} IN ('registrar','refund')`)]);
export const refundTransactions=pgTable('refund_transactions',{
 id:uuid('id').primaryKey(),orderId:uuid('order_id').notNull().references(()=>refunds.orderId),kind:text('kind').notNull().references(()=>refundSigners.kind),
 request:jsonb('request').notNull(),nonce:integer('nonce').notNull(),calldata:text('calldata').notNull(),rawTransaction:text('raw_transaction'),hash:text('hash').unique(),
 state:text('state').notNull().default('reserved'),receipt:jsonb('receipt'),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),
},t=>[uniqueIndex('refund_operation').on(t.orderId,t.kind).where(sql`${t.state} <> 'reverted'`),uniqueIndex('refund_signer_nonce').on(t.kind,t.nonce),check('refund_transaction_state',sql`${t.state} IN ('reserved','signed','submitted','unknown','confirmed','reverted')`)]);

export const refundSweeps=pgTable('refund_sweeps',{
 invocationId:text('invocation_id').primaryKey(),orderId:uuid('order_id').references(()=>orders.id),
 scheduledAt:timestamp('scheduled_at',{withTimezone:true}).notNull(),createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(),
});

// Restrictive service control is separate from paid-order execution and disposition.
export const serviceAvailability=pgTable('service_availability',{
 id:text('id').primaryKey().default('merchant'),paused:boolean('paused').notNull().default(false),
 generation:integer('generation').notNull().default(0),failureGeneration:integer('failure_generation').notNull().default(0),
 pausedAt:timestamp('paused_at',{withTimezone:true}),
},t=>[check('single_merchant',sql`${t.id}='merchant'`)]);
export const processingFailures=pgTable('processing_failures',{
 attemptId:uuid('attempt_id').primaryKey().references(()=>executionAttempts.id),orderId:uuid('order_id').notNull().references(()=>orders.id),
 generation:integer('generation').notNull(),diagnostic:text('diagnostic').notNull(),confirmedAt:timestamp('confirmed_at',{withTimezone:true}).notNull().defaultNow(),
},t=>[index('processing_failure_window').on(t.confirmedAt)]);
export const serviceIncidents=pgTable('service_incidents',{
 id:uuid('id').primaryKey(),actorKind:text('actor_kind').notNull(),actor:text('actor').notNull(),reason:text('reason').notNull(),
 evidence:jsonb('evidence').$type<{attemptIds:string[];orderIds:string[]}>().notNull(),
 generation:integer('generation').notNull(),failureGeneration:integer('failure_generation').notNull(),createdAt:timestamp('created_at',{withTimezone:true}).notNull().defaultNow(),
});
