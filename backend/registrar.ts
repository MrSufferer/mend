import './database-timeout';
import {paymentAvailable,healthRpc} from './health-payment';
import {eq,sql} from 'drizzle-orm';
import type {Hex} from 'viem';
import {database as defaultDatabase} from '../lib/server/db';
import {orders,paymentAttempts} from '../lib/server/schema';
import {verifyPayment,verifyRefundOutcome,type RefundBinding} from './refund-chain';
import {canonicalReader as defaultReader,submitRefund as defaultSubmit} from './refund-transactions';
import {observeCapacity,type CapacityReader} from './refund-capacity';
import {refundRpc} from './refund-transactions';
import {authorized,uuid} from './refund-service-auth';
type Refund=RefundBinding&{order_id:string;state:string;registered_at:string|null;refund_hash:Hex|null};
export function createRegistrarService(options:{database?:typeof defaultDatabase;reader?:typeof defaultReader;submit?:typeof defaultSubmit;capacityReader?:CapacityReader;conversionFetch?:typeof fetch}={}){
 const database=options.database??defaultDatabase,canonicalReader=options.reader??defaultReader,submitRefund=options.submit??defaultSubmit;
async function verifyOperations(orderId:string,r:Refund){
 for(const kind of ['registrar','refund'] as const){
  const result=await database().execute(sql`SELECT public.mend_refund_verify_operation(${orderId}::uuid,${kind}) AS operation`);
  const tx=result.rows[0].operation as {id:string;hash:Hex|null;state:string}|null;
  if(!tx?.hash||['confirmed','reverted'].includes(tx.state))continue;
  try{const receipt=await verifyRefundOutcome(canonicalReader(),kind,tx.hash,r);await database().execute(sql`SELECT public.mend_refund_receipt(${tx.id}::uuid,${receipt.status==='success'?'confirmed':'reverted'},${JSON.stringify(receipt)}::jsonb)`);}
  catch{/* Missing, noncanonical or conflicting receipts remain unresolved. */}
 }
}
async function register(orderId:string,requestId?:string){
 let [o]=await database().select().from(orders).where(eq(orders.id,orderId));
 if(!o)return {status:'unresolved',reason:'order_unknown'};
 if(o.disposition==='delivery'||o.deliveredAt)return {status:'delivered'};
 let fence:Refund|{reason:string};
 if(o.disposition==='unresolved'){
  const [attempt]=await database().select().from(paymentAttempts).where(eq(paymentAttempts.orderId,orderId));
  if(!attempt)return {status:'unresolved',reason:'payment_unknown'};
  const url=process.env.CONVERSION_FUNCTION_URL,secret=process.env.REGISTRAR_CONVERSION_SECRET;
  if(!url||!secret)return {status:'unresolved',reason:'conversion_unavailable'};
  const checked=await (options.conversionFetch??fetch)(`${url.replace(/\/$/,'')}/registrar/check`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({orderId}),signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!checked.ok)return {status:'unresolved',reason:'output_unknown'};
  const proof=await checked.json() as {outcome:string};
  if(proof.outcome!=='absent')return {status:proof.outcome==='delivery'?'delivered':'unresolved',reason:'output_unknown'};
  const payment=await verifyPayment(canonicalReader(),o,attempt);
  const result=await database().execute(sql`SELECT public.mend_refund_fence(${orderId}::uuid,${JSON.stringify(payment)}::jsonb,${requestId??null}::uuid) AS refund`);
  fence=result.rows[0].refund as Refund|{reason:string};
 }else{const result=await database().execute(sql`SELECT public.mend_refund_fence(${orderId}::uuid) AS refund`);fence=result.rows[0].refund as Refund|{reason:string};}
 if('reason' in fence)return {status:'unresolved',reason:fence.reason};
 await verifyOperations(orderId,fence);
 [o]=await database().select().from(orders).where(eq(orders.id,orderId));
 if(o.disposition==='refunded')return {status:'refunded'};
 if(o.disposition==='refund_registered')return {status:'registered'};
 const submitted=await submitRefund(orderId,'registrar',fence);
 await verifyOperations(orderId,fence);
 [o]=await database().select().from(orders).where(eq(orders.id,orderId));
 return {status:o.disposition==='refund_registered'?'registered':'registration_pending',...('reason' in submitted?{reason:submitted.reason}:{})};
}
async function reconcileCapacity(reader:CapacityReader=options.capacityReader??refundRpc() as unknown as CapacityReader){
 const result=await database().execute(sql`SELECT public.mend_refund_capacity_backlog() AS backlog`),backlog=result.rows[0].backlog as {version:string;bindings:import('./refund-capacity').CapacityBinding[]};
 const observation=await observeCapacity(reader,backlog.bindings);
 const committed=await database().execute(sql`SELECT public.mend_refund_capacity_commit(${backlog.version}::bigint,${JSON.stringify(observation)}::jsonb) AS capacity`);
 return committed.rows[0].capacity;
}
return {async fetch(request:Request){
 const path=new URL(request.url).pathname.replace(/\/+/g,'/');
 if(path==='/health/check'){
  if(!authorized(request,'HEALTH_REGISTRAR_SECRET'))return Response.json({error:'unauthorized'},{status:401});
  let id:string|undefined;
  try{
   const body=await request.json();if(request.method!=='POST'||!body||Object.keys(body).join()!=='runId'||!uuid(body.runId))return Response.json({error:'invalid_request'},{status:400});id=body.runId;
   await database().execute(sql`SELECT public.mend_health_registrar(${id}::uuid,'claim')`);
   const rpc=healthRpc();
   await paymentAvailable(rpc);
   await database().execute(sql`SELECT public.mend_health_registrar(${id}::uuid,'payment_passed')`);
   await reconcileCapacity(rpc as unknown as CapacityReader);
   await database().execute(sql`SELECT public.mend_health_registrar(${id}::uuid,'complete')`);
   return Response.json({status:'checked'});
  }catch{if(id)try{await database().execute(sql`SELECT public.mend_health_registrar(${id}::uuid,'failed')`);}catch{/* Expired work cannot be completed. */}return Response.json({error:'payment_or_capacity_unavailable'},{status:503});}
 }
 if(request.method!=='POST'||!['/register','/operator','/probe','/capacity','/agent'].includes(path))return Response.json({error:'not_found'},{status:404});
 if(!authorized(request,path==='/operator'?'OPERATOR_REGISTRAR_SECRET':path==='/agent'?'AGENT_REGISTRAR_SECRET':'REGISTRAR_SERVICE_SECRET')&&!(path==='/operator'&&authorized(request,'WEB_OPERATOR_REGISTRAR_SECRET')))return Response.json({error:'unauthorized'},{status:401});
 let requestId:string|undefined;
 try{
  if(path==='/probe'){const identity=await database().execute(sql`SELECT current_user AS role,has_table_privilege(current_user,'auth_sessions','SELECT') AS sessions,has_column_privilege(current_user,'orders','result','UPDATE') AS output_write`);return Response.json({identity:identity.rows[0],storageCredentialsAbsent:['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN'].every(name=>!process.env[name]||process.env[name]==='disabled'),excludedSigningCredentialsAbsent:['ADMINISTRATOR_PRIVATE_KEY','MERCHANT_PRIVATE_KEY','PURCHASER_PRIVATE_KEY','REFUND_PRIVATE_KEY','OPENROUTER_API_KEY','SESSION_SECRET'].every(name=>!process.env[name]||process.env[name]==='disabled')});}
  if(path==='/capacity'){const body=await request.json();if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).length)throw Error('invalid_request');return Response.json(await reconcileCapacity());}
  const body=await request.json();let orderId:string;
  if(path==='/agent'){
   if(!body||Object.keys(body).join()!=='invocationId'||!uuid(body.invocationId))throw Error('invalid_request');
   const derived=await database().execute(sql`SELECT public.mend_refund_agent_dispatch(${body.invocationId}::uuid) AS id`);
   orderId=derived.rows[0].id as string;
   return Response.json(await register(orderId,body.invocationId));
  }else if(path==='/operator'){
   if(!body||Object.keys(body).join()!=='requestId'||!uuid(body.requestId))throw Error('invalid_request');requestId=body.requestId;
   const result=await database().execute(sql`SELECT public.mend_refund_operator_dispatch(${requestId}::uuid,${process.env.OPERATOR_WALLET_ADDRESS?.toLowerCase()??''}) AS request`),admitted=result.rows[0].request as {orderId?:string;reason?:string};
   if(!admitted.orderId)return Response.json({status:'unresolved',reason:admitted.reason});orderId=admitted.orderId;
  }else{if(!body||Object.keys(body).join()!=='orderId'||!uuid(body.orderId))throw Error('invalid_request');orderId=body.orderId;}
  const result=await register(orderId,requestId);
  if(requestId)await database().execute(sql`SELECT public.mend_operator_finish(${requestId}::uuid,${result.status==='unresolved'?'skipped':'completed'},${JSON.stringify(result)}::jsonb)`);
  return Response.json(result);
 }catch{
  if(requestId)try{await database().execute(sql`SELECT public.mend_operator_finish(${requestId}::uuid,'uncertain','{"reason":"refund_evidence_unavailable"}'::jsonb)`);}catch{/* durable request expiry preserves uncertainty */}
  return Response.json({status:'unresolved',reason:'refund_evidence_unavailable'},{status:503});
 }
}};}
export default createRegistrarService();
