import {Worker} from 'node:worker_threads';
import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {and,eq,isNull,sql} from 'drizzle-orm';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {database} from '../lib/server/db';
import {orders,executionAttempts} from '../lib/server/schema';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const s3=()=>new S3Client({endpoint:process.env.AWS_ENDPOINT_URL_S3,region:process.env.AWS_REGION,forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
async function read(bucket:string,key:string) {
 const response=await s3().send(new GetObjectCommand({Bucket:bucket,Key:key}));if(!response.Body||!response.ContentLength||response.ContentLength>10*1024*1024)throw new Error('object_invalid');
 const chunks:Uint8Array[]=[];let size=0;for await(const chunk of response.Body as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>10*1024*1024)throw new Error('object_limit');chunks.push(chunk);}return {bytes:Buffer.concat(chunks),createdAt:response.LastModified};
}
async function parser(bytes:Uint8Array,deadline:number) {
 const worker=new Worker(new URL('./parser.mjs',import.meta.url),{workerData:bytes,env:{},resourceLimits:{maxOldGenerationSizeMb:256}});
 let value:{text?:string,error?:string}|undefined,reason='completed';
 const exit=new Promise<number>(resolve=>worker.once('exit',resolve));
 worker.on('message',message=>{value=message;});worker.on('error',()=>{reason='parser_error';});
 const timer=setTimeout(()=>{reason='deadline';void worker.terminate();},Math.max(1,deadline-Date.now()));
 const code=await exit;clearTimeout(timer);
 return {code,reason,text:code===0&&reason==='completed'&&!value?.error?value?.text:undefined};
}
function allowed(request:Request) {
 const expected=process.env.CONVERSION_SERVICE_SECRET||'',provided=request.headers.get('Authorization')?.replace(/^Bearer /,'')||'';
 return expected.length>=32&&provided.length===expected.length&&timingSafeEqual(Buffer.from(expected),Buffer.from(provided));
}
async function convert(id:string) {
 const [order]=await database().select().from(orders).where(eq(orders.id,id));if(!order?.paidAt||!order.paymentReceipt||!order.ownerWallet)return {status:'payment_required'};
 const [existing]=await database().select().from(executionAttempts).where(and(eq(executionAttempts.orderId,id),eq(executionAttempts.generation,0)));
 if(existing)return {status:existing.state};
 const deadline=order.paidAt.getTime()+order.terms.deliverySeconds*1000;
 if(Date.now()>=deadline||order.uploadExpiresAt.getTime()<=Date.now())return {status:'overdue'};
 const attemptId=randomUUID();const [claim]=await database().insert(executionAttempts).values({id:attemptId,orderId:id,generation:0,state:'running'}).onConflictDoNothing().returning();if(!claim)return {status:'running'};
 await database().update(orders).set({status:'processing',executionStartedAt:claim.startedAt}).where(and(eq(orders.id,id),isNull(orders.deliveredAt)));
 let stopped=false;
 try {
  const {bytes}=await read(process.env.UPLOAD_BUCKET!,order.uploadKey);if(bytes.length!==order.uploadSize||hash(bytes)!==order.uploadSha256)throw new Error('upload_integrity');
  const parsed=await parser(bytes,deadline);stopped=true;
  await database().update(executionAttempts).set({stoppedAt:new Date(),stopReason:parsed.reason,parserExitCode:parsed.code}).where(eq(executionAttempts.id,attemptId));
  if(!parsed.text)throw new Error(parsed.reason==='deadline'?'deadline_stopped':'pdf_conversion_failed');
  const output=Buffer.from(parsed.text,'utf8'),key=`results/${id}/${attemptId}.txt`;
  // Durable candidate is written before storage: an unindexed candidate is never absence proof.
  const publication={state:'prepared' as const,key,sha256:hash(output),size:output.length,preparedAt:new Date().toISOString()};
  await database().update(executionAttempts).set({outputPublication:publication}).where(eq(executionAttempts.id,attemptId));
  const putStartedAt=new Date();await s3().send(new PutObjectCommand({Bucket:process.env.OUTPUT_BUCKET!,Key:key,Body:output,ContentType:'text/plain; charset=utf-8'}));
  const stored=await read(process.env.OUTPUT_BUCKET!,key),verified=stored.bytes;if(hash(verified)!==hash(output)||!verified.toString('utf8').trim())throw new Error('output_integrity');
  const createdAt=stored.createdAt??putStartedAt,verifiedAt=new Date(),result={key,sha256:hash(output),size:output.length,createdAt:createdAt.toISOString(),expiresAt:new Date(createdAt.getTime()+7*86400000).toISOString(),verifiedAt:verifiedAt.toISOString()};
  await database().batch([
   database().update(executionAttempts).set({state:'completed',outputPublication:{...publication,state:'committed'}}).where(eq(executionAttempts.id,attemptId)),
   database().update(orders).set({status:'delivered',result,deliveredAt:verifiedAt}).where(and(eq(orders.id,id),isNull(orders.deliveredAt))),
  ]);return {status:'completed'};
 }catch(error) {
  const diagnosticCode=error instanceof Error&&['upload_integrity','deadline_stopped','pdf_conversion_failed','output_integrity'].includes(error.message)?error.message:'infrastructure_error';
  // stoppedAt is parser-only evidence, never whole-attempt or publication stop proof.
  // No parser was launched on an input failure. A parser return proves its thread exited.
  const [attempt]=await database().select().from(executionAttempts).where(eq(executionAttempts.id,attemptId));
  await database().update(executionAttempts).set({state:'failed',diagnosticCode,...(!stopped&&!attempt.stoppedAt?{stoppedAt:new Date(),stopReason:'before_parser'}:{})}).where(eq(executionAttempts.id,attemptId));
  await database().update(orders).set({status:'processing_failed'}).where(and(eq(orders.id,id),isNull(orders.deliveredAt)));return {status:'failed'};
 }
}
export default {async fetch(request:Request) {
 if(!allowed(request))return Response.json({error:'unauthorized'},{status:401});if(request.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
 try {
  if(new URL(request.url).pathname==='/probe') {
   const identity=await database().execute(sql`SELECT current_user AS role, has_table_privilege(current_user,'public.auth_sessions','SELECT') AS session_access, has_column_privilege(current_user,'public.orders','paid_at','UPDATE') AS payment_write`);
   return Response.json({identity:identity.rows[0],signingCredentialsAbsent:!Object.keys(process.env).some(name=>/PRIVATE_KEY|OPENROUTER|SESSION_SECRET/.test(name))});
  }
  const body=await request.json();if(!/^[0-9a-f-]{36}$/.test(body.orderId))return Response.json({error:'invalid_order'},{status:400});return Response.json(await convert(body.orderId));
 }catch{return Response.json({error:'conversion_unavailable'},{status:503});}
}};
