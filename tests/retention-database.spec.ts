import {test,expect} from '@playwright/test';
import {neon} from '@neondatabase/serverless';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {build} from 'esbuild';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
const env=parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/migration.env`,'utf8'));
const db=neon(env.DATABASE_URL_UNPOOLED);
test.beforeAll(async()=>{expect(['mend_ticket15_retention','mend_ticket15_reviewed_validation']).toContain((await db`SELECT current_database() AS name`)[0].name);});
const created:{id:string;submission:string}[]=[];
test.afterAll(async()=>{for(const o of created){await db`DELETE FROM result_downloads WHERE order_id=${o.id}`;await db`DELETE FROM refunds WHERE order_id=${o.id}`;await db`DELETE FROM postexpiry_output_checks WHERE order_id=${o.id}`;await db`DELETE FROM refund_checks WHERE order_id=${o.id}`;await db`DELETE FROM content_retention WHERE object_key IN (${`accepted/${o.submission}.pdf`},${`staging/${o.submission}.pdf`}) OR object_key LIKE ${`results/${o.id}/%`}`;await db`DELETE FROM execution_attempts WHERE order_id=${o.id}`;await db`DELETE FROM orders WHERE id=${o.id}`;await db`DELETE FROM submissions WHERE id=${o.submission}`;}});
async function order(expired=true){
 const id=randomUUID(),submission=randomUUID(),attempt=randomUUID();created.push({id,submission});
 await db`INSERT INTO submissions(id,capability_hash,idempotency_key,size,sha256,terms,created_at,expires_at) VALUES(${submission},${id},${id},4,${'a'.repeat(64)},'{}',clock_timestamp()-interval '8 days',clock_timestamp()+interval '1 hour')`;
 await db`INSERT INTO orders(id,submission_id,capability_hash,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages) VALUES(${id},${submission},${id},'{}',clock_timestamp()-interval '8 days',clock_timestamp()+interval '1 day',${`accepted/${submission}.pdf`},4,${'a'.repeat(64)},1)`;
 await db`UPDATE submissions SET expires_at=clock_timestamp()-interval '7 days' WHERE id=${submission}`;
 if(expired){await db`UPDATE orders SET upload_expires_at=clock_timestamp()-interval '1 day' WHERE id=${id}`;await db`UPDATE content_retention SET expires_at=clock_timestamp()-interval '1 day' WHERE kind='upload' AND object_key=${`accepted/${submission}.pdf`}`;}
 return {id,submission,attempt,key:`results/${id}/${attempt}.txt`};
}
test('expiry inventories unpaid originals and abandoned keys without changing the obligation or clocks',async()=>{
 const o=await order();const before=(await db`SELECT to_jsonb(orders) AS record FROM orders WHERE id=${o.id}`)[0].record;
 for(let i=0;i<20;i++){await db`SELECT mend_retention_claim()`;const pending=await db`SELECT 1 FROM content_retention WHERE object_key IN (${`accepted/${o.submission}.pdf`},${`staging/${o.submission}.pdf`}) AND tombstoned_at IS NULL`;if(!pending.length)break;} 
 const rows=await db`SELECT kind,object_key,tombstoned_at FROM content_retention WHERE object_key IN (${`accepted/${o.submission}.pdf`},${`staging/${o.submission}.pdf`})`;
 expect(rows).toHaveLength(2);expect(rows.every(r=>!!r.tombstoned_at)).toBe(true);
 await db`SELECT mend_retention_finish('upload',${`accepted/${o.submission}.pdf`},'storage_unknown')`;
 expect((await db`SELECT deleted_at,failure FROM content_retention WHERE kind='upload' AND object_key=${`accepted/${o.submission}.pdf`}`)[0]).toMatchObject({deleted_at:null,failure:'storage_unknown'});
 expect((await db`SELECT to_jsonb(orders) AS record FROM orders WHERE id=${o.id}`)[0].record).toEqual(before);
});
test('independent result clocks remain fixed after repeated verification and deletion cannot authorize delivery',async()=>{
 const o=await order(false),at=new Date(Math.floor(Date.now()/1000)*1000).toISOString();
 const publication={state:'prepared',key:o.key,sha256:'b'.repeat(64),size:4,preparedAt:at};
 await db`INSERT INTO execution_attempts(id,order_id,generation,state,output_publication) VALUES(${o.attempt},${o.id},0,'running',${JSON.stringify(publication)}::jsonb)`;
 const first=(await db`SELECT mend_retention_clock(${o.attempt}::uuid,${at}::timestamptz) AS clock`)[0].clock;
 expect((await db`SELECT mend_retention_clock(${o.attempt}::uuid,${at}::timestamptz) AS clock`)[0].clock).toEqual(first);
 await expect(db`SELECT mend_retention_clock(${o.attempt}::uuid,${new Date(Date.parse(at)+1000).toISOString()}::timestamptz)`).rejects.toThrow();
 expect((await db`SELECT mend_postexpiry_check(${o.id}::uuid,${JSON.stringify([o.attempt])}::jsonb) AS valid`)[0].valid).toBe(false);
});
test('content runtime deletes upload then output at independent deadlines, retries late writes and preserves delivered records',async()=>{
 const {createServer}=await import('node:http');
 const o=await order(),key=`/upload/accepted/${o.submission}.pdf`,unrelated='/upload/accepted/unrelated.pdf';
 const outputKey=`/output/${o.key}`,expiresAt=new Date(Date.now()+10000).toISOString(),createdAt=new Date(Date.parse(expiresAt)-7*86400000).toISOString();
 const result={key:o.key,createdAt,expiresAt,sha256:'b'.repeat(64),size:4,verifiedAt:new Date().toISOString()};
 await db`INSERT INTO content_retention(kind,object_key,created_at,expires_at) VALUES('output',${o.key},${createdAt},${expiresAt})`;
 await db`UPDATE orders SET delivered_at=clock_timestamp(),disposition='delivered',status='delivered',payment_transaction=${'0x'+o.id.replaceAll('-','').repeat(2)},payment_receipt='{"status":"success","blockNumber":"1"}'::jsonb,result=${JSON.stringify(result)}::jsonb WHERE id=${o.id}`;
 const before=(await db`SELECT to_jsonb(orders) AS record FROM orders WHERE id=${o.id}`)[0].record;
 const objects=new Map([[key,Buffer.from('private original')],[outputKey,Buffer.from('text')],[unrelated,Buffer.from('unrelated')]]);
 let releaseWrite!:()=>void,writeStarted!:()=>void;const hold=new Promise<void>(r=>releaseWrite=r),started=new Promise<void>(r=>writeStarted=r);
 const server=createServer(async(req,res)=>{const path=new URL(req.url!,'http://fixture').pathname;if(req.method==='PUT'){const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);writeStarted();await hold;objects.set(path,Buffer.concat(chunks));res.end();return;}if(req.method==='DELETE'){objects.delete(path);res.statusCode=204;res.end();return;}const bytes=objects.get(path);if(!bytes){res.statusCode=404;res.end();return;}res.setHeader('Content-Length',bytes.length);res.end(req.method==='HEAD'?undefined:bytes);});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const endpoint=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
 const conversion=parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/database-conversion.env`,'utf8'));
 const secret='isolated-retention-service-'.repeat(3);
 Object.assign(process.env,{DATABASE_URL:conversion.DATABASE_URL_UNPOOLED,AWS_ENDPOINT_URL_S3:endpoint,AWS_REGION:'us-east-1',AWS_ACCESS_KEY_ID:'owned-fixture',AWS_SECRET_ACCESS_KEY:'owned-fixture',UPLOAD_BUCKET:'upload',OUTPUT_BUCKET:'output',CONVERSION_SERVICE_SECRET:secret});
 let service:Awaited<ReturnType<typeof conversionProcess>>|undefined;
 try{
  service=await conversionProcess();
  async function sweep(){return fetch(service!.url+'/retention',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({orderId:o.id})});}
  const pendingWrite=fetch(endpoint+key,{method:'PUT',body:'late in-flight write'});await started;
  // Existing due rows from earlier cases make bounded batches realistic.
  for(let i=0;i<3&&objects.has(key);i++)expect((await sweep()).status).toBe(200);
  expect((await fetch(endpoint+key)).status).toBe(404);expect((await fetch(endpoint+outputKey)).status).toBe(200);expect((await fetch(endpoint+unrelated)).status).toBe(200);
  expect((await db`SELECT deleted_at FROM content_retention WHERE object_key=${key.slice('/upload/'.length)}`)[0].deleted_at).toBeTruthy();
  releaseWrite();expect((await pendingWrite).status).toBe(200);expect((await fetch(endpoint+key)).status).toBe(200);
  for(let i=0;i<3&&objects.has(key);i++)expect((await sweep()).status).toBe(200);
  expect((await fetch(endpoint+key)).status).toBe(404);
  // The later output deadline is independent of the already expired upload.
  await new Promise(r=>setTimeout(r,Math.max(0,Date.parse(expiresAt)-Date.now()+100)));
  for(let i=0;i<3&&objects.has(outputKey);i++)expect((await sweep()).status).toBe(200);
  expect((await fetch(endpoint+outputKey)).status).toBe(404);
  expect((await db`SELECT deleted_at FROM content_retention WHERE kind='output' AND object_key=${o.key}`)[0].deleted_at).toBeTruthy();
  expect((await db`SELECT to_jsonb(orders) AS record FROM orders WHERE id=${o.id}`)[0].record).toEqual(before);
  const registrarEnv=parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/database-registrar.env`,'utf8')),registrar=neon(registrarEnv.DATABASE_URL_UNPOOLED);
  expect((await registrar`SELECT mend_refund_fence(${o.id}::uuid) AS result`)[0].result).toMatchObject({reason:'delivery_preferred'});
  expect((await db`SELECT count(*)::int AS n FROM refunds WHERE order_id=${o.id}`)[0].n).toBe(0);
 }finally{releaseWrite();await service?.close();server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});

async function conversionProcess(){
 const artifact=mkdtempSync(join(tmpdir(),'mend-retention15-'));
 await build({absWorkingDir:artifact,entryPoints:[resolve('backend/conversion.ts')],outfile:join(artifact,'conversion.mjs'),bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import{createRequire as ___cr}from'node:module';const require=___cr(import.meta.url);"}});
 writeFileSync(join(artifact,'runner.mjs'),`import {createServer} from 'node:http';import service from './conversion.mjs';createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const response=await service.fetch(new Request('http://owned'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('{}');}}).listen(0,'127.0.0.1',function(){console.log('READY:'+this.address().port)});`);
 const child=spawn(process.execPath,[join(artifact,'runner.mjs')],{env:process.env,stdio:['ignore','pipe','pipe']});
 const url=await new Promise<string>((resolve,reject)=>{child.stdout.on('data',b=>{const m=/READY:(\d+)/.exec(String(b));if(m)resolve('http://127.0.0.1:'+m[1]);});child.once('exit',()=>reject(Error('Owned conversion exited')));});
 return {url,async close(){if(child.exitCode===null){const exited=new Promise<void>(r=>child.once('exit',()=>r()));child.kill('SIGTERM');await exited;}rmSync(artifact,{recursive:true,force:true});}};
}
test('only stopped, never delivered output gets a fresh separate postexpiry absence assessment',async()=>{
 const o=await order(),old=new Date(Date.now()-8*86400000).toISOString();
 const publication={state:'prepared',key:o.key,sha256:'b'.repeat(64),size:4,preparedAt:old};
 await db`INSERT INTO execution_attempts(id,order_id,generation,state,output_publication,stopped_at,publisher_finished_at,publication_fenced_at,final_output_check) VALUES(${o.attempt},${o.id},0,'stopped',${JSON.stringify(publication)}::jsonb,clock_timestamp(),clock_timestamp(),clock_timestamp(),'unknown')`;
 await db`SELECT mend_retention_clock(${o.attempt}::uuid,${old}::timestamptz)`;
 await db`UPDATE content_retention SET tombstoned_at=clock_timestamp(),deleted_at=clock_timestamp(),checked_at=clock_timestamp() WHERE kind='output' AND object_key=${o.key}`;
 const {createServer}=await import('node:http');let status=404;
 const server=createServer((req,res)=>{res.statusCode=status;res.setHeader('Content-Type','application/xml');res.end('<Error><Code>NoSuchKey</Code></Error>');});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const secret='isolated-retention-registrar-'.repeat(3);
 Object.assign(process.env,{REGISTRAR_CONVERSION_SECRET:secret,AWS_ENDPOINT_URL_S3:`http://127.0.0.1:${(server.address() as {port:number}).port}`});
 const service=await conversionProcess();
 async function check(){return fetch(service.url+'/registrar/check',{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({orderId:o.id})});}
 try{
  expect(await(await check()).json()).toMatchObject({outcome:'absent'});
  expect((await db`SELECT count(*)::int AS n FROM postexpiry_output_checks WHERE order_id=${o.id}`)[0].n).toBe(1);
  expect((await db`SELECT final_output_check,output_publication FROM execution_attempts WHERE id=${o.attempt}`)[0]).toMatchObject({final_output_check:'unknown',output_publication:publication});
  // Absence is not payment authority, and never creates an entitlement itself.
  expect((await db`SELECT mend_refund_fence(${o.id}::uuid) AS result`)[0].result).toMatchObject({reason:'payment_unknown'});
  expect((await db`SELECT count(*)::int AS n FROM refunds WHERE order_id=${o.id}`)[0].n).toBe(0);
  // Any attempt-set change invalidates the immutable identity immediately.
  const retry=randomUUID();await db`INSERT INTO execution_attempts(id,order_id,generation,state) VALUES(${retry},${o.id},1,'running')`;
  expect((await db`SELECT mend_postexpiry_valid(${o.id}::uuid) AS valid`)[0].valid).toBe(false);
  expect(await(await check()).json()).toMatchObject({outcome:'unknown'});
  await db`DELETE FROM execution_attempts WHERE id=${retry}`;
  status=403;expect(await(await check()).json()).toMatchObject({outcome:'unknown'});
  status=404;await db`UPDATE orders SET delivered_at=clock_timestamp() WHERE id=${o.id}`;
  expect(await(await check()).json()).toMatchObject({outcome:'delivery'});
  expect((await db`SELECT mend_refund_fence(${o.id}::uuid) AS result`)[0].result).toMatchObject({reason:'delivery_preferred'});
 }finally{await service.close();await new Promise<void>(r=>server.close(()=>r()));}
});

test('fresh trusted postexpiry absence permits the separate registrar normal original-payer fence',async()=>{
 const o=await order(),old=new Date(Date.now()-8*86400000).toISOString();
 const publication={state:'prepared',key:o.key,sha256:'b'.repeat(64),size:4,preparedAt:old};
 await db`INSERT INTO execution_attempts(id,order_id,generation,state,output_publication,stopped_at,publisher_finished_at,publication_fenced_at,final_output_check) VALUES(${o.attempt},${o.id},0,'stopped',${JSON.stringify(publication)}::jsonb,clock_timestamp(),clock_timestamp(),clock_timestamp(),'unknown')`;
 await db`SELECT mend_retention_clock(${o.attempt}::uuid,${old}::timestamptz)`;
 await db`UPDATE content_retention SET tombstoned_at=clock_timestamp(),deleted_at=clock_timestamp() WHERE kind='output' AND object_key=${o.key}`;
 expect((await db`SELECT mend_postexpiry_check(${o.id}::uuid,${JSON.stringify([o.attempt])}::jsonb) AS valid`)[0].valid).toBe(true);
 await db`SELECT mend_refund_output_check(${o.id}::uuid,${JSON.stringify([o.attempt])}::jsonb,'absent')`;
  const {purchasedTerms,defaultPolicy}=await import('../lib/server/terms');
  const transaction='0x'+o.id.replaceAll('-','').repeat(2),payer='0x'+'11'.repeat(20),terms=purchasedTerms(defaultPolicy,'retention-isolated-authority');
  await db`UPDATE orders SET paid_at=clock_timestamp()-interval '8 days',payer_wallet=${payer},payment_transaction=${transaction},payment_receipt=${JSON.stringify({status:'success',blockNumber:'1',blockHash:'0x'+'12'.repeat(32),amountAtomic:'1000000',decimals:6,gasUsed:'1',effectiveGasPrice:'1'})}::jsonb,terms=${JSON.stringify(terms)}::jsonb WHERE id=${o.id}`;
  const registrarEnv=parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/database-registrar.env`,'utf8')),registrar=neon(registrarEnv.DATABASE_URL_UNPOOLED);
  const payment={transaction,payer,amountAtomic:'1000000',chainId:'5042002',checkedAt:new Date().toISOString()};
  // A newer observation must invalidate both the immutable proof and the still-fresh refund check.
  for(const outcome of ['object_present','storage_unknown']){
   if(outcome==='storage_unknown'){
    const held=db.transaction([db`SELECT mend_retention_finish('output',${o.key},${outcome})`,db`SELECT pg_sleep(2)`]);
    await expect.poll(async()=>(await db`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep'`)[0].n).toBeGreaterThan(0);
    const fence=registrar`SELECT mend_refund_fence(${o.id}::uuid,${JSON.stringify({...payment,checkedAt:new Date().toISOString()})}::jsonb) AS result`;
    expect(await Promise.race([fence.then(()=> 'finished'),new Promise<string>(r=>setTimeout(()=>r('waiting'),100))])).toBe('waiting');
    await held;expect((await fence)[0].result).toMatchObject({reason:'output_unknown'});
   }else await db`SELECT mend_retention_finish('output',${o.key},${outcome})`;
   expect((await db`SELECT mend_postexpiry_valid(${o.id}::uuid) AS valid`)[0].valid).toBe(false);
   expect((await registrar`SELECT mend_refund_fence(${o.id}::uuid,${JSON.stringify({...payment,checkedAt:new Date().toISOString()})}::jsonb) AS result`)[0].result).toMatchObject({reason:'output_unknown'});
   expect((await db`SELECT outcome FROM refund_checks WHERE order_id=${o.id}`)[0].outcome).toBe('absent');
   await db`SELECT mend_retention_finish('output',${o.key},'absent')`;
   expect((await db`SELECT mend_postexpiry_check(${o.id}::uuid,${JSON.stringify([o.attempt])}::jsonb) AS valid`)[0].valid).toBe(true);
   await db`SELECT mend_refund_output_check(${o.id}::uuid,${JSON.stringify([o.attempt])}::jsonb,'absent')`;
  }
  const grant=(await registrar`SELECT mend_refund_fence(${o.id}::uuid,${JSON.stringify(payment)}::jsonb) AS result`)[0].result;
  expect(grant).toMatchObject({order_id:o.id,payer,amount_atomic:'1000000',state:'registration_pending'});

});

test('inventory before finalize promotes only the provisional original clock',async()=>{
 const id=randomUUID(),submission=randomUUID();created.push({id,submission});
 await db`INSERT INTO submissions(id,capability_hash,idempotency_key,size,sha256,terms,created_at,expires_at) VALUES(${submission},${id},${id},4,${'a'.repeat(64)},'{}',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour')`;
 await db`SELECT mend_retention_inventory()`;
 expect((await db`SELECT created_at FROM content_retention WHERE kind='upload' AND object_key=${`accepted/${submission}.pdf`}`)[0].created_at).toBeNull();
 const clock=new Date(Math.floor(Date.now()/1000)*1000).toISOString(),expiry=new Date(Date.parse(clock)+7*86400000).toISOString();
 await db`INSERT INTO orders(id,submission_id,capability_hash,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages) VALUES(${id},${submission},${id},'{}',${clock},${expiry},${`accepted/${submission}.pdf`},4,${'a'.repeat(64)},1)`;
 const ledger=(await db`SELECT created_at,expires_at FROM content_retention WHERE kind='upload' AND object_key=${`accepted/${submission}.pdf`}`)[0];
 expect(new Date(ledger.created_at).toISOString()).toBe(clock);expect(new Date(ledger.expires_at).toISOString()).toBe(expiry);
 await db`SELECT mend_retention_inventory()`;
 expect((await db`SELECT created_at,expires_at FROM content_retention WHERE kind='upload' AND object_key=${`accepted/${submission}.pdf`}`)[0]).toEqual(ledger);
});
test('future output clocks and future absence assessments cannot authorize publication',async()=>{
 const o=await order(false),at=new Date().toISOString();
 await db`INSERT INTO execution_attempts(id,order_id,generation,state,output_publication) VALUES(${o.attempt},${o.id},0,'running',${JSON.stringify({state:'prepared',key:o.key,sha256:'b'.repeat(64),size:4,preparedAt:at})}::jsonb)`;
 await expect(db`SELECT mend_retention_clock(${o.attempt}::uuid,clock_timestamp()+interval '1 day')`).rejects.toThrow('retention_clock_unknown');
 await db`INSERT INTO postexpiry_output_checks(order_id,checked_at,identity) VALUES(${o.id},clock_timestamp()+interval '1 day',mend_retention_identity(${o.id}::uuid))`;
 expect((await db`SELECT mend_postexpiry_valid(${o.id}::uuid) AS valid`)[0].valid).toBe(false);
 await db`UPDATE postexpiry_output_checks SET checked_at=clock_timestamp()-interval '1 minute' WHERE order_id=${o.id}`;
 expect((await db`SELECT mend_postexpiry_valid(${o.id}::uuid) AS valid`)[0].valid).toBe(false);
});

test('real Next and SIWE owner downloads stop at the separate result expiry while records survive',async({playwright,browser})=>{
 const {privateKeyToAccount}=await import('viem/accounts'),{createHash}=await import('node:crypto'),{createServer}=await import('node:http');
 const signer=privateKeyToAccount(`0x${'11'.repeat(32)}`),origin='http://127.0.0.1:3056',bytes=Buffer.from('Owned private text result.');
 const storage=createServer((req,res)=>{res.setHeader('Content-Length',bytes.length);res.end(req.method==='HEAD'?undefined:bytes);});await new Promise<void>(r=>storage.listen(0,'127.0.0.1',r));
 const web=parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/database-web.env`,'utf8'));
 const child=spawn(process.execPath,[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port','3056'],{cwd:process.cwd(),env:{...process.env,...web,DATABASE_URL:web.DATABASE_URL_UNPOOLED,APP_ORIGIN:origin,SESSION_SECRET:'isolated-retention-next-session-'.repeat(3),OPERATOR_WALLET_ADDRESS:signer.address.toLowerCase(),AWS_REGION:'us-east-1',AWS_ACCESS_KEY_ID:'owned-fixture',AWS_SECRET_ACCESS_KEY:'owned-fixture',OUTPUT_BUCKET:'output',AWS_ENDPOINT_URL_S3:`http://127.0.0.1:${(storage.address() as {port:number}).port}`},stdio:'ignore'});
 const request=await playwright.request.newContext({baseURL:origin});
 try{
  await expect.poll(async()=>{try{return(await request.get('/api/auth/session')).status();}catch{return 0;}},{timeout:60000}).toBe(401);
  const issued=await(await request.post('/api/auth/challenge',{headers:{Origin:origin},data:{address:signer.address,chainId:5042002}})).json();
  expect((await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature:await signer.signMessage({message:issued.message})}})).status()).toBe(200);
  const o=await order(),expires=new Date(Date.now()+15000).toISOString(),createdAt=new Date(Date.parse(expires)-7*86400000).toISOString(),sha=createHash('sha256').update(bytes).digest('hex');
  const {purchasedTerms,defaultPolicy}=await import('../lib/server/terms');
  const result={key:o.key,createdAt,expiresAt:expires,sha256:sha,size:bytes.length,verifiedAt:new Date().toISOString()};
  await db`INSERT INTO content_retention(kind,object_key,created_at,expires_at) VALUES('output',${o.key},${createdAt},${expires})`;
  await db`UPDATE orders SET owner_wallet=${signer.address.toLowerCase()},payer_wallet=${signer.address.toLowerCase()},paid_at=clock_timestamp(),delivered_at=clock_timestamp(),disposition='delivered',status='delivered',terms=${JSON.stringify(purchasedTerms(defaultPolicy,'isolated-retention-next'))}::jsonb,result=${JSON.stringify(result)}::jsonb WHERE id=${o.id}`;
  for(let i=0;i<2;i++){const download=await request.get(`/api/orders/${o.id}/result`);expect(download.status()).toBe(200);expect(await download.body()).toEqual(bytes);}
  const before=(await db`SELECT upload_created_at,upload_expires_at,result,delivered_at,disposition FROM orders WHERE id=${o.id}`)[0];
  expect(new Date(before.upload_expires_at).getTime()).toBeLessThan(Date.parse(createdAt)+7*86400000);
  expect((await db`SELECT count(*)::int AS n FROM result_downloads WHERE order_id=${o.id}`)[0].n).toBe(2);
  await expect.poll(()=>Date.now()>=Date.parse(expires),{timeout:20000,intervals:[500]}).toBe(true);
  expect((await request.get(`/api/orders/${o.id}/result`)).status()).toBe(410);
  expect((await db`SELECT upload_created_at,upload_expires_at,result,delivered_at,disposition FROM orders WHERE id=${o.id}`)[0]).toEqual(before);
  expect((await db`SELECT count(*)::int AS n FROM result_downloads WHERE order_id=${o.id}`)[0].n).toBe(2);
  expect((await request.get('/api/operator/service')).status()).toBe(200);
  const context=await browser.newContext(),page=await context.newPage();page.setDefaultTimeout(10000);
  try{const {wallet}=await import('./wallet-fixture');await wallet(page);await page.goto(origin+'/recovery');await page.waitForTimeout(1500);await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Private file cleanup'})).toBeVisible();
   for(const width of [1280,390]){await page.setViewportSize({width,height:900});await expect(page.getByText(/expired files awaiting confirmed deletion/)).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
  }finally{await context.close();}
  await db`DELETE FROM result_downloads WHERE order_id=${o.id}`;
 }finally{await request.dispose();if(child.exitCode===null){const exited=new Promise<void>(r=>child.once('exit',()=>r()));child.kill('SIGTERM');await exited;}await new Promise<void>(r=>storage.close(()=>r()));}
});

test('held cleanup row lock fences a concurrently attempted result publication',async()=>{
 const o=await order(false),at=new Date(Math.floor(Date.now()/1000)*1000).toISOString();
 const publication={state:'prepared',key:o.key,sha256:'b'.repeat(64),size:4,preparedAt:at};
 await db`INSERT INTO execution_attempts(id,order_id,generation,state,output_publication) VALUES(${o.attempt},${o.id},0,'running',${JSON.stringify(publication)}::jsonb)`;
 const clock=(await db`SELECT mend_retention_clock(${o.attempt}::uuid,${at}::timestamptz) AS clock`)[0].clock;
 const held=db.transaction([db`UPDATE content_retention SET tombstoned_at=clock_timestamp() WHERE kind='output' AND object_key=${o.key}`,db`SELECT pg_sleep(2)`]);
 await expect.poll(async()=>(await db`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep'`)[0].n).toBeGreaterThan(0);
 const result={...publication,...clock,verifiedAt:at};
 const publish=db`UPDATE orders SET result=${JSON.stringify(result)}::jsonb WHERE id=${o.id}`.then(()=> 'published',()=> 'rejected');
 expect(await Promise.race([publish,new Promise<string>(r=>setTimeout(()=>r('waiting'),100))])).toBe('waiting');
 await held;expect(await publish).toBe('rejected');
 expect((await db`SELECT result,delivered_at FROM orders WHERE id=${o.id}`)[0]).toMatchObject({result:null,delivered_at:null});
});

test('runtime grants restrict content mutation and assessments to their intended services',async()=>{
 const rows=await db`SELECT rolname AS role,has_function_privilege(rolname,'public.mend_retention_claim()','EXECUTE') AS cleanup,has_function_privilege(rolname,'public.mend_postexpiry_check(uuid,jsonb)','EXECUTE') AS assessment,has_function_privilege(rolname,'public.mend_retention_status()','EXECUTE') AS status,has_table_privilege(rolname,'public.content_retention','UPDATE') AS mutation,has_table_privilege(rolname,'public.postexpiry_output_checks','INSERT') AS evidence FROM pg_roles WHERE rolname IN ('mend_web','mend_worker','mend_conversion','mend_registrar','mend_refund_worker','mend_payment_reconciler')`;
 expect(rows).toHaveLength(6);
 for(const row of rows){expect(row.cleanup).toBe(row.role==='mend_conversion');expect(row.assessment).toBe(row.role==='mend_conversion');expect(row.status).toBe(row.role==='mend_web');expect(row.mutation).toBe(false);expect(row.evidence).toBe(false);}
});

test('held order and attempt transaction rejects a concurrent stale absence identity',async()=>{
 const o=await order(),old=new Date(Date.now()-8*86400000).toISOString();
 await db`INSERT INTO execution_attempts(id,order_id,generation,state,stopped_at,publisher_finished_at,publication_fenced_at,final_output_check) VALUES(${o.attempt},${o.id},0,'stopped',${old},${old},${old},'absent')`;
 const retry=randomUUID();
 const held=db.transaction([db`SELECT id FROM orders WHERE id=${o.id} FOR UPDATE`,db`INSERT INTO execution_attempts(id,order_id,generation,state) VALUES(${retry},${o.id},1,'running')`,db`SELECT pg_sleep(2)`]);
 await expect.poll(async()=>(await db`SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event='PgSleep'`)[0].n).toBeGreaterThan(0);
 const check=db`SELECT mend_postexpiry_check(${o.id}::uuid,${JSON.stringify([o.attempt])}::jsonb) AS valid`;
 expect(await Promise.race([check.then(()=> 'finished'),new Promise<string>(r=>setTimeout(()=>r('waiting'),100))])).toBe('waiting');
 await held;expect((await check)[0].valid).toBe(false);
 expect((await db`SELECT count(*)::int AS n FROM postexpiry_output_checks WHERE order_id=${o.id}`)[0].n).toBe(0);
});

test('accepted-copy completion after the submission deadline cannot publish an order',async()=>{
 const id=randomUUID(),submission=randomUUID();created.push({id,submission});
 await db`INSERT INTO submissions(id,capability_hash,idempotency_key,size,sha256,terms,expires_at) VALUES(${submission},${id},${id},4,${'a'.repeat(64)},'{}',clock_timestamp()-interval '1 second')`;
 await db`SELECT mend_retention_inventory()`;
 await expect(db`INSERT INTO orders(id,submission_id,capability_hash,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages) VALUES(${id},${submission},${id},'{}',clock_timestamp(),clock_timestamp()+interval '7 days',${`accepted/${submission}.pdf`},4,${'a'.repeat(64)},1)`).rejects.toThrow('submission_expired');
 expect((await db`SELECT count(*)::int AS n FROM orders WHERE id=${id}`)[0].n).toBe(0);
});
