import './database-timeout';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {eq,sql} from 'drizzle-orm';
import {timingSafeEqual} from 'node:crypto';
import {database} from '../lib/server/db';
import {paymentAttempts,orders} from '../lib/server/schema';
import {confirmReceipt} from '../lib/server/payment-receipts';
const authorized=(r:Request)=>{const expected=process.env.RECEIPT_SERVICE_SECRET||'',actual=r.headers.get('Authorization')?.replace(/^Bearer /,'')||'';return expected.length>=32&&actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));};
export default {async fetch(request:Request){try{
 const path=new URL(request.url).pathname.replace(/\/+/g,'/');
 if(path==='/scheduled'){
  const body=await request.json(),header=request.headers.get('X-Neon-Trigger-Invocation-Id');
  if(!header||header!==body.invocation_id||body.version!==1||body.trigger?.type!=='schedule'||body.trigger.id!==process.env.RECEIPT_TRIGGER_ID||!Number.isFinite(Date.parse(body.data?.scheduled_at)))return Response.json({error:'invalid_trigger'},{status:403});
 }else if(!authorized(request))return Response.json({error:'unauthorized'},{status:401});
 if(path==='/probe'){const storage=new S3Client({endpoint:process.env.AWS_ENDPOINT_URL_S3,region:process.env.AWS_REGION,forcePathStyle:true});const denies=async(command:GetObjectCommand|PutObjectCommand)=>{try{await storage.send(command as GetObjectCommand,{abortSignal:AbortSignal.timeout(3000)});return false;}catch(error){return (error as{$metadata?:{httpStatusCode?:number}})?.$metadata?.httpStatusCode===403;}};const storageReadDenied=await denies(new GetObjectCommand({Bucket:'mend-outputs',Key:'authority-probes/receipt-only'})),storageWriteDenied=await denies(new PutObjectCommand({Bucket:'mend-outputs',Key:'authority-probes/receipt-only',Body:''}));const identity=await database().execute(sql`SELECT current_user AS role,has_table_privilege(current_user,'public.auth_sessions','SELECT') AS sessions,has_column_privilege(current_user,'public.orders','result','UPDATE') AS output_write`);return Response.json({identity:identity.rows[0],storageReadDenied,storageWriteDenied,sensitiveCredentialsAbsent:['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN'].every(name=>!process.env[name]||process.env[name]==='disabled')&&!Object.keys(process.env).some(name=>/PRIVATE_KEY|OPENROUTER|SESSION_SECRET/.test(name))});}
 if(request.method!=='POST'||!['/scheduled','/reconcile'].includes(path))return Response.json({error:'not_found'},{status:404});
 const attempts=await database().select({attempt:paymentAttempts}).from(paymentAttempts).innerJoin(orders,eq(orders.id,paymentAttempts.orderId)).where(sql`${orders.paidAt} IS NULL OR ${orders.paymentReceipt} IS NULL`).orderBy(sql`${paymentAttempts.reconciledAt} ASC NULLS FIRST`,paymentAttempts.createdAt).limit(1);
 for(const {attempt}of attempts){try{await confirmReceipt(attempt);}finally{await database().update(paymentAttempts).set({reconciledAt:new Date()}).where(eq(paymentAttempts.orderId,attempt.orderId));}}
 return Response.json({status:'reconciled',observed:attempts.length});
 }catch{return Response.json({error:'receipt_reconciliation_unavailable'},{status:503});}}};
