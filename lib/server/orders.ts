import {customerRefundCapacity} from './capacity';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import { and, desc, eq, isNull, inArray, or, sql } from 'drizzle-orm';
import { database } from './db';
import { orders, recoveryCases, agentActions, agentInvocations, executionAttempts, operatorRequests, refunds, type Order } from './schema';
import { ApiError, capabilityHash } from './http';
import { requireSession, requireOperator, sameOrigin,operatorAuthority } from './auth';
import {presentExecution,type ExecutionHistory} from './execution-history';
async function withExecutionHistory(records:Order[]) {
  if(!records.length)return [];
  const ids=records.map(o=>o.id);
  const [attempts,refundRecords,requests,capacity]=await Promise.all([database().select().from(executionAttempts).where(inArray(executionAttempts.orderId,ids)),database().select().from(refunds).where(inArray(refunds.orderId,ids)),database().select({orderId:operatorRequests.orderId}).from(operatorRequests).where(and(inArray(operatorRequests.orderId,ids),eq(operatorRequests.action,'refund'),isNull(operatorRequests.finishedAt),sql`${operatorRequests.deadline}>clock_timestamp()`)),customerRefundCapacity()]);
  return records.map(order=>({...order,refundCapacity:capacity,executionHistory:presentExecution(attempts.filter(a=>a.orderId===order.id)),refundRecord:refundRecords.find(r=>r.orderId===order.id),refundRequested:requests.some(r=>r.orderId===order.id)}));
}
export function presentOrder(order:Order & {executionHistory?:ExecutionHistory;refundRecord?:typeof refunds.$inferSelect;refundRequested?:boolean;refundCapacity?:{status:unknown;allowanceResetAt:string|null}}) {
  const deadline=order.paidAt?new Date(order.paidAt.getTime()+order.terms.deliverySeconds*1000):null;
  const overdue=!order.deliveredAt&&!!deadline&&deadline.getTime()<=Date.now();
  const attempts=order.executionHistory??[],latest=attempts.at(-1),retryStarted=latest?.generation===1&&!latest.executionStoppedAt;
  const refund=order.refundRecord;
  const refundStatus=refund?.refundedAt?'refunded':refund?.state==='receipt_unknown'?'receipt_unknown':refund?.state==='submitted'?'submitted':refund&&!refund.registeredAt?'registration_pending':refund?.blocker==='reserve_unfunded'?'waiting_for_reserve':refund?.blocker==='allowance_exhausted'?'waiting_for_allowance':refund?.registeredAt?'registered':order.refundRequested?'requested':'unresolved';
  const revertedRefund=refund?.state==='registered'&&!!refund.receipt&&typeof refund.receipt==='object'&&'status' in refund.receipt&&refund.receipt.status==='reverted';
  const refundMessage={refunded:'Full purchase-price refund confirmed',waiting_for_reserve:'Registered refund · reserve funding required',waiting_for_allowance:'Registered refund · daily allowance exhausted',receipt_unknown:'Refund transaction recorded · receipt unresolved',submitted:'Refund submitted · receipt pending',registered:'Refund entitlement registered · transfer pending',registration_pending:'Failure verified · refund registration pending',requested:'Refund eligibility check requested',unresolved:'Refund eligibility unresolved'}[refundStatus];
  const available=!!order.result&&new Date(order.result.expiresAt).getTime()>Date.now();
  return {id:order.id,status:order.status,createdAt:order.createdAt.toISOString(),terms:order.terms,
    outcome:refund?refundMessage:order.deliveredAt?(available?'Result available':'Delivered result expired'):overdue?'Delivery overdue · unresolved':retryStarted?'Retry started · execution unconfirmed':order.status==='processing_failed'?'Conversion needs recovery':order.executionStartedAt?'Processing document':deadline&&deadline.getTime()<=Date.now()?'Delivery overdue':order.paidAt?'Payment confirmed':'Payment pending',
    nextStep:refund?(refund.refundedAt?'The original payer received the full purchase price. Network gas is excluded.':(['submitted','receipt_unknown'].includes(refundStatus)?'A successful matching receipt is still required. ':refundStatus==='registration_pending'?'Independent entitlement registration is pending. ':refund.blocker==='reserve_unfunded'?'The refund reserve has limited aggregate funding. Individually affordable authorized refunds continue. ':refund.blocker==='allowance_exhausted'?'The observed contract daily allowance is limited. Checks continue after its UTC reset. ':'Deterministic refund reconciliation continues without additional model calls. ')+(refund.blocker?'Aggregate capacity is limited; this does not promise a completion time. ':'')+'The paid obligation remains outstanding; no additional payment is required.'):order.deliveredAt?(available?'Download your verified text result before its exact expiry.':'The delivered file retention period ended. The delivery record remains available.'):overdue?'The original delivery deadline has passed. Recovery checks may be delayed by cold starts, outages or free-tier limits. Your paid obligation remains unresolved; no additional payment is required.':retryStarted?'The single purchased retry started. Its whole execution and output remain unconfirmed. The original payment deadline stays fixed; no additional payment is required.':order.status==='processing_failed'?'Conversion did not produce a verified result. The paid obligation remains unresolved for recovery.':order.executionStartedAt?'Processing is recorded. Refresh this order; do not submit another payment.':order.paidAt?'Payment confirmed. Processing is pending.':order.status==='payment_pending'?'Payment outcome is pending. Reconcile the original authorization; no additional payment is required.':'Submit payment through the API. Processing starts after confirmed payment.',
    refund:{status:refundStatus,payer:refund?.payer??order.payerWallet,amount:'1',currency:'test USDC',registeredAt:refund?.registeredAt?.toISOString()??null,confirmedAt:refund?.refundedAt?.toISOString()??null,transaction:refund?.refundHash??null,transactionUrl:refund?.refundHash?`https://explorer.testnet.arc.io/tx/${refund.refundHash}`:null,receipt:refund?.refundedAt?refund.receipt:null,allowanceResetAt:refund?.blocker==='allowance_exhausted'?order.refundCapacity?.allowanceResetAt??null:null},
    recovery:{attempts,execution:order.recoveryObservation?.execution??'unknown',stopRequested:order.recoveryObservation?.stopRequested??false,checkedAt:order.recoveryObservation?.checkedAt??null,outcome:order.recoveryObservation?.outcome??null,hostingDelay:'Background recovery normally checks every 15 minutes. Cold starts, outages and free-tier limits can delay investigation further. The original payment deadline stays fixed.'},
    delivery:{establishedAt:order.deliveredAt?.toISOString()??null,late:!!order.deliveredAt&&!!deadline&&order.deliveredAt>deadline,deadline:deadline?.toISOString()??null,overdue:!order.deliveredAt&&!!deadline&&deadline.getTime()<=Date.now()},
    result:order.result?{available,size:order.result.size,createdAt:order.result.createdAt,expiresAt:order.result.expiresAt,verifiedAt:order.result.verifiedAt,lastDownloadAt:order.lastDownloadAt?.toISOString()??null}:null,
    payment:{status:order.paidAt?'confirmed':order.status==='payment_pending'?'pending':'unpaid',confirmed:!!order.paidAt,processingStarted:!!order.executionStartedAt,receipt:order.paymentReceipt,payer:order.payerWallet,amount:'1',currency:'test USDC',network:'Arc testnet',transaction:order.paymentTransaction,transactionUrl:order.paymentTransaction?`https://explorer.testnet.arc.io/tx/${order.paymentTransaction}`:null,confirmedAt:order.paidAt?.toISOString()??null,deliveryDeadline:deadline?.toISOString()??null},
    timeline:[{at:order.createdAt.toISOString(),message:'Document accepted. Payment is pending.'},...(order.paidAt?[{at:order.paidAt.toISOString(),message:'Receipt confirmed: 1 test USDC paid directly to the merchant.'}]:[]),...(attempts.length?attempts.flatMap(a=>[{at:a.startedAt,message:a.generation===1?'The single purchased retry started. The original delivery deadline remains fixed.':'Original PDF conversion started.'},...(a.executionStoppedAt?[{at:a.executionStoppedAt,message:`${a.generation===1?'Retry':'Original conversion'} parent execution stopped. Final output check: ${a.finalOutputCheck}.`}]:[])]):order.executionStartedAt?[{at:order.executionStartedAt.toISOString(),message:'PDF conversion started.'}]:[]),...(order.recoveryObservation?[{at:order.recoveryObservation.checkedAt,message:order.recoveryObservation.execution==='stopped'?'Recovery confirmed that execution stopped. The result check remains separate.':'Recovery checked the order. Execution remains uncertain.'}]:[]),...(order.deliveredAt?[{at:order.deliveredAt.toISOString(),message:'Verified text result made available through authenticated access.'}]:[]),...(refund?[{at:refund.fencedAt.toISOString(),message:'Canonical payment, stopped execution and fresh output absence established refund eligibility.'},...(refund.registeredAt?[{at:refund.registeredAt.toISOString(),message:'Canonical contract receipt confirmed the original-payer refund entitlement.'}]:[]),...(refund.refundedAt?[{at:refund.refundedAt.toISOString(),message:'Canonical refund receipt and token transfer confirmed the full purchase price returned to the original payer. Gas is excluded.'}]:refund.refundHash?[{at:refund.updatedAt.toISOString(),message:revertedRefund?'Canonical refund transaction reverted. The registered entitlement remains pending for retry.':'Refund transaction recorded. A successful matching receipt is still required.'}]:[])]:[]),...(order.lastDownloadAt?[{at:order.lastDownloadAt.toISOString(),message:'Authenticated result download served. Downloads do not extend expiry.'}]:[])].toSorted((a,b)=>Date.parse(a.at)-Date.parse(b.at)),
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
  return (await withExecutionHistory([order]))[0];
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
  return {orders:(await withExecutionHistory(owned)).map(presentOrder)};
}
export async function operatorOrders(filter='unresolved') {
  await requireOperator();
  if(!['unresolved','processing','unpaid','completed'].includes(filter)) throw new ApiError(400,'invalid_filter','Choose unresolved, processing, unpaid, or completed orders.');
  const scope=filter==='unpaid'?sql`${orders.paidAt} IS NULL`:filter==='completed'?sql`${orders.status} IN ('delivered','refunded')`:filter==='processing'?sql`${orders.paidAt} IS NOT NULL AND ${orders.status}='processing'`:sql`${orders.status} NOT IN ('unpaid','delivered','refunded')`;
  const rows=await database().select({order:orders,case:recoveryCases}).from(orders).leftJoin(recoveryCases,eq(recoveryCases.orderId,orders.id)).where(scope)
    .orderBy(sql`CASE WHEN ${recoveryCases.escalation} IS NOT NULL THEN 0 ELSE 1 END`,sql`CASE WHEN ${orders.deliveredAt} IS NULL AND ${orders.paidAt} + (${orders.terms}->>'deliverySeconds')::int * interval '1 second' <= now() THEN 0 ELSE 1 END`,sql`${orders.paidAt} + (${orders.terms}->>'deliverySeconds')::int * interval '1 second' ASC NULLS LAST`,orders.createdAt).limit(100);
  const histories=await withExecutionHistory(rows.map(row=>row.order));
  return {filter,orders:rows.map(({order,case:record})=>({...presentOrder(histories.find(item=>item.id===order.id)!),authorizedWallet:order.ownerWallet,agent:{callsUsed:record?.callsUsed??0,callLimit:12,escalation:record?.escalation??null,observeAt:record?.observeAt?.toISOString()??null}}))};
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
  const requests=await database().select().from(operatorRequests).where(eq(operatorRequests.orderId,id)).orderBy(desc(operatorRequests.requestedAt)).limit(100);
  return {operatorRequests:requests.map(({sessionHash,...request})=>({...request,outcome:!request.finishedAt&&request.deadline.getTime()<=Date.now()?'uncertain':request.outcome})),case:record??{orderId:id,callsUsed:0,escalation:null,observeAt:null},actions,invocations,evidence:{payment:presentOrder(order).payment,delivery:presentOrder(order).delivery,execution:order.recoveryObservation,attempts:(await withExecutionHistory([order]))[0].executionHistory,disposition:order.disposition}};
}
export async function investigateOrder(request:Request,id:string) {
 return requestOperatorAction(request,id,'investigate');
}
export async function operatorAction(request:Request,id:string) {
 await operatorOrder(id);sameOrigin(request);
 const body=z.object({action:z.enum(['check','restore','retry','refund'])}).strict().safeParse(await request.json().catch(()=>null));
 if(!body.success)throw new ApiError(400,'invalid_action','Choose a deterministic check, verified restoration, permitted retry, or independently verified refund request.');
 return requestOperatorAction(request,id,body.data.action);
}
async function requestOperatorAction(request:Request,id:string,action:string) {
 await operatorOrder(id);sameOrigin(request);
 const actor=await operatorAuthority(),requestId=randomUUID();
 const begun=await database().execute(sql`SELECT public.mend_operator_begin(${requestId}::uuid,${id}::uuid,${actor.sessionHash},${action},${actor.wallet}) AS request`);
 const pending=begun.rows[0].request as {reason?:string};
 if(!pending.reason) {
  const model=action==='investigate',refund=action==='refund',url=model?process.env.RECOVERY_AGENT_URL:refund?process.env.OPERATOR_REGISTRAR_URL:process.env.OPERATOR_CONVERSION_URL,secret=model?process.env.RECOVERY_AGENT_SECRET:refund?process.env.OPERATOR_REGISTRAR_SECRET:process.env.OPERATOR_CONVERSION_SECRET;
  try {
   if(!url||!secret)throw Error('service_unavailable');
   const response=await fetch(`${url.replace(/\/$/,'')}/${model?'investigate':'operator'}`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(model?{orderId:id,requestId}:{requestId}),signal:AbortSignal.timeout(60_000),cache:'no-store',redirect:'error'});
   if(!response.ok)throw Error('service_unavailable');
   if(model) {const result=await response.json();if(result.error)await database().execute(sql`SELECT public.mend_operator_finish(${requestId}::uuid,'skipped',${JSON.stringify({reason:result.error})}::jsonb)`);}
  }catch {
   // A timeout is an uncertain request outcome, never proof that execution stopped.
   // Conversion may still finish; leave its request pending until durable completion/expiry.
   // Durable worker/conversion completion owns the eventual outcome.
  }
 }
 const refreshed=await operatorRecovery(id);
 return {...refreshed,operatorRequest:refreshed.operatorRequests.find(item=>item.id===requestId)};
}
