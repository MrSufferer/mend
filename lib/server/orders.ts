import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { database } from './db';
import { orders, recoveryCases, agentActions, agentInvocations, type Order } from './schema';
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
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw notFound();
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
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw notFound();
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
export async function operatorOrders(filter='unresolved') {
  await requireOperator();
  if(!['unresolved','processing','unpaid','completed'].includes(filter)) throw new ApiError(400,'invalid_filter','Choose unresolved, processing, unpaid, or completed orders.');
  const scope=filter==='unpaid'?sql`${orders.paidAt} IS NULL`:filter==='completed'?sql`${orders.status} IN ('delivered','refunded')`:filter==='processing'?sql`${orders.paidAt} IS NOT NULL AND ${orders.status}='processing'`:sql`${orders.status} NOT IN ('unpaid','delivered','refunded')`;
  const rows=await database().select({order:orders,case:recoveryCases}).from(orders).leftJoin(recoveryCases,eq(recoveryCases.orderId,orders.id)).where(scope)
    .orderBy(sql`CASE WHEN ${recoveryCases.escalation} IS NOT NULL THEN 0 ELSE 1 END`,sql`CASE WHEN ${orders.deliveredAt} IS NULL AND ${orders.paidAt} + (${orders.terms}->>'deliverySeconds')::int * interval '1 second' <= now() THEN 0 ELSE 1 END`,sql`${orders.paidAt} + (${orders.terms}->>'deliverySeconds')::int * interval '1 second' ASC NULLS LAST`,orders.createdAt).limit(100);
  return {filter,orders:rows.map(({order,case:record})=>({...presentOrder(order),authorizedWallet:order.ownerWallet,agent:{callsUsed:record?.callsUsed??0,callLimit:12,escalation:record?.escalation??null,observeAt:record?.observeAt?.toISOString()??null}}))};
}
async function operatorOrder(id:string) {
  await requireOperator();
  if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) throw notFound();
  const [order]=await database().select().from(orders).where(eq(orders.id,id));
  if(!order) throw notFound();
  return order;
}
export async function operatorRecovery(id:string) {
  const order=await operatorOrder(id);
  const [record]=await database().select().from(recoveryCases).where(eq(recoveryCases.orderId,id));
  const [actions,invocations]=await Promise.all([
    database().select().from(agentActions).where(eq(agentActions.orderId,id)).orderBy(desc(agentActions.createdAt)).limit(100),
    database().select().from(agentInvocations).where(eq(agentInvocations.orderId,id)).orderBy(desc(agentInvocations.startedAt)).limit(50),
  ]);
  return {case:record??{orderId:id,callsUsed:0,escalation:null,observeAt:null},actions,invocations,evidence:{payment:presentOrder(order).payment,delivery:presentOrder(order).delivery,execution:order.recoveryObservation,disposition:order.disposition}};
}
export async function investigateOrder(request:Request,id:string) {
  await operatorOrder(id);
  sameOrigin(request);
  const url=process.env.RECOVERY_AGENT_URL,secret=process.env.RECOVERY_AGENT_SECRET;
  if(!url||!secret) throw new ApiError(503,'agent_unavailable','Agent investigation is unavailable. Existing obligations and deterministic recovery remain active.');
  let response:Response;
  try {response=await fetch(`${url.replace(/\/$/,'')}/investigate`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({orderId:id}),signal:AbortSignal.timeout(60_000),cache:'no-store',redirect:'error'});}
  catch {throw new ApiError(503,'agent_unavailable','Investigation could not finish here. Refresh its durable history before trying again.');}
  if(!response.ok) throw new ApiError(503,'agent_unavailable','Investigation could not finish. Refresh its durable history; existing obligations remain active.');
  // Return only the authoritative projection, never provider responses or service credentials.
  return operatorRecovery(id);
}
