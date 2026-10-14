import {sql} from 'drizzle-orm';
import { pgTable, text, integer, timestamp, jsonb, uuid, uniqueIndex, check } from 'drizzle-orm/pg-core';
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
 deadline:timestamp('deadline',{withTimezone:true}).notNull(),finishedAt:timestamp('finished_at',{withTimezone:true}),outcome:text('outcome'),
});
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
