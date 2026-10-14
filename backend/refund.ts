import './database-timeout';
import {sql} from 'drizzle-orm';
import {database} from '../lib/server/db';
import {reserve,token,reserveAbi,tokenAbi,type RefundBinding} from './refund-chain';
import {refundRpc,submitRefund} from './refund-transactions';
import {authorized,callRegistrar,uuid} from './refund-service-auth';
export default {async fetch(request:Request){try{
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
 if(!selected.rows.length||!selected.rows[0].order_id)return Response.json({status:'idle'});orderId=selected.rows[0].order_id as string;
 const verified=await callRegistrar(orderId);
 if(verified.status!=='registered')return Response.json(verified);
 const result=await database().execute(sql`SELECT * FROM public.refunds WHERE order_id=${orderId}::uuid`),r=result.rows[0] as RefundBinding;
 const rpc=refundRpc();
 const balance=await rpc.readContract({address:token,abi:tokenAbi,functionName:'balanceOf',authorizationList:undefined,args:[reserve]}) as bigint;
 const allowance=await rpc.readContract({address:reserve,abi:reserveAbi,functionName:'remainingDailyAllowance',authorizationList:undefined}) as bigint;
 if(balance<BigInt(r.amount_atomic)||allowance<BigInt(r.amount_atomic)){const blocker=balance<BigInt(r.amount_atomic)?'reserve_unfunded':'allowance_exhausted';await database().execute(sql`SELECT public.mend_refund_blocker(${orderId}::uuid,${blocker})`);return Response.json({status:'pending',reason:blocker});}
 await database().execute(sql`SELECT public.mend_refund_blocker(${orderId}::uuid,NULL)`);
 const submitted=await submitRefund(orderId,'refund',r);
 const settled=await callRegistrar(orderId);
 return Response.json({status:settled.status==='refunded'?'refunded':'pending',...('reason' in submitted?{reason:submitted.reason}:{})});
 }catch{return Response.json({status:'pending',reason:'refund_reconciliation_unavailable'},{status:503});}}};
