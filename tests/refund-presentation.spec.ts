import {test,expect} from '@playwright/test';
import {presentOrder} from '../lib/server/orders';
import {purchasedTerms,defaultPolicy} from '../lib/server/terms';
import type {Order,refunds} from '../lib/server/schema';
const at=new Date('2026-10-14T00:00:00Z'),hash=`0x${'ab'.repeat(32)}`;
const order:Order={id:'owned-presentation',submissionId:'owned-submission',capabilityHash:'owned-capability',ownerWallet:'0xpayer',recoveryObservation:null,disposition:'refund_registered',status:'refund_pending',paidAt:at,paymentTransaction:null,paymentReceipt:null,payerWallet:'0xpayer',terms:purchasedTerms(defaultPolicy,'owned'),createdAt:at,uploadCreatedAt:at,uploadExpiresAt:at,uploadKey:'private-owned',uploadSize:1,uploadSha256:'private-owned',pages:1,executionStartedAt:null,deliveredAt:null,result:null,lastDownloadAt:null};
const refund:typeof refunds.$inferSelect={orderId:order.id,chainOrderId:'owned',payer:'0xpayer',amountAtomic:'1000000',state:'registered',fencedAt:at,registeredAt:at,refundedAt:null,registrationHash:null,refundHash:hash,receipt:{transaction:hash,status:'reverted'},blocker:null,updatedAt:at};
test('known reverted refund preserves historical transaction but shows registered entitlement awaiting retry',()=>{
 const view=presentOrder({...order,refundRecord:refund});
 expect(view.refund.status).toBe('registered');expect(view.refund.confirmedAt).toBeNull();expect(view.refund.receipt).toBeNull();
 expect(view.refund.transaction).toBe(hash);expect(view.outcome).toBe('Refund entitlement registered · transfer pending');
 expect(view.timeline.at(-1)?.message).toBe('Canonical refund transaction reverted. The registered entitlement remains pending for retry.');
 expect(view.timeline.map(item=>item.message).join(' ')).not.toContain('successful matching receipt is still required');
});
test('new submitted or unknown attempt remains unconfirmed after a reverted refund',()=>{
 expect(presentOrder({...order,refundRecord:{...refund,state:'submitted',receipt:null}}).refund.status).toBe('submitted');
 expect(presentOrder({...order,refundRecord:{...refund,state:'receipt_unknown',receipt:null}}).refund.status).toBe('receipt_unknown');
});
