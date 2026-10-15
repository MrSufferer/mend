import {test,expect} from '@playwright/test';
import {healthFixture,origin,owner,signIn} from './health-fixture';
let fixture:Awaited<ReturnType<typeof healthFixture>>;
test.beforeAll(async()=>{fixture=await healthFixture();});
test.afterAll(async()=>{await fixture?.cleanup();});
test('operator proves real PDF execution and authenticated private retrieval; health alone never resumes',async({request})=>{
 await signIn(request);
 expect((await request.post('/api/operator/service',{headers:{Origin:origin},data:{reason:'Owned isolated health acceptance'}})).status()).toBe(200);
 const before=(await owner()`SELECT count(*)::int AS n FROM orders`)[0].n;
 const response=await request.post('/api/operator/service/health',{headers:{Origin:origin},data:{}});
 expect(response.status()).toBe(200);
 const health=await response.json();expect(health.status).toBe('running');expect(health.components.validation.status).toBe('passed');expect(health.components.parser.status).toBe('passed');expect(health.components.storage.status).toBe('passed');expect(health.components.payment.status).toBe('passed');expect(health.components.capacity.status).toBe('passed');expect(health.components.retrieval.status).toBe('pending');
 const result=await request.get(`/api/operator/service/health/${health.id}/result`);expect(result.status()).toBe(200);expect(result.headers()['cache-control']).toContain('private');expect(await result.text()).toMatch(/Mend health [a-f0-9]{32}/);
 const current=await(await request.get(`/api/operator/service/health/${health.id}`)).json();expect(current.status).toBe('passed');expect(current.components.retrieval.at).toBeTruthy();
 expect((await(await request.get('/api/operator/service')).json()).availability.paused).toBe(true);
 expect((await owner()`SELECT count(*)::int AS n FROM orders`)[0].n).toBe(before);expect(fixture.effects).toMatchObject({verify:0,settle:0,inputWrites:1,outputWrites:1});
});
async function passed(request:import('@playwright/test').APIRequestContext){
 const response=await request.post('/api/operator/service/health',{headers:{Origin:origin},data:{}});expect(response.status()).toBe(200);const h=await response.json();
 expect((await request.get(`/api/operator/service/health/${h.id}/result`)).status()).toBe(200);return (await request.get(`/api/operator/service/health/${h.id}`)).json();
}
test('resume deliberately repeats actual execution and atomically opens only after fresh authenticated retrieval',async({request})=>{
 await signIn(request);const health=await passed(request),writes=fixture.effects.outputWrites;
 const begin=await request.post('/api/operator/service/resume',{headers:{Origin:origin},data:{healthId:health.id}});expect(begin.status()).toBe(200);
 const recheck=await begin.json();expect(recheck.id).not.toBe(health.id);expect(recheck.purpose).toBe('resume_recheck');expect(fixture.effects.outputWrites).toBe(writes+1);
 expect((await(await request.get('/api/operator/service')).json()).availability.paused).toBe(true);
 expect((await request.post('/api/operator/service/resume',{headers:{Origin:origin},data:{healthId:health.id,recheckId:recheck.id}})).status()).toBe(409);
 expect((await request.get(`/api/operator/service/health/${recheck.id}/result`)).status()).toBe(200);
 const resumed=await request.post('/api/operator/service/resume',{headers:{Origin:origin},data:{healthId:health.id,recheckId:recheck.id}});expect(resumed.status()).toBe(200);expect((await resumed.json()).availability.paused).toBe(false);
 expect(fixture.effects.verify+fixture.effects.settle).toBe(0);
 // A later pause cannot be reopened by replaying either old proof.
 await request.post('/api/operator/service',{headers:{Origin:origin},data:{reason:'Later owned pause after resume'}});
 expect((await request.post('/api/operator/service/resume',{headers:{Origin:origin},data:{healthId:health.id,recheckId:recheck.id}})).status()).toBe(409);
});
test('a passed badge immediately becomes stale when pause, failure or backlog generations change',async({request})=>{
 await signIn(request);
 for(const change of ["UPDATE service_availability SET failure_generation=failure_generation+1 WHERE id='merchant'","UPDATE refund_capacity SET version=version+1 WHERE id='merchant'","UPDATE service_availability SET generation=generation+1,paused_at=clock_timestamp() WHERE id='merchant'"]){
  const health=await passed(request);await owner().query(change);
  expect((await(await request.get(`/api/operator/service/health/${health.id}`)).json()).status).toBe('stale');
  expect((await request.post('/api/operator/service/resume',{headers:{Origin:origin},data:{healthId:health.id}})).status()).toBe(409);
 }
});
test('unhealthy document storage, unsupported payment and noncanonical RPC never pass or resume',async({request})=>{
 await signIn(request);
 for(const setting of [{corruptOutput:true},{missingOutput:true},{support:false},{chain:1},{blockAge:121}]){
  Object.assign(fixture.settings,setting);
  try{
   const response=await request.post('/api/operator/service/health',{headers:{Origin:origin},data:{}});expect(response.status()).toBe(200);const h=await response.json();expect(['failed','unknown']).toContain(h.status);
   expect((await request.get(`/api/operator/service/health/${h.id}/result`)).status()).not.toBe(200);
   expect((await request.post('/api/operator/service/resume',{headers:{Origin:origin},data:{healthId:h.id}})).status()).toBe(409);
   expect((await(await request.get('/api/operator/service')).json()).availability.paused).toBe(true);
  }finally{Object.assign(fixture.settings,{corruptOutput:false,missingOutput:false,support:true,chain:5042002,blockAge:0});}
 }
 expect(fixture.effects.verify+fixture.effects.settle).toBe(0);
});
test('operator session, strict bodies, origin and distinct peer credentials are enforced at actual HTTP boundaries',async({request,playwright})=>{
 const anonymous=await playwright.request.newContext({baseURL:origin});
 try{
  expect((await anonymous.post('/api/operator/service/health',{headers:{Origin:origin},data:{}})).status()).toBe(401);
  await signIn(anonymous,'22');expect((await anonymous.post('/api/operator/service/health',{headers:{Origin:origin},data:{}})).status()).toBe(403);
  await signIn(request);
  expect((await request.post('/api/operator/service/health',{headers:{Origin:'https://other.invalid'},data:{}})).status()).toBe(403);
  expect((await request.post('/api/operator/service/health',{headers:{Origin:origin},data:{passed:true}})).status()).toBe(400);
  const h=await passed(request);expect((await anonymous.get(`/api/operator/service/health/${h.id}/result`)).status()).toBe(403);
  const {healthSecrets}=await import('./health-fixture');
  for(const [url,path,secret] of [[fixture.conversion,'/health/execute',healthSecrets.conversion],[fixture.registrar,'/health/check',healthSecrets.registrar]]){
   expect((await request.post(url+path,{data:{runId:h.id}})).status()).toBe(401);
   expect((await request.post(url+path,{headers:{Authorization:'Bearer legacy-service-unrelated-'.repeat(3)},data:{runId:h.id}})).status()).toBe(401);
   expect((await request.post(url+path,{headers:{Authorization:`Bearer ${secret}`},data:{runId:h.id,evidence:{passed:true}}})).status()).toBe(400);
   expect((await request.post(url+(url===fixture.registrar?'/register':'/'),{headers:{Authorization:`Bearer ${secret}`},data:{orderId:h.id}})).status()).toBe(401);
  }
  await request.post('/api/auth/logout',{headers:{Origin:origin}});expect((await request.get(`/api/operator/service/health/${h.id}/result`)).status()).toBe(401);
 }finally{await anonymous.dispose();}
});
test('expired and abandoned health work becomes durable unknown and its private artifacts are actually deleted',async({request})=>{
 await signIn(request);const health=await passed(request);
 const input=`/health-uploads/health/${health.id}/input.pdf`,output=`/health-outputs/health/${health.id}/result.txt`;
 expect(fixture.objects.has(input)).toBe(true);expect(fixture.objects.has(output)).toBe(true);
 fixture.objects.set('/health-outputs/results/customer-owned.txt',{bytes:Buffer.from('Owned customer fixture'),at:new Date()});
 await owner().query(`UPDATE service_health_runs SET status='running',deadline=clock_timestamp()-interval '1 second',expires_at=clock_timestamp()-interval '1 second' WHERE id=$1`,[health.id]);
 expect((await request.get(`/api/operator/service/health/${health.id}/result`)).status()).not.toBe(200);
 const {healthSecrets}=await import('./health-fixture');
 await expect.poll(async()=>{const cleaned=await request.post(fixture.conversion+'/health/cleanup',{headers:{Authorization:`Bearer ${healthSecrets.conversion}`},data:{}});expect(cleaned.status()).toBe(200);return fixture.objects.has(input)||fixture.objects.has(output);},{timeout:20000}).toBe(false);
 expect(fixture.objects.has(input)).toBe(false);expect(fixture.objects.has(output)).toBe(false);expect(fixture.objects.has('/health-outputs/results/customer-owned.txt')).toBe(true);
 const [stored]=await owner().query(`SELECT status,cleaned_at FROM service_health_runs WHERE id=$1`,[health.id]);expect(stored.status).toBe('unknown');expect(stored.cleaned_at).toBeTruthy();
});
test('canonical aggregate capacity rejects a whole backlog even when each refund is individually affordable',async({request})=>{
 const {refundFixture,role}=await import('./refund-fixture'),a=await refundFixture(),b=await refundFixture();
 try{
  for(const f of [a,b]){await role('database-conversion').query(`SELECT mend_refund_output_check($1::uuid,$2::jsonb,'absent')`,[f.id,JSON.stringify([f.attempt])]);await role('database-registrar').query(`SELECT mend_refund_fence($1::uuid,$2::jsonb)`,[f.id,JSON.stringify(f.payment())]);}
  await signIn(request);
  for(const [balance,allowance] of [[1000000,10000000],[8000000,1000000]]){
   fixture.settings.balance=BigInt(balance);fixture.settings.allowance=BigInt(allowance);
   const h=await(await request.post('/api/operator/service/health',{headers:{Origin:origin},data:{}})).json();expect(h.status).toBe('failed');
   const state=await(await request.get('/api/operator/service')).json();expect(state.capacity.status).toBe('deficit');expect(state.capacity.observation.debtAtomic).toBe('2000000');expect(state.availability.paused).toBe(true);
   expect((await request.post('/api/operator/service/resume',{headers:{Origin:origin},data:{healthId:h.id}})).status()).toBe(409);
  }
 }finally{fixture.settings.balance=BigInt(8000000);fixture.settings.allowance=BigInt(10000000);await a.cleanup();await b.cleanup();}
});
async function freshRecheck(request:import('@playwright/test').APIRequestContext){const h=await passed(request),r=await(await request.post('/api/operator/service/resume',{headers:{Origin:origin},data:{healthId:h.id}})).json();expect((await request.get(`/api/operator/service/health/${r.id}/result`)).status()).toBe(200);return {healthId:h.id,recheckId:r.id};}
test('held SQL lock makes a new failure/backlog/pause or session revocation win before resume',async({request})=>{
 const {serviceLock,waiting}=await import('./health-fixture');await signIn(request);
 for(const mutation of ["UPDATE service_availability SET failure_generation=failure_generation+1 WHERE id='merchant'","UPDATE refund_capacity SET version=version+1 WHERE id='merchant'","UPDATE service_availability SET generation=generation+1,paused_at=clock_timestamp() WHERE id='merchant'"]){
  const proof=await freshRecheck(request),release=await serviceLock();
  const resume=request.post('/api/operator/service/resume',{headers:{Origin:origin},data:proof});
  try{await waiting('mend_operator_resume');}finally{await release(mutation);}
  expect((await resume).status()).toBe(409);expect((await(await request.get('/api/operator/service')).json()).availability.paused).toBe(true);
 }
 const proof=await freshRecheck(request),release=await serviceLock();
 const resume=request.post('/api/operator/service/resume',{headers:{Origin:origin},data:proof});
 try{await waiting('mend_operator_resume');await owner().query(`UPDATE auth_sessions SET revoked_at=clock_timestamp() WHERE token_hash=(SELECT session_hash FROM service_health_runs WHERE id=$1)`,[proof.recheckId]);}finally{await release();}
 expect((await resume).status()).toBe(409);expect((await owner()`SELECT paused FROM service_availability WHERE id='merchant'`)[0].paused).toBe(true);
});
test('non-web SQL roles cannot forge health passes or resume; generic health and availability writes stay denied',async()=>{
 const {role}=await import('./health-fixture');
 for(const name of ['database-web','database-conversion','database-registrar','database-worker','database-refund-worker']){
  const q=role(name);await expect(q`UPDATE service_health_runs SET status='passed'`).rejects.toThrow();await expect(q`UPDATE service_availability SET paused=false`).rejects.toThrow();
  if(name!=='database-web')await expect(q`SELECT mend_operator_resume(gen_random_uuid(),gen_random_uuid(),'none','none')`).rejects.toThrow();
  if(name!=='database-conversion')await expect(q`SELECT mend_health_conversion(gen_random_uuid(),'complete',NULL,NULL,NULL)`).rejects.toThrow();
  if(name!=='database-registrar')await expect(q`SELECT mend_health_registrar(gen_random_uuid(),'complete')`).rejects.toThrow();
 }
});

test('stalled RPC fails within the health budget and never leaves resumable work',async({request})=>{
 await signIn(request);fixture.settings.rpcDelay=15000;
 try{const start=Date.now(),response=await request.post('/api/operator/service/health',{headers:{Origin:origin},data:{}});expect(Date.now()-start).toBeLessThan(10000);expect(response.status()).toBe(200);const h=await response.json();expect(['failed','unknown']).toContain(h.status);expect((await request.post('/api/operator/service/resume',{headers:{Origin:origin},data:{healthId:h.id}})).status()).toBe(409);}finally{fixture.settings.rpcDelay=0;}
});

test('operator completes real health and deliberate resume in the browser with responsive private evidence',async({page})=>{
 const {wallet}=await import('./wallet-fixture');await wallet(page,0);await page.goto('/recovery');
 await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).click();
 const section=page.getByRole('region',{name:'Service health',exact:true});await expect(section).toBeVisible();
 await expect(section.getByRole('button',{name:'Resume new purchases',exact:true})).toBeDisabled();
 const check=section.getByRole('button',{name:'Run health check',exact:true});await check.focus();await page.keyboard.press('Enter');await expect(section.getByText('Health: Passed',{exact:true})).toBeVisible();
 await expect(section.getByText('Authenticated result retrieval',{exact:true})).toBeVisible();
 for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:`/private/tmp/mend-recovery-context/health14-${width}.png`,fullPage:true});}
 const writes=fixture.effects.outputWrites;const resume=section.getByRole('button',{name:'Resume new purchases',exact:true});await resume.focus();await page.keyboard.press('Space');await expect(page.getByText('Fresh checks passed. New purchases resumed.',{exact:true})).toBeVisible();expect(fixture.effects.outputWrites).toBe(writes+1);
 await page.evaluate(()=>{(window as unknown as {__wallet:{switch:(n:number)=>void}}).__wallet.switch(1);});await expect(section).not.toBeVisible();expect(fixture.effects.verify+fixture.effects.settle).toBe(0);
});

test('actual confirmed failure and purchase admission serialize on both sides of deliberate resume',async({request})=>{
 const {refundFixture}=await import('./refund-fixture'),{role,serviceLock,waiting}=await import('./health-fixture');
 const {randomBytes}=await import('node:crypto');
 await signIn(request);
 const failed=await refundFixture({parserFailure:true}),purchase=await refundFixture({unpaid:true});
 try{
  const fail=()=>role('database-conversion').query(`SELECT mend_fail_execution($1,'absent','pdf_conversion_failed') AS result`,[failed.attempt]).then(rows=>rows);
  const admit=()=>role('database-web').query(`SELECT mend_admit_payment($1,$2,$3,'{}','{}','1') AS result`,[purchase.id,'0x'+'11'.repeat(20),'0x'+randomBytes(32).toString('hex')]).then(rows=>rows);
  await request.post('/api/operator/service',{headers:{Origin:origin},data:{reason:'Owned failure ordering proof'}});
  // Failure queues first; resume sees its new generation and admission remains closed.
  const old=await freshRecheck(request),release=await serviceLock();
  const failure=fail();await waiting('mend_fail_execution');
  const resume=request.post('/api/operator/service/resume',{headers:{Origin:origin},data:old});await waiting('mend_operator_resume');
  await release();expect((await failure)[0].result.recorded).toBe(true);expect((await resume).status()).toBe(409);expect((await admit())[0].result).toEqual({error:'purchases_paused'});
  const generation=(await owner()`SELECT failure_generation FROM service_availability`)[0].failure_generation;
  expect((await fail())[0].result.recorded).toBe(false);expect((await owner()`SELECT failure_generation FROM service_availability`)[0].failure_generation).toBe(generation);
  // A distinct failure queues after resume and admission. A single failure makes
  // evidence stale; the existing three-failure threshold still controls pausing.
  await owner().query(`DELETE FROM processing_failures WHERE attempt_id=$1`,[failed.attempt]);
  const proof=await freshRecheck(request),unlock=await serviceLock();
  const reopened=request.post('/api/operator/service/resume',{headers:{Origin:origin},data:proof});await waiting('mend_operator_resume');
  const admission=admit();await waiting('mend_admit_payment');
  const laterFailure=fail();await waiting('mend_fail_execution');
  await unlock();expect((await reopened).status()).toBe(200);expect((await admission)[0].result.admitted).toBe(true);expect((await laterFailure)[0].result.recorded).toBe(true);
  expect((await(await request.get(`/api/operator/service/health/${proof.recheckId}`)).json()).status).toBe('stale');
 }finally{
  await owner().query(`DELETE FROM processing_failures WHERE order_id=$1`,[failed.id]);
  await owner().query(`DELETE FROM payment_attempts WHERE order_id=$1`,[purchase.id]);
  await failed.cleanup();await purchase.cleanup();
 }
});

test('shared real parser and verified reader preserve paid delivery, customer privacy, corruption and expiry fences',async({request,playwright})=>{
 const {randomBytes,randomUUID,createHash}=await import('node:crypto'),{PDFDocument,StandardFonts}=await import('pdf-lib');
 const {operator,conversionSecret}=await import('./health-fixture');
 const pdf=await PDFDocument.create();pdf.addPage().drawText('Paid parser regression remains private',{font:await pdf.embedFont(StandardFonts.Helvetica)});const bytes=Buffer.from(await pdf.save());
 const headers={Authorization:`Bearer ${randomBytes(32).toString('hex')}`};
 const begin=await request.post('/api/submissions',{headers,data:{idempotencyKey:randomUUID(),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});expect(begin.status()).toBe(201);const submission=await begin.json();
 expect((await request.put(submission.upload.url,{headers:submission.upload.headers,data:bytes})).ok()).toBe(true);
 const complete=await request.post(`/api/submissions/${submission.id}/complete`,{headers});expect(complete.status()).toBe(201);const order=await complete.json();
 const convert=()=>request.post(fixture.conversion+'/',{headers:{Authorization:`Bearer ${conversionSecret}`},data:{orderId:order.id}});
 const stranger=await playwright.request.newContext({baseURL:origin});
 try{
  expect((await(await convert()).json()).status).toBe('payment_required');
  await signIn(request);expect((await request.post(`/api/orders/${order.id}/claim`,{headers:{...headers,Origin:origin}})).status()).toBe(200);
  // Controlled purchase metadata only; this regression performs no settlement.
  await owner().query(`UPDATE orders SET paid_at=clock_timestamp(),payer_wallet=$2,payment_receipt='{"status":"success","amountAtomic":"1000000","decimals":6}'::jsonb,status='paid' WHERE id=$1`,[order.id,operator.address.toLowerCase()]);
  await request.post('/api/operator/service',{headers:{Origin:origin},data:{reason:'Owned paused paid parser regression'}});
  expect((await(await convert()).json()).status).toBe('completed');
  const status=await(await request.get(`/api/orders/${order.id}`)).json();expect(status.result.available).toBe(true);const expiry=status.result.expiresAt;
  const download=await request.get(`/api/orders/${order.id}/result`);expect(download.status()).toBe(200);expect(await download.text()).toBe('Paid parser regression remains private\n');expect(download.headers()['cache-control']).toContain('private');
  expect((await stranger.get(`/api/orders/${order.id}/result`,{headers})).status()).toBe(401);await signIn(stranger,'22');expect((await stranger.get(`/api/orders/${order.id}/result`)).status()).toBe(404);
  const [row]=await owner().query(`SELECT result FROM orders WHERE id=$1`,[order.id]),key='/health-outputs/'+row.result.key,stored=fixture.objects.get(key)!;
  fixture.objects.set(key,{...stored,bytes:Buffer.from('corrupted private output')});expect((await request.get(`/api/orders/${order.id}/result`)).status()).toBe(409);fixture.objects.set(key,stored);
  await owner().query(`UPDATE orders SET result=jsonb_set(result,'{expiresAt}','"2000-01-01T00:00:00.000Z"') WHERE id=$1`,[order.id]);expect((await request.get(`/api/orders/${order.id}/result`)).status()).toBe(410);
  expect(new Date(expiry).getTime()-new Date(status.result.createdAt).getTime()).toBe(7*86400000);
 }finally{
  await stranger.dispose();await owner().query(`DELETE FROM result_downloads WHERE order_id=$1`,[order.id]);await owner().query(`DELETE FROM execution_attempts WHERE order_id=$1`,[order.id]);await owner().query(`DELETE FROM orders WHERE id=$1`,[order.id]);await owner().query(`DELETE FROM submissions WHERE id=$1`,[submission.id]);
 }
});
