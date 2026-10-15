import './database-timeout';
import {sql} from 'drizzle-orm';
import {database as defaultDatabase} from '../lib/server/db';
import {type RefundBinding} from './refund-chain';
import {submitRefund} from './refund-transactions';
import {authorized,callRegistrar,callCapacity,uuid} from './refund-service-auth';
export function createRefundService(options:{database?:typeof defaultDatabase;registrar?:typeof callRegistrar;capacity?:typeof callCapacity;submit?:typeof submitRefund}={}){const database=options.database??defaultDatabase;return {async fetch(request:Request){try{
 const path=new URL(request.url).pathname.replace(/\/+/g,'/');
 if(request.method!=='POST'||!['/reconcile','/scheduled','/probe'].includes(path))return Response.json({error:'not_found'},{status:404});
 let sweep:{id:string;at:string}|undefined;
 if(path==='/scheduled'){
  const body=await request.json(),header=request.headers.get('X-Neon-Trigger-Invocation-Id');
  if(!header||!/^[-A-Za-z0-9_]{1,256}$/.test(header)||header!==body.invocation_id||body.version!==1||body.trigger?.type!=='schedule'||body.trigger.id!==process.env.REFUND_TRIGGER_ID||!Number.isFinite(Date.parse(body.data?.scheduled_at)))return Response.json({error:'invalid_trigger'},{status:403});
  sweep={id:header,at:body.data.scheduled_at};
 }else if(!authorized(request,'REFUND_SERVICE_SECRET'))return Response.json({error:'unauthorized'},{status:401});
 if(path==='/probe'){const identity=await database().execute(sql`SELECT current_user AS role,has_table_privilege(current_user,'auth_sessions','SELECT') AS sessions,has_column_privilege(current_user,'orders','result','UPDATE') AS output_write`);return Response.json({identity:identity.rows[0],storageCredentialsAbsent:['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN'].every(name=>!process.env[name]||process.env[name]==='disabled'),excludedSigningCredentialsAbsent:['ADMINISTRATOR_PRIVATE_KEY','MERCHANT_PRIVATE_KEY','PURCHASER_PRIVATE_KEY','REGISTRAR_PRIVATE_KEY','OPENROUTER_API_KEY','SESSION_SECRET'].every(name=>!process.env[name]||process.env[name]==='disabled')});}
 let orderId:string|undefined;
 if(path==='/reconcile'){const body=await request.json();if(!body||Object.keys(body).some(key=>key!=='orderId')||body.orderId!==undefined&&!uuid(body.orderId))return Response.json({error:'invalid_request'},{status:400});orderId=body.orderId;}
 const selected=await database().execute(sweep?sql`SELECT public.mend_refund_sweep(${sweep.id}::text,${sweep.at}::timestamptz) AS order_id`:orderId?sql`SELECT order_id FROM public.mend_refund_queue() WHERE order_id=${orderId}::uuid`:sql`SELECT order_id FROM public.mend_refund_queue() LIMIT 1`);
 if(!selected.rows.length||!selected.rows[0].order_id){await (options.capacity??callCapacity)();return Response.json({status:'idle'});}orderId=selected.rows[0].order_id as string;
 let verified:{status:string;reason?:string},capacity:Awaited<ReturnType<typeof callCapacity>>;
 // Registration may fence new debt before returning pending or failing. Observe it either way.
 try{verified=await (options.registrar??callRegistrar)(orderId);}
 finally{capacity=await (options.capacity??callCapacity)();}
 if(verified.status!=='registered')return Response.json(verified);
 const result=await database().execute(sql`SELECT * FROM public.refunds WHERE order_id=${orderId}::uuid`),r=result.rows[0] as RefundBinding;
 if(!['sufficient','deficit'].includes(capacity.status))throw Error('capacity_unknown');
 const balance=BigInt(capacity.balanceAtomic),allowance=BigInt(capacity.allowanceAtomic);
 if(balance<BigInt(r.amount_atomic)||allowance<BigInt(r.amount_atomic)){const blocker=balance<BigInt(r.amount_atomic)?'reserve_unfunded':'allowance_exhausted';await database().execute(sql`SELECT public.mend_refund_blocker(${orderId}::uuid,${blocker})`);return Response.json({status:'pending',reason:blocker});}
 await database().execute(sql`SELECT public.mend_refund_blocker(${orderId}::uuid,NULL)`);
 const submitted=await (options.submit??submitRefund)(orderId,'refund',r);
 const settled=await (options.registrar??callRegistrar)(orderId);
 return Response.json({status:settled.status==='refunded'?'refunded':'pending',...('reason' in submitted?{reason:submitted.reason}:{})});
 }catch{return Response.json({status:'pending',reason:'refund_reconciliation_unavailable'},{status:503});}}};}
export default createRefundService();
