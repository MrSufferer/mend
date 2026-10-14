import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { database } from './db';
import { orders, type Order } from './schema';
import { ApiError, capabilityHash } from './http';
import { requireSession, requireOperator, sameOrigin } from './auth';
export function presentOrder(order:Order) {
  const deadline=order.paidAt?new Date(order.paidAt.getTime()+order.terms.deliverySeconds*1000):null;
  const overdue=!order.deliveredAt&&!!deadline&&deadline.getTime()<=Date.now();
  const available=!!order.result&&new Date(order.result.expiresAt).getTime()>Date.now();
  return {id:order.id,status:order.status,createdAt:order.createdAt.toISOString(),terms:order.terms,
    outcome:order.deliveredAt?(available?'Result available':'Delivered result expired'):overdue?'Delivery overdue · unresolved':order.status==='processing_failed'?'Conversion needs recovery':order.executionStartedAt?'Processing document':deadline&&deadline.getTime()<=Date.now()?'Delivery overdue':order.paidAt?'Payment confirmed':'Payment pending',
    nextStep:order.deliveredAt?(available?'Download your verified text result before its exact expiry.':'The delivered file retention period ended. The delivery record remains available.'):overdue?'The original delivery deadline has passed. Recovery checks may be delayed by cold starts, outages or free-tier limits. Your paid obligation remains unresolved; no additional payment is required.':order.status==='processing_failed'?'Conversion did not produce a verified result. The paid obligation remains unresolved for recovery.':order.executionStartedAt?'Processing is recorded. Refresh this order; do not submit another payment.':order.paidAt?'Payment confirmed. Processing is pending.':order.status==='payment_pending'?'Payment outcome is pending. Reconcile the original authorization; no additional payment is required.':'Submit payment through the API. Processing starts after confirmed payment.',
    recovery:{execution:order.recoveryObservation?.execution??'unknown',stopRequested:order.recoveryObservation?.stopRequested??false,checkedAt:order.recoveryObservation?.checkedAt??null,outcome:order.recoveryObservation?.outcome??null,hostingDelay:'Background recovery normally checks every 15 minutes. Cold starts, outages and free-tier limits can delay investigation further. The original payment deadline stays fixed.'},
    delivery:{establishedAt:order.deliveredAt?.toISOString()??null,late:!!order.deliveredAt&&!!deadline&&order.deliveredAt>deadline,deadline:deadline?.toISOString()??null,overdue:!order.deliveredAt&&!!deadline&&deadline.getTime()<=Date.now()},
    result:order.result?{available,size:order.result.size,createdAt:order.result.createdAt,expiresAt:order.result.expiresAt,verifiedAt:order.result.verifiedAt,lastDownloadAt:order.lastDownloadAt?.toISOString()??null}:null,
    payment:{status:order.paidAt?'confirmed':order.status==='payment_pending'?'pending':'unpaid',confirmed:!!order.paidAt,processingStarted:!!order.executionStartedAt,receipt:order.paymentReceipt,payer:order.payerWallet,amount:'1',currency:'test USDC',network:'Arc testnet',transaction:order.paymentTransaction,transactionUrl:order.paymentTransaction?`https://explorer.testnet.arc.io/tx/${order.paymentTransaction}`:null,confirmedAt:order.paidAt?.toISOString()??null,deliveryDeadline:deadline?.toISOString()??null},
    timeline:[{at:order.createdAt.toISOString(),message:'Document accepted. Payment is pending.'},...(order.paidAt?[{at:order.paidAt.toISOString(),message:'Receipt confirmed: 1 test USDC paid directly to the merchant.'}]:[]),...(order.executionStartedAt?[{at:order.executionStartedAt.toISOString(),message:'PDF conversion started.'}]:[]),...(order.recoveryObservation?[{at:order.recoveryObservation.checkedAt,message:order.recoveryObservation.execution==='stopped'?'Recovery confirmed that execution stopped. The result check remains separate.':'Recovery checked the order. Execution remains uncertain.'}]:[]),...(order.deliveredAt?[{at:order.deliveredAt.toISOString(),message:'Verified text result made available through authenticated access.'}]:[]),...(order.lastDownloadAt?[{at:order.lastDownloadAt.toISOString(),message:'Authenticated result download served. Downloads do not extend expiry.'}]:[])],
    upload:{size:order.uploadSize,pages:order.pages,createdAt:order.uploadCreatedAt.toISOString(),expiresAt:order.uploadExpiresAt.toISOString(),available:order.uploadExpiresAt.getTime()>Date.now()}};
}
const notFound=()=>new ApiError(404,'order_not_found','Order not found.');
export async function authorizedOrder(request:Request,id:string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  const [order] = await database().select().from(orders).where(eq(orders.id,id));
  if(!order) throw notFound();
  if(order.ownerWallet) {
    const session=await requireSession();
    if(order.ownerWallet!==session.wallet) throw notFound();
  } else if(order.capabilityHash!==capabilityHash(request)) throw notFound();
  return order;
}
export async function claimOrder(request:Request,id:string) {
  sameOrigin(request);
  const session=await requireSession(), hash=capabilityHash(request);
  if(!/^[0-9a-f-]{36}$/.test(id)) throw notFound();
  // Conditional ownership update locks the row: concurrent wallets cannot rebind it.
  // Claim establishes draft authorization only; no payer/payment fact is created.
  const [claimed]=await database().update(orders).set({ownerWallet:session.wallet}).where(and(eq(orders.id,id),eq(orders.capabilityHash,hash),eq(orders.status,'unpaid'),or(isNull(orders.ownerWallet),eq(orders.ownerWallet,session.wallet)))).returning();
  if(!claimed) throw notFound();
  return presentOrder(claimed);
}
export async function customerOrders() {
  const session=await requireSession();
  const owned=await database().select().from(orders).where(eq(orders.ownerWallet,session.wallet)).orderBy(desc(orders.createdAt)).limit(100);
  return {orders:owned.map(presentOrder)};
}
export async function operatorOrders() {
  await requireOperator();
  // Unpaid drafts do not represent unresolved paid obligations.
  const unresolved=await database().select().from(orders).where(sql`${orders.status} NOT IN ('unpaid','delivered','refunded')`).orderBy(desc(orders.createdAt)).limit(100);
  return {orders:unresolved.map(order=>({...presentOrder(order),authorizedWallet:order.ownerWallet}))};
}
