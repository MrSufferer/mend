// Controlled clone of an owned prepared result: real trusted HTTP/storage/SQL path, no model or new execution.
import {readFileSync} from 'node:fs';import {parseEnv} from 'node:util';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';import {neon} from '@neondatabase/serverless';
const dir=process.env.PROVISIONING_ENV_DIR,source=process.env.AGENT_FIXTURE_SOURCE_ORDER,serviceFile=process.env.CONVERSION_SERVICE_ENV;
if(!dir||!source||!serviceFile)throw new Error('Explicit private inventory, prepared source and service pointer required');
const owner=neon(parseEnv(readFileSync(`${dir}/migration.env`,'utf8')).DATABASE_URL_UNPOOLED),worker=neon(parseEnv(readFileSync(`${dir}/database-worker.env`,'utf8')).DATABASE_URL_UNPOOLED),conversion=neon(parseEnv(readFileSync(`${dir}/database-conversion.env`,'utf8')).DATABASE_URL_UNPOOLED),service=parseEnv(readFileSync(serviceFile,'utf8'));
const oid=randomUUID(),sid=randomUUID(),attempt=randomUUID(),invocation=randomUUID();let held;
try{
 await owner.transaction([
 owner.query(`INSERT INTO submissions(id,capability_hash,idempotency_key,size,sha256,terms,expires_at) SELECT $1::uuid,capability_hash,$1::text,size,sha256,terms,expires_at FROM submissions WHERE id=(SELECT submission_id FROM orders WHERE id=$2::uuid)`,[sid,source]),
 owner.query(`INSERT INTO orders(id,submission_id,capability_hash,owner_wallet,status,paid_at,payment_receipt,payer_wallet,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages) SELECT $1::uuid,$2::uuid,capability_hash,owner_wallet,'processing_failed',paid_at,payment_receipt,payer_wallet,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages FROM orders WHERE id=$3::uuid`,[oid,sid,source]),
 owner.query(`INSERT INTO execution_attempts(id,order_id,generation,state,stopped_at,parser_exit_code,publisher_finished_at,publication_fenced_at,final_output_check,output_publication) SELECT $1::uuid,$2::uuid,0,'stopped',stopped_at,parser_exit_code,publisher_finished_at,publication_fenced_at,final_output_check,output_publication FROM execution_attempts WHERE order_id=$3::uuid AND output_publication IS NOT NULL ORDER BY generation LIMIT 1`,[attempt,oid,source]),
 ]);
 const candidates=await owner.query('SELECT id FROM execution_attempts WHERE id=$1::uuid',[attempt]);assert.equal(candidates.length,1);
 const [began]=await worker.query('SELECT public.mend_agent_begin($1::uuid,$2::uuid) AS value',[oid,invocation]);assert.ok(!began.value.error);
 // The fixture is excluded from normal live model selection while its trusted RPC is tested.
 await owner.query("UPDATE recovery_cases SET observe_at=clock_timestamp()+interval '5 minutes' WHERE order_id=$1::uuid",[oid]);
 const request=path=>fetch(service.CONVERSION_FUNCTION_URL.replace(/\/$/,'')+path,{method:'POST',headers:{Authorization:'Bearer '+service.AGENT_CONVERSION_SECRET,'Content-Type':'application/json'},body:JSON.stringify({invocationId:invocation}),signal:AbortSignal.timeout(20000)});
 const verified=await request('/agent/output');assert.equal(verified.status,200);assert.equal((await verified.json()).verified,true);
 const [sourceResult]=await owner.query('SELECT result FROM orders WHERE id=$1::uuid',[source]);assert.ok(sourceResult.result);
 // Neon query promises are lazy; .then starts the actual lock-holder before polling.
 held=owner.query(`WITH held AS MATERIALIZED (SELECT id FROM execution_attempts WHERE id=$1::uuid FOR UPDATE) SELECT id,pg_sleep(70) FROM held`,[attempt]).then(value=>value);
 let locked=false;for(let i=0;i<20&&!locked;i++){try{await owner.query('SELECT id FROM execution_attempts WHERE id=$1::uuid FOR UPDATE NOWAIT',[attempt]);}catch(e){if(e.code==='55P03')locked=true;else throw e;}if(!locked)await new Promise(r=>setTimeout(r,100));}assert.ok(locked);
 const direct=conversion.query('SELECT public.mend_agent_restore($1::uuid,$2::uuid,$3::jsonb)',[invocation,attempt,JSON.stringify(sourceResult.result)]).then(()=>({denied:false}),error=>({denied:true,code:error.code,message:error.message}));
 const response=await request('/agent/restore');const result=await response.json();assert.notEqual(result.restored,true);
 await held;
 const rpc=await direct;assert.equal(rpc.denied,true);assert.match(rpc.message,/invocation_expired/);
 const [after]=await owner.query('SELECT disposition,delivered_at,result FROM orders WHERE id=$1::uuid',[oid]);assert.equal(after.disposition,'unresolved');assert.equal(after.delivered_at,null);assert.equal(after.result,null);
 let denied=false;try{await worker.query('SELECT public.mend_agent_claim($1::uuid,$2::uuid)',[invocation,randomUUID()]);}catch{denied=true;}assert.ok(denied);
 console.log(JSON.stringify({controlled:true,realPreparedObjectVerified:true,attemptRowHeldSeconds:70,invocationDeadlineSeconds:60,conversionRpcDeniedAfterLockRelease:true,rpcError:'invocation_expired',noDeliveryAfterRelease:true,expiredClaimDenied:true,httpStatus:response.status,httpRestored:false}));
}finally{
 if(held)await held.catch(()=>{});
 await owner.transaction([owner.query('DELETE FROM agent_invocations WHERE order_id=$1::uuid',[oid]),owner.query('DELETE FROM recovery_cases WHERE order_id=$1::uuid',[oid]),owner.query('DELETE FROM execution_attempts WHERE order_id=$1::uuid',[oid]),owner.query('DELETE FROM orders WHERE id=$1::uuid',[oid]),owner.query('DELETE FROM submissions WHERE id=$1::uuid',[sid])]);
}
