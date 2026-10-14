import {HTTPFacilitatorClient} from '@x402/core/server';
import type {PaymentPayload,PaymentRequirements} from '@x402/core/types';
import {and,eq,isNull,sql} from 'drizzle-orm';
import {createPublicClient,http} from 'viem';
import {confirmReceipt} from './payment-receipts';
import {database} from './db';
import {orders,paymentAttempts,type PaymentAttempt} from './schema';
import {presentOrder} from './orders';
import {ApiError,capabilityHash,json} from './http';
import {startConversion} from './conversion';
export const arcUsdc='0x3600000000000000000000000000000000000000';
function rpcClient() {if(!process.env.ARC_RPC_URL)throw new Error('Server RPC required');return createPublicClient({transport:http(process.env.ARC_RPC_URL,{timeout:10000})});}
export function paymentRequirements():PaymentRequirements {
 if(!/^0x[0-9a-fA-F]{40}$/.test(process.env.MERCHANT_ADDRESS||'')) throw new Error('MERCHANT_ADDRESS required');
 return {scheme:'exact',network:'eip155:5042002',asset:arcUsdc,amount:'1000000',payTo:process.env.MERCHANT_ADDRESS!,maxTimeoutSeconds:300,extra:{name:'USDC',version:'2'}};
}
export async function purchase(request:Request,id:string) {
 if(!/^[0-9a-f-]{36}$/.test(id))throw new ApiError(404,'order_not_found','Order not found.');
 const [order]=await database().select().from(orders).where(and(eq(orders.id,id),eq(orders.capabilityHash,capabilityHash(request))));
 if(!order)throw new ApiError(404,'order_not_found','Order not found.');
 let [attempt]=await database().select().from(paymentAttempts).where(eq(paymentAttempts.orderId,id));
 const signature=request.headers.get('PAYMENT-SIGNATURE');
 if(!attempt&&!signature) {
  if(order.uploadExpiresAt.getTime()<=Date.now())throw new ApiError(409,'upload_expired','The document expired before payment. Submit it again.');
  const required={x402Version:2,resource:{url:new URL(request.url).href,description:'Mend document order: 1 test USDC',mimeType:'application/json'},accepts:[paymentRequirements()]};
  const response=json(required,402);response.headers.set('PAYMENT-REQUIRED',Buffer.from(JSON.stringify(required)).toString('base64'));return response;
 }
 if(signature) {
  if(signature.length>16000)throw new ApiError(400,'invalid_payment','Payment header too large.');
  let payload:PaymentPayload;try {payload=JSON.parse(Buffer.from(signature,'base64').toString());if(!payload||typeof payload!=='object'||!payload.payload||typeof payload.payload!=='object')throw new Error('Malformed');}catch {throw new ApiError(400,'invalid_payment','Malformed payment.');}
  const a=payload.payload?.authorization as {from:string,to:string,value:string,nonce:string,validAfter:string,validBefore:string}|undefined;
  if(!a||!/^0x[0-9a-fA-F]{40}$/.test(a.from)||!/^0x[0-9a-fA-F]{64}$/.test(a.nonce))throw new ApiError(400,'invalid_payment','Use an EOA exact ERC-3009 payment.');
  const payer=a.from.toLowerCase(),nonce=a.nonce.toLowerCase();
  const [used]=await database().select().from(paymentAttempts).where(and(eq(paymentAttempts.payer,payer),eq(paymentAttempts.nonce,nonce)));
  if(used&&used.orderId!==id)throw new ApiError(409,'payment_reused','This authorization belongs to another order.');
  if(attempt&&(attempt.payer!==payer||attempt.nonce!==nonce))throw new ApiError(409,'payment_already_pending','Reconcile the original authorization; do not sign another payment.');
  if(!attempt) {
   const requirements=paymentRequirements();
   if(order.ownerWallet&&order.ownerWallet!==payer)throw new ApiError(403,'payer_mismatch','Pay with the wallet that owns this order.');
   if(order.uploadExpiresAt.getTime()<=Date.now())throw new ApiError(409,'upload_expired','The document expired before payment.');
   if(payload.x402Version!==2||payload.accepted?.scheme!=='exact'||payload.accepted?.network!==requirements.network||payload.accepted?.asset?.toLowerCase()!==arcUsdc||payload.accepted?.amount!=='1000000'||payload.accepted?.payTo?.toLowerCase()!==requirements.payTo.toLowerCase()||a.to?.toLowerCase()!==requirements.payTo.toLowerCase()||a.value!=='1000000')throw new ApiError(400,'invalid_payment','Payment must be exactly 1 test USDC to the configured merchant on Arc testnet.');
   const verified=await new HTTPFacilitatorClient({url:process.env.X402_FACILITATOR_URL,timeoutMs:10000}).verify(payload,requirements);
   if(!verified.isValid||verified.payer?.toLowerCase()!==payer)throw new ApiError(402,'payment_invalid','Facilitator rejected the authorization.');
   const rpc=rpcClient();if(await rpc.getChainId()!==5042002)throw new Error('Wrong network');const block=(await rpc.getBlockNumber()).toString();
   await database().insert(paymentAttempts).values({orderId:id,payer,nonce,payload,requirements,startBlock:block,scanBlock:block}).onConflictDoNothing();
   [attempt]=await database().select().from(paymentAttempts).where(eq(paymentAttempts.orderId,id));
   if(!attempt||attempt.payer!==payer||attempt.nonce!==nonce)throw new ApiError(409,'payment_conflict','Reconcile the original payment.');
  }
 }
 if(!attempt)throw new Error('Missing attempt');
 await database().update(orders).set({status:'payment_pending'}).where(and(eq(orders.id,id),isNull(orders.paidAt)));
 // Persist one signed authorization before any settlement call. All retries reuse its nonce.
 if(order.paidAt&&!order.paymentReceipt)await confirmReceipt(attempt);
 if(!order.paidAt) {
  await confirmReceipt(attempt);
  const [current]=await database().select().from(orders).where(eq(orders.id,id));
  if(!current.paidAt) {
   const [claimed]=await database().update(paymentAttempts).set({submittedAt:new Date()}).where(and(eq(paymentAttempts.orderId,id),sql`(${paymentAttempts.submittedAt} IS NULL OR ${paymentAttempts.submittedAt}<now()-interval '30 seconds')`)).returning();
   if(claimed) {
    try {const settled=await new HTTPFacilitatorClient({url:process.env.X402_FACILITATOR_URL,timeoutMs:10000}).settle(attempt.payload,attempt.requirements);
     if(/^0x[0-9a-fA-F]{64}$/.test(settled.transaction))await database().update(paymentAttempts).set({transaction:settled.transaction.toLowerCase()}).where(eq(paymentAttempts.orderId,id));
    }catch {/* Outcome unknown: reconcile original nonce; never create a new payment. */}
    [attempt]=await database().select().from(paymentAttempts).where(eq(paymentAttempts.orderId,id));await confirmReceipt(attempt);
   }
  }
 }
 let [updated]=await database().select().from(orders).where(eq(orders.id,id));
 if(updated.paidAt&&!updated.executionStartedAt&&!updated.deliveredAt) {await startConversion(id);[updated]=await database().select().from(orders).where(eq(orders.id,id));}
 const response=json(presentOrder(updated),updated.paidAt?200:202);
 if(updated.paidAt)response.headers.set('PAYMENT-RESPONSE',Buffer.from(JSON.stringify({success:true,transaction:updated.paymentTransaction,network:'eip155:5042002',payer:updated.payerWallet})).toString('base64'));
 return response;
}
