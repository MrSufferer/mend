import { and, desc, eq, isNull, or, sql } from 'drizzle-orm';
import { database } from './db';
import { orders, type Order } from './schema';
import { ApiError, capabilityHash } from './http';
import { requireSession, requireOperator, sameOrigin } from './auth';
export function presentOrder(order:Order) {
  return {id:order.id,status:order.status,createdAt:order.createdAt.toISOString(),terms:order.terms,
    nextStep:order.paidAt?'Payment confirmed. Processing is pending.':order.status==='payment_pending'?'Payment outcome is pending. Reconcile the original authorization; no additional payment is required.':'Submit payment through the API. Processing starts after confirmed payment.',
    payment:{status:order.paidAt?'confirmed':order.status==='payment_pending'?'pending':'unpaid',confirmed:!!order.paidAt,processingStarted:false,receipt:order.paymentReceipt,payer:order.payerWallet,amount:'1',currency:'test USDC',network:'Arc testnet',transaction:order.paymentTransaction,transactionUrl:order.paymentTransaction?`https://explorer.testnet.arc.io/tx/${order.paymentTransaction}`:null,confirmedAt:order.paidAt?.toISOString()??null,deliveryDeadline:order.paidAt?new Date(order.paidAt.getTime()+order.terms.deliverySeconds*1000).toISOString():null},
    timeline:[{at:order.createdAt.toISOString(),message:'Document accepted. Payment is pending.'},...(order.paidAt?[{at:order.paidAt.toISOString(),message:'Receipt confirmed: 1 test USDC paid directly to the merchant.'}]:[])],
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
