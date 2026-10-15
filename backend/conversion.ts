import './database-timeout';
import type {Worker} from 'node:worker_threads';
import {runPdfWorker} from './pdf-worker';
import {healthConversion,healthCleanup,cleanupHealth} from './health-conversion';
import {randomUUID,createHash,timingSafeEqual} from 'node:crypto';
import {and,desc,eq,isNull,sql} from 'drizzle-orm';
import {S3Client,GetObjectCommand,PutObjectCommand} from '@aws-sdk/client-s3';
import {database} from '../lib/server/db';
import {orders,executionAttempts,reconciliationSweeps,agentInvocations,type Order} from '../lib/server/schema';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const s3=()=>new S3Client({endpoint:process.env.AWS_ENDPOINT_URL_S3,region:process.env.AWS_REGION,forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
const active=new Map<string,{abort:AbortController;worker?:Worker;stopReason?:string;done:Promise<void>}>();
let shuttingDown=false;
function stop(id:string,reason:string) {const a=active.get(id);if(a){a.stopReason??=reason;a.abort.abort();void a.worker?.terminate();}}
process.on('SIGINT',()=>{shuttingDown=true;for(const id of active.keys())stop(id,'host_shutdown');void Promise.allSettled([...active.values()].map(a=>a.done)).then(()=>process.exit(0));});
async function read(bucket:string,key:string,abort?:AbortSignal) {
 const response=await s3().send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:abort??AbortSignal.timeout(8000)});
 if(!response.Body||!response.ContentLength||response.ContentLength>10*1024*1024)throw new Error('object_invalid');
 const chunks:Uint8Array[]=[];let size=0;
 for await(const chunk of response.Body as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>10*1024*1024)throw new Error('object_limit');chunks.push(chunk);}
 return {bytes:Buffer.concat(chunks),createdAt:response.LastModified};
}
async function parser(bytes:Uint8Array,deadline:number,attemptId:string,holdMs:number) {
 return runPdfWorker(bytes,deadline,active.get(attemptId)!,reason=>stop(attemptId,reason),holdMs);
}
function allowed(request:Request,secret='CONVERSION_SERVICE_SECRET') {
 const expected=Buffer.from(process.env[secret]||''),provided=Buffer.from(request.headers.get('Authorization')?.replace(/^Bearer /,'')||'');
 return expected.length>=32&&provided.length===expected.length&&timingSafeEqual(expected,provided);
}
async function observation(id:string) {
 const [order]=await database().select().from(orders).where(eq(orders.id,id));if(!order)return null;
 const attempts=await database().select().from(executionAttempts).where(eq(executionAttempts.orderId,id));
 return {order:{id,deadline:order.paidAt?new Date(order.paidAt.getTime()+order.terms.deliverySeconds*1000).toISOString():null,terms:order.terms,deliveredAt:order.deliveredAt,overdue:!!order.paidAt&&!order.deliveredAt&&Date.now()>=order.paidAt.getTime()+order.terms.deliverySeconds*1000},
 execution:attempts.length&&attempts.every(a=>a.publisherFinishedAt)?'stopped':'unknown',reconciliation:order.recoveryObservation,
 attempts:attempts.map(a=>({id:a.id,generation:a.generation,state:a.state,parserExitedAt:a.stoppedAt,executionStoppedAt:a.publisherFinishedAt,stopRequestedAt:a.stopRequestedAt,publicationFencedAt:a.publicationFencedAt,finalOutputCheck:a.finalOutputCheck,publication:a.outputPublication?{state:a.outputPublication.state,preparedAt:a.outputPublication.preparedAt}:null}))};
}
async function checkedCandidate(attempt:typeof executionAttempts.$inferSelect) {
 const p=attempt.outputPublication;if(!p)return null;
 const stored=await read(process.env.OUTPUT_BUCKET!,p.key);
 if(stored.bytes.length!==p.size||hash(stored.bytes)!==p.sha256||!stored.bytes.toString('utf8').trim()||!stored.createdAt)throw new Error('output_integrity');
 const createdAt=stored.createdAt,expiresAt=new Date(createdAt.getTime()+7*86400000);
 if(expiresAt.getTime()<=Date.now())throw new Error('output_expired');
 return {key:p.key,sha256:p.sha256,size:p.size,createdAt:createdAt.toISOString(),expiresAt:expiresAt.toISOString(),verifiedAt:new Date().toISOString()};
}
async function finalAbsence(attempt:typeof executionAttempts.$inferSelect) {
 // Deterministic private key is checked even when no publication was prepared.
 try{await read(process.env.OUTPUT_BUCKET!,`results/${attempt.orderId}/${attempt.id}.txt`,AbortSignal.timeout(3000));return 'unknown' as const;}
 catch(error){return (error as {$metadata?:{httpStatusCode?:number}})?.$metadata?.httpStatusCode===404?'absent' as const:'unknown' as const;}
}
// Worker commands are pinned to a live invocation; only trusted conversion admits a retry.
async function agentCommand(request:Request,path:string) {
 if(!allowed(request,'AGENT_CONVERSION_SECRET'))return Response.json({error:'unauthorized'},{status:401});
 const body=await request.json();
 if(request.method!=='POST'||Object.keys(body).join(',')!=='invocationId'||! /^[0-9a-f-]{36}$/.test(body.invocationId))return Response.json({error:'invalid_invocation'},{status:400});
 const [invocation]=await database().select().from(agentInvocations).where(eq(agentInvocations.id,body.invocationId));
 if(invocation?.purpose!=='model')return Response.json({error:'invalid_invocation'},{status:403});
 return recoveryCommand(body.invocationId,path);
}
async function recoveryCommand(invocationId:string,path:string) {
 const assertion=await database().execute(sql`SELECT public.mend_agent_assert(${invocationId}::uuid) AS id`),id=String(assertion.rows[0].id);
 if(path==='/agent/inspect')return Response.json(await observation(id));
 if(!['/agent/output','/agent/restore','/agent/retry'].includes(path))return Response.json({error:'not_found'},{status:404});
 const [order]=await database().select().from(orders).where(eq(orders.id,id));
 const attempts=await database().select().from(executionAttempts).where(eq(executionAttempts.orderId,id));
 const stopped=attempts.length>0&&attempts.every(a=>!!a.publisherFinishedAt);
 if(!stopped)return Response.json({verified:false,reason:'execution_unknown',execution:'unknown'});
 if(order.disposition!=='unresolved')return Response.json({verified:false,reason:'disposition_fenced'});
 for(const attempt of attempts){
  if(!attempt.outputPublication)continue;
  try{
   const result=await checkedCandidate(attempt);if(!result)continue;
   await database().execute(sql`SELECT public.mend_agent_assert(${invocationId}::uuid)`);
   const proof={attemptId:attempt.id,sha256:result.sha256,size:result.size,createdAt:result.createdAt,expiresAt:result.expiresAt,verifiedAt:result.verifiedAt};
   if(path==='/agent/output')return Response.json({verified:true,execution:'stopped',proof});
   const restored=await database().execute(sql`SELECT public.mend_agent_restore(${invocationId}::uuid,${attempt.id}::uuid,${JSON.stringify(result)}::jsonb) AS restored`);
   const [fresh]=await database().select().from(orders).where(eq(orders.id,id));
   return Response.json({status:restored.rows[0].restored?'restored':'unresolved',restored:!!restored.rows[0].restored,proof,deliveredAt:fresh.deliveredAt?.toISOString()??null,late:!!fresh.deliveredAt&&!!fresh.paidAt&&fresh.deliveredAt.getTime()>fresh.paidAt.getTime()+fresh.terms.deliverySeconds*1000});
  }catch{return Response.json({verified:false,reason:'output_unknown'});}
 }
 if(path==='/agent/retry'){
  const parent=attempts.find(a=>a.generation===0);
  if(attempts.some(a=>a.generation===1))return Response.json({reason:'retry_exists'});
  if(!parent||attempts.length!==1||parent.finalOutputCheck!=='absent'||!parent.publicationFencedAt)return Response.json({reason:'output_unknown'});
  if(await finalAbsence(parent)!=='absent')return Response.json({reason:'output_unknown'});
  const attemptId=randomUUID();
  const result=await database().execute(sql`SELECT public.mend_agent_retry_claim(${invocationId}::uuid,${parent.id}::uuid,${attemptId}::uuid,${randomUUID()},${new Date().toISOString()}::timestamptz) AS claim`);
  const claim=result.rows[0]?.claim as {attemptId?:string;reason?:string};
  if(!claim?.attemptId)return Response.json(claim??{reason:'admission_unknown'});
  // The execution has its own durable identity/deadline. A caller/tool timeout does
  // not cancel the parent or reopen retry admission; a replay only observes it.
  return Response.json({...await execute(order,attemptId),attemptId,generation:1});
 }
 return Response.json({verified:false,reason:'no_prepared_candidate'});
}
async function operatorCommand(request:Request) {
 if(!allowed(request,'OPERATOR_CONVERSION_SECRET'))return Response.json({error:'unauthorized'},{status:401});
 const body=await request.json();
 if(request.method!=='POST'||Object.keys(body).join(',')!=='requestId'||! /^[0-9a-f-]{36}$/.test(body.requestId))return Response.json({error:'invalid_request'},{status:400});
 let evidence:Record<string,unknown>={reason:'action_outcome_unknown'},outcome='uncertain',dispatched=false;
 try {
  const actor=process.env.OPERATOR_WALLET_ADDRESS?.toLowerCase();if(!actor)throw Error('operator_unconfigured');
  // The caller supplies only a durable request ID, never evidence, action authority or actor.
  const asserted=await database().execute(sql`SELECT public.mend_operator_dispatch(${body.requestId}::uuid,${actor}) AS request`);
  const dispatch=asserted.rows[0].request as {invocationId:string;action:string;reason?:string};
  if(dispatch.reason)return Response.json({outcome:'uncertain',evidence:{reason:dispatch.reason}});
  dispatched=true;
  const {invocationId,action}=dispatch;
  if(action==='check') {
   const observed=await recoveryCommand(invocationId,'/agent/inspect');
   const output=await recoveryCommand(invocationId,'/agent/output');
   evidence={observation:await observed.json(),output:await output.json()};outcome='checked';
  } else {
   evidence=await(await recoveryCommand(invocationId,action==='restore'?'/agent/restore':'/agent/retry')).json();
   outcome=evidence.restored||evidence.status==='completed'?'completed':evidence.attemptId?'uncertain':'skipped';
  }
 }catch(error){
  // A failed response after dispatch can hide admitted execution. Only a proven
  // pre-dispatch authority denial establishes that this request was skipped.
  const cause=error as {message?:string;cause?:{message?:string}};
  const reason=cause.cause?.message??cause.message;
  if(!dispatched&&['operator_request_stale','operator_session_expired','invocation_expired','invalid_request'].includes(reason??'')){
   outcome='skipped';evidence={reason};
  }
 }
 await database().execute(sql`SELECT public.mend_operator_finish(${body.requestId}::uuid,${outcome},${JSON.stringify(evidence)}::jsonb)`);
 return Response.json({outcome,evidence});
}
// Only the independent registrar can request fresh storage evidence; caller supplies no facts.
async function registrarCheck(request:Request) {
 if(!allowed(request,'REGISTRAR_CONVERSION_SECRET'))return Response.json({error:'unauthorized'},{status:401});
 const body=await request.json();if(request.method!=='POST'||Object.keys(body).join(',')!=='orderId'||! /^[0-9a-f-]{36}$/.test(body.orderId))return Response.json({error:'invalid_order'},{status:400});
 const id=body.orderId,attempts=await database().select().from(executionAttempts).where(eq(executionAttempts.orderId,id)).orderBy(executionAttempts.generation);
 let outcome='unknown';
 if(attempts.length&&attempts.every(a=>a.stoppedAt&&a.publisherFinishedAt&&a.publicationFencedAt)) {
  outcome='absent';
  for(const attempt of attempts) {
   if(attempt.outputPublication) {
    try{const result=await checkedCandidate(attempt);if(result){const restored=await database().execute(sql`SELECT public.mend_restore_output(${attempt.id}::uuid,${JSON.stringify(result)}::jsonb) AS restored`);outcome=restored.rows[0]?.restored?'delivery':'unknown';break;}}catch{}
    outcome='unknown';break;
   }
   if(attempt.finalOutputCheck!=='absent'||await finalAbsence(attempt)!=='absent'){outcome='unknown';break;}
  }
 }
 const proof=await database().execute(sql`SELECT public.mend_refund_output_check(${id}::uuid,${JSON.stringify(attempts.map(a=>a.id))}::jsonb,${outcome}) AS proof`);
 return Response.json(proof.rows[0].proof);
}
async function reconcile(id:string) {
 const [order]=await database().select().from(orders).where(eq(orders.id,id));if(!order)return {status:'not_found'};
 const deadline=order.paidAt?order.paidAt.getTime()+order.terms.deliverySeconds*1000:null;
 if(deadline&&Date.now()>=deadline)await database().execute(sql`SELECT public.mend_request_stop(${id}::uuid)`);
 let attempts=await database().select().from(executionAttempts).where(eq(executionAttempts.orderId,id));
 if(!attempts.length&&order.paidAt&&deadline&&Date.now()<deadline&&order.uploadExpiresAt.getTime()>Date.now()){await convert(id);attempts=await database().select().from(executionAttempts).where(eq(executionAttempts.orderId,id));}
 const allStopped=attempts.length>0&&attempts.every(a=>!!a.publisherFinishedAt);let outputUnknown=false;
 let outcome=order.deliveredAt?'delivered':!order.paidAt?'payment_unknown':'execution_unknown';
 for(const attempt of attempts) {
  if(attempt.stopRequestedAt)stop(attempt.id,'stop_requested');
  if(!attempt.publisherFinishedAt)continue; // Lease/deploy/timeout never proves termination.
  if(!attempt.outputPublication){
   const absent=await finalAbsence(attempt)==='absent';
   if(absent&&(attempt.diagnosticCode==='pdf_conversion_failed'||attempt.diagnosticCode==='upload_integrity'))await database().execute(sql`SELECT public.mend_fail_execution(${attempt.id}::uuid,'absent',${attempt.diagnosticCode})`);
   outputUnknown ||= !absent;outcome=absent?'stopped_no_output':'output_unknown';continue;
  }
  if(!allStopped){outputUnknown=true;continue;}
  try {
   const result=await checkedCandidate(attempt);
   if(result){const restored=await database().execute(sql`SELECT public.mend_restore_output(${attempt.id}::uuid,${JSON.stringify(result)}::jsonb) AS restored`);outcome=restored.rows[0]?.restored?'valid_output':order.deliveredAt?'delivered':'disposition_fenced';}
  }catch{outcome='output_unknown';outputUnknown=true;}
 }
 const [canonical]=await database().select({deliveredAt:orders.deliveredAt,disposition:orders.disposition}).from(orders).where(eq(orders.id,id));
 if(canonical?.deliveredAt)outcome='delivered';else if(canonical?.disposition!=='unresolved')outcome='disposition_fenced';
 if(!canonical?.deliveredAt&&canonical?.disposition==='unresolved'&&outcome!=='valid_output'){if(!allStopped&&attempts.length)outcome='execution_unknown';else if(outputUnknown)outcome='output_unknown';}
 await database().update(orders).set({recoveryObservation:{checkedAt:new Date().toISOString(),outcome,execution:attempts.length&&attempts.every(a=>a.publisherFinishedAt)?'stopped':'unknown',stopRequested:attempts.some(a=>!!a.stopRequestedAt)}}).where(eq(orders.id,id));
 return {status:outcome};
}
async function convert(id:string,experiment?:string) {
 const [order]=await database().select().from(orders).where(eq(orders.id,id));if(!order?.paidAt||!order.paymentReceipt||!order.ownerWallet)return {status:'payment_required'};
 const [existing]=await database().select().from(executionAttempts).where(eq(executionAttempts.orderId,id)).orderBy(desc(executionAttempts.generation)).limit(1);
 if(existing)return {status:existing.state,generation:existing.generation};
 const deadline=order.paidAt.getTime()+order.terms.deliverySeconds*1000;
 if(shuttingDown||Date.now()>=deadline||order.uploadExpiresAt.getTime()<=Date.now())return {status:'overdue'};
 const attemptId=randomUUID();const result=await database().execute(sql`SELECT public.mend_claim_execution(${id}::uuid,${attemptId}::uuid,${randomUUID()}) AS claim`);const claim=result.rows[0]?.claim as {attemptId?:string;reason?:string;state?:string};if(!claim?.attemptId||claim.reason)return {status:claim?.state??claim?.reason??'admission_unknown'};
 return execute(order,attemptId,experiment);
}
async function execute(order:Order,attemptId:string,experiment?:string){
 const id=order.id,deadline=order.paidAt!.getTime()+order.terms.deliverySeconds*1000;
 let complete!:()=>void;const done=new Promise<void>(resolve=>{complete=resolve;});const control={abort:new AbortController(),done,worker:undefined as Worker|undefined,stopReason:undefined as string|undefined};active.set(attemptId,control);
 const timer=setTimeout(()=>{stop(attemptId,'deadline');void database().execute(sql`SELECT public.mend_request_stop(${id}::uuid)`).catch(()=>{});},Math.max(1,deadline-Date.now()));
 let pollBusy=false;const poll=setInterval(()=>{if(pollBusy)return;pollBusy=true;void database().select({requested:executionAttempts.stopRequestedAt}).from(executionAttempts).where(eq(executionAttempts.id,attemptId)).then(([a])=>{if(a?.requested)stop(attemptId,'stop_requested');}).catch(()=>{}).finally(()=>{pollBusy=false;});},1000);
 let parserLaunched=false,parserObserved=false;
 try {
  await database().update(orders).set({status:'processing',executionStartedAt:sql`COALESCE(${orders.executionStartedAt},clock_timestamp())`}).where(and(eq(orders.id,id),isNull(orders.deliveredAt)));
  const {bytes}=await read(process.env.UPLOAD_BUCKET!,order.uploadKey,AbortSignal.any([control.abort.signal,AbortSignal.timeout(8000)]));if(bytes.length!==order.uploadSize||hash(bytes)!==order.uploadSha256)throw new Error('upload_integrity');
  parserLaunched=true;
  if(experiment==='noack')setTimeout(()=>process.exit(77),1000);
  if(experiment==='shutdown')setTimeout(()=>process.kill(process.pid,'SIGINT'),1500);
  const parsed=await parser(bytes,deadline,attemptId,experiment==='shutdown'||experiment==='noack'?10000:0);parserObserved=true;
  await database().update(executionAttempts).set({stoppedAt:new Date(),stopReason:parsed.reason,parserExitCode:parsed.code}).where(eq(executionAttempts.id,attemptId));
  if(experiment==='failure')throw new Error('pdf_conversion_failed');
  if(!parsed.text)throw new Error(parsed.reason==='deadline'?'deadline_stopped':['completed','parser_error'].includes(parsed.reason)?'pdf_conversion_failed':'infrastructure_error');
  const output=Buffer.from(parsed.text,'utf8'),key=`results/${id}/${attemptId}.txt`;
  const publication={state:'prepared' as const,key,sha256:hash(output),size:output.length,preparedAt:new Date().toISOString()};
  const prepared=await database().execute(sql`SELECT public.mend_prepare_output(${attemptId}::uuid,${JSON.stringify(publication)}::jsonb) AS prepared`);
  if(!prepared.rows[0]?.prepared)throw new Error('publication_fenced');
  await s3().send(new PutObjectCommand({Bucket:process.env.OUTPUT_BUCKET!,Key:key,Body:output,ContentType:'text/plain; charset=utf-8'}),{abortSignal:AbortSignal.any([control.abort.signal,AbortSignal.timeout(8000)])});
  const [attempt]=await database().select().from(executionAttempts).where(eq(executionAttempts.id,attemptId));
  const result=await checkedCandidate(attempt);
  if(experiment==='publication')throw new Error('injected_publication_interruption');
  await database().execute(sql`SELECT public.mend_finish_execution(${attemptId}::uuid,'valid',${JSON.stringify(result)}::jsonb)`);return {status:'completed'};
 }catch(error) {
  // A failed constructor / input read has no thread. A launched thread requires observed exit.
  if(parserLaunched&&!parserObserved&&control.worker){await control.worker.terminate();parserObserved=true;await database().update(executionAttempts).set({stoppedAt:new Date(),stopReason:control.stopReason??'parser_terminated',parserExitCode:1}).where(eq(executionAttempts.id,attemptId));}
  if(!parserLaunched)await database().update(executionAttempts).set({stoppedAt:new Date(),stopReason:'before_parser'}).where(eq(executionAttempts.id,attemptId));
  const [attempt]=await database().select().from(executionAttempts).where(eq(executionAttempts.id,attemptId));
  const diagnostic=error instanceof Error&&['upload_integrity','deadline_stopped','pdf_conversion_failed'].includes(error.message)?error.message:'infrastructure_error';
  if(attempt.stoppedAt){const finalCheck=attempt.outputPublication?'unknown':await finalAbsence(attempt);await database().execute(sql`SELECT public.mend_fail_execution(${attemptId}::uuid,${finalCheck},${diagnostic})`);}
  return {status:'stopped'};
 }finally{clearTimeout(timer);clearInterval(poll);active.delete(attemptId);complete();}
}
async function scheduled(request:Request) {
 const body=await request.json(),header=request.headers.get('X-Neon-Trigger-Invocation-Id');
 if(!header||header!==body.invocation_id||body.version!==1||body.trigger?.type!=='schedule'||body.trigger.id!==process.env.RECONCILIATION_TRIGGER_ID||!Number.isFinite(Date.parse(body.data?.scheduled_at)))return Response.json({error:'invalid_trigger'},{status:403});
 const [claimed]=await database().insert(reconciliationSweeps).values({id:body.invocation_id,scheduledAt:new Date(body.data.scheduled_at)}).onConflictDoNothing().returning();if(!claimed)return Response.json({status:'already_observed'});
 await cleanupHealth();
 const pending=await database().select({id:orders.id}).from(orders).where(sql`${orders.deliveredAt} IS NULL AND (${orders.paidAt} IS NOT NULL OR EXISTS (SELECT 1 FROM public.payment_attempts p WHERE p.order_id=${orders.id}))`).orderBy(sql`${orders.recoveryObservation}->>'checkedAt' ASC NULLS FIRST`,orders.createdAt).limit(3);
 const started=Date.now();let observed=0;
 for(const order of pending){if(Date.now()-started>=30000)break;try{await reconcile(order.id);}catch{await database().update(orders).set({recoveryObservation:{checkedAt:new Date().toISOString(),outcome:'infrastructure_unknown',execution:'unknown'}}).where(eq(orders.id,order.id));}observed++;}
 await database().update(reconciliationSweeps).set({completedAt:new Date(),observedOrders:observed}).where(eq(reconciliationSweeps.id,claimed.id));
 return Response.json({status:'reconciled',observed});
}
export default {async fetch(request:Request) {
 const url=new URL(request.url),path=url.pathname.replace(/\/+/g,'/');
 if(path==='/health/cleanup')return healthCleanup(request);
 if(path==='/health/execute')return healthConversion(request);
 if(path==='/scheduled'&&request.method==='POST'){try{return await scheduled(request);}catch{return Response.json({error:'reconciliation_unavailable'},{status:503});}}
 if(path==='/registrar/check')return registrarCheck(request);
 if(path==='/operator'){try{return await operatorCommand(request);}catch{return Response.json({error:'operator_unavailable'},{status:503});}}
 if(path.startsWith('/agent/')){try{return await agentCommand(request,path);}catch{return Response.json({error:'investigation_unavailable'},{status:503});}}
 if(!allowed(request))return Response.json({error:'unauthorized'},{status:401});
 try {
  if(request.method==='GET'&&path==='/status'){const id=url.searchParams.get('orderId')||'';if(!/^[0-9a-f-]{36}$/.test(id))return Response.json({error:'invalid_order'},{status:400});const result=await observation(id);return Response.json(result??{error:'not_found'},{status:result?200:404});}
  if(request.method==='GET'&&path==='/sweeps')return Response.json(await database().select().from(reconciliationSweeps).orderBy(sql`${reconciliationSweeps.startedAt} DESC`).limit(5));
  if(request.method!=='POST')return Response.json({error:'method_not_allowed'},{status:405});
  if(path==='/probe') {
   const identity=await database().execute(sql`SELECT current_user AS role, has_table_privilege(current_user,'public.auth_sessions','SELECT') AS session_access, has_column_privilege(current_user,'public.orders','paid_at','UPDATE') AS payment_write`);
   return Response.json({identity:identity.rows[0],signingCredentialsAbsent:!Object.keys(process.env).some(name=>/PRIVATE_KEY|OPENROUTER|SESSION_SECRET/.test(name))});
  }
  const body=await request.json();if(!/^[0-9a-f-]{36}$/.test(body.orderId))return Response.json({error:'invalid_order'},{status:400});
  if(path==='/stop'){await database().execute(sql`SELECT public.mend_request_stop(${body.orderId}::uuid)`);return Response.json({status:'stop_requested'});}
  if(path==='/reconcile')return Response.json(await reconcile(body.orderId));
  if(path==='/experiment') {if(!process.env.INTERRUPTION_EXPERIMENT_ORDER?.split(',').includes(body.orderId)||!['shutdown','noack','publication','failure'].includes(body.mode))return Response.json({error:'experiment_disabled'},{status:403});return Response.json(await convert(body.orderId,body.mode));}
  if(path!=='/')return Response.json({error:'not_found'},{status:404});
  return Response.json(await convert(body.orderId));
 }catch{return Response.json({error:'conversion_unavailable'},{status:503});}
}};
