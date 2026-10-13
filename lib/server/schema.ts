import { pgTable, text, integer, timestamp, jsonb, uuid, uniqueIndex } from 'drizzle-orm/pg-core';
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
  status:text('status').notNull().default('unpaid'), terms:jsonb('terms').$type<PurchasedTerms>().notNull(),
  createdAt:timestamp('created_at',{withTimezone:true}).defaultNow().notNull(), uploadCreatedAt:timestamp('upload_created_at',{withTimezone:true}).notNull(),
  uploadExpiresAt:timestamp('upload_expires_at',{withTimezone:true}).notNull(), uploadKey:text('upload_key').notNull(),
  uploadSize:integer('upload_size').notNull(), uploadSha256:text('upload_sha256').notNull(), pages:integer('pages').notNull(),
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
