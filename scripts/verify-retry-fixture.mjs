import{S3Client,DeleteObjectCommand,PutObjectCommand}from'@aws-sdk/client-s3';import{readFileSync}from'node:fs';import{parseEnv}from'node:util';import{randomUUID}from'node:crypto';import{neon}from'@neondatabase/serverless';import{build}from'esbuild';import{mkdir}from'node:fs/promises';
const dir=process.env.PROVISIONING_ENV_DIR;if(!dir)throw Error('Explicit provisioning directory required');
const owner=neon(parseEnv(readFileSync(`${dir}/migration.env`,'utf8')).DATABASE_URL_UNPOOLED);
Object.assign(process.env,parseEnv(readFileSync('/private/tmp/mend-conversion6-service.env','utf8')));
const conversion=parseEnv(readFileSync(`${dir}/database-conversion.env`,'utf8'));Object.assign(process.env,conversion,parseEnv(readFileSync(`${dir}/storage-conversion.env`,'utf8')),JSON.parse(readFileSync('docs/provisioning-status.json','utf8')).public_configuration);process.env.AWS_SESSION_TOKEN='disabled';
const worker=neon(parseEnv(readFileSync(`${dir}/database-worker.env`,'utf8')).DATABASE_URL_UNPOOLED);
const id=randomUUID(),sid=randomUUID(),parent=randomUUID(),inv=randomUUID();
const source=process.env.RETRY_FIXTURE_SOURCE_ORDER||'8e3851eb-47a0-4ef3-8017-474338706762';
try{
 await owner.transaction([owner.query(`INSERT INTO submissions(id,capability_hash,idempotency_key,size,sha256,terms,expires_at) SELECT $1::uuid,capability_hash,$1::text,size,sha256,terms,expires_at FROM submissions WHERE id=(SELECT submission_id FROM orders WHERE id=$2)`,[sid,source]),owner.query(`INSERT INTO orders(id,submission_id,capability_hash,owner_wallet,status,paid_at,payment_receipt,payer_wallet,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages) SELECT $1::uuid,$2::uuid,capability_hash,owner_wallet,'processing_failed',CASE WHEN $4='expired' THEN clock_timestamp()-interval '121 seconds' WHEN $4='lockdeadline' THEN clock_timestamp()-interval '118 seconds' ELSE clock_timestamp() END,payment_receipt,payer_wallet,CASE WHEN $4='policy' THEN jsonb_set(terms,'{maxRetries}','0') ELSE terms END,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages FROM orders WHERE id=$3`,[id,sid,source,process.env.RETRY_FIXTURE_MODE||'success']),owner.query(`INSERT INTO execution_attempts(id,order_id,generation,state,stopped_at,publisher_finished_at,publication_fenced_at,final_output_check,deadline,invocation_id,output_publication) SELECT $1::uuid,$2::uuid,0,'stopped',clock_timestamp(),CASE WHEN $4='unknown' THEN NULL ELSE clock_timestamp() END,CASE WHEN $4='unknown' THEN NULL ELSE clock_timestamp() END,CASE WHEN $4 IN ('found','finalunknown') THEN 'unknown' ELSE 'absent' END,paid_at+(terms->>'deliverySeconds')::int*interval '1 second',$3,CASE WHEN $4='found' THEN (SELECT output_publication FROM execution_attempts WHERE order_id=$5::uuid AND output_publication IS NOT NULL LIMIT 1) ELSE NULL END FROM orders WHERE id=$2::uuid`,[parent,id,randomUUID(),process.env.RETRY_FIXTURE_MODE||'success',source])]);
 const before=(await owner.query('SELECT paid_at,terms FROM orders WHERE id=$1',[id]))[0];
 await worker.query('SELECT mend_agent_begin($1::uuid,$2::uuid)',[id,inv]);
 await mkdir('.retry-build',{recursive:true});const options={bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import{createRequire as ___cr}from'node:module';const require=___cr(import.meta.url);"}};
 await build({...options,entryPoints:['backend/conversion.ts'],outfile:'.retry-build/index.mjs'});await build({...options,entryPoints:['backend/parser.ts'],outfile:'.retry-build/parser.mjs'});
 const {default:service}=await import('../.retry-build/index.mjs');
 if(process.env.RETRY_FIXTURE_MODE==='storageerror'){process.env.AWS_ACCESS_KEY_ID='invalid-isolated-fixture';process.env.AWS_SECRET_ACCESS_KEY='invalid-isolated-fixture';}
 if(process.env.RETRY_FIXTURE_MODE==='unexpectedoutput'){await new S3Client({endpoint:process.env.AWS_ENDPOINT_URL_S3,region:process.env.AWS_REGION,forcePathStyle:true}).send(new PutObjectCommand({Bucket:process.env.OUTPUT_BUCKET,Key:`results/${id}/${parent}.txt`,Body:'Actual object without prepared metadata'}));}
 const request=()=>new Request('http://conversion/agent/retry',{method:'POST',headers:{Authorization:'Bearer '+process.env.AGENT_CONVERSION_SECRET,'Content-Type':'application/json'},body:JSON.stringify({invocationId:inv})});
 if(['lockdeadline','lockinvocation','stale','workerforge'].includes(process.env.RETRY_FIXTURE_MODE)){
  const mode=process.env.RETRY_FIXTURE_MODE;
  if(mode==='lockinvocation')await owner.query("UPDATE agent_invocations SET deadline=clock_timestamp()+interval '1 second' WHERE id=$1",[inv]);
  const proof=new Date(Date.now()-(mode==='stale'?11000:0)).toISOString();
  let blocked;
  if(mode.startsWith('lock')){blocked=owner.transaction([owner.query('SELECT id FROM orders WHERE id=$1 FOR UPDATE',[id]),owner.query('SELECT pg_sleep(3)')]);await new Promise(r=>setTimeout(r,350));}
  const role=neon((mode==='workerforge'?parseEnv(readFileSync(`${dir}/database-worker.env`,'utf8')):conversion).DATABASE_URL_UNPOOLED);
  let result;try{result=(await role.query('SELECT mend_agent_retry_claim($1::uuid,$2::uuid,$3::uuid,$4,$5::timestamptz) AS claim',[inv,parent,randomUUID(),randomUUID(),proof]))[0].claim;}catch{result={reason:mode==='workerforge'?'permission_denied':'invocation_expired'};}
  if(blocked)await blocked;
  console.log(JSON.stringify({result,generations:(await owner.query('SELECT generation FROM execution_attempts WHERE order_id=$1 ORDER BY generation',[id])).map(a=>a.generation)}));
 }else if(['expired','policy','unknown','found','storageerror','finalunknown','unexpectedoutput'].includes(process.env.RETRY_FIXTURE_MODE)){
  const response=await service.fetch(request());const result=await response.json();const attempts=await owner.query('SELECT generation FROM execution_attempts WHERE order_id=$1 ORDER BY generation',[id]);console.log(JSON.stringify({result,generations:attempts.map(a=>a.generation)}));
 }else if(process.env.RETRY_FIXTURE_MODE==='running'){
  await owner.query(`INSERT INTO execution_attempts(id,order_id,generation,state,deadline,invocation_id) SELECT $1::uuid,$2::uuid,1,'running',paid_at+(terms->>'deliverySeconds')::int*interval '1 second',$3 FROM orders WHERE id=$2::uuid`,[randomUUID(),id,randomUUID()]);
  const response=await service.fetch(new Request('http://conversion/reconcile',{method:'POST',headers:{Authorization:'Bearer '+process.env.CONVERSION_SERVICE_SECRET,'Content-Type':'application/json'},body:JSON.stringify({orderId:id})}));
  console.log(JSON.stringify({reconciliation:await response.json(),generations:[0,1]}));
 }else{
 const responses=await Promise.all([service.fetch(request()),service.fetch(request())]);
 const results=await Promise.all(responses.map(r=>r.json()));
 const retry=results.find(r=>r.status==='completed')||results[0];
 const replay=await(await service.fetch(request())).json();
 const convertReplay=await(await service.fetch(new Request('http://conversion/',{method:'POST',headers:{Authorization:'Bearer '+process.env.CONVERSION_SERVICE_SECRET,'Content-Type':'application/json'},body:JSON.stringify({orderId:id})}))).json();
 const attempts=await owner.query('SELECT generation,deadline FROM execution_attempts WHERE order_id=$1 ORDER BY generation',[id]);
 const after=(await owner.query('SELECT paid_at,terms FROM orders WHERE id=$1',[id]))[0];
 console.log(JSON.stringify({retry,replay,convertReplay,generations:attempts.map(a=>a.generation),deadlinePreserved:JSON.stringify(before)===JSON.stringify(after)&&attempts.every(a=>new Date(a.deadline).getTime()===new Date(before.paid_at).getTime()+before.terms.deliverySeconds*1000)}));
 }
}finally{
 const generated=await owner.query("SELECT output_publication->>'key' AS key FROM execution_attempts WHERE order_id=$1 AND output_publication->>'key' LIKE $2",[id,`results/${id}/%`]);
 if(process.env.RETRY_FIXTURE_MODE==='unexpectedoutput')generated.push({key:`results/${id}/${parent}.txt`});
 if(generated.length){const storage=parseEnv(readFileSync(`${dir}/storage-default.env`,'utf8')),client=new S3Client({endpoint:storage.AWS_ENDPOINT_URL_S3,region:storage.AWS_REGION,forcePathStyle:true,credentials:{accessKeyId:storage.AWS_ACCESS_KEY_ID,secretAccessKey:storage.AWS_SECRET_ACCESS_KEY}});for(const {key}of generated)await client.send(new DeleteObjectCommand({Bucket:process.env.OUTPUT_BUCKET,Key:key}));}
 await owner.transaction(['agent_actions','agent_calls','agent_invocations','recovery_cases','execution_attempts','orders'].map(table=>owner.query(`DELETE FROM ${table} WHERE ${table==='orders'?'id':'order_id'}=$1`,[id])));
 await owner.query('DELETE FROM submissions WHERE id=$1',[sid]);
}
