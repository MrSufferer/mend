import {test,expect} from '@playwright/test';
import {privateKeyToAccount} from 'viem/accounts';
const operator=privateKeyToAccount(`0x${'44'.repeat(32)}`);
async function signIn(request:import('@playwright/test').APIRequestContext,account=operator){
 const challenge=await(await request.post('/api/auth/challenge',{headers:{Origin:process.env.TEST_BASE_URL!},data:{address:account.address,chainId:5042002}})).json();
 expect((await request.post('/api/auth/verify',{headers:{Origin:process.env.TEST_BASE_URL!},data:{...challenge,signature:await account.signMessage({message:challenge.message})}})).status()).toBe(200);
}
const orderId='72557542-5b7b-4082-b6ae-6e306ee13980';
test('deterministic operator checks require operator authentication',async({request})=>{
 expect((await request.post(`/api/operator/orders/${orderId}/actions`,{data:{action:'check'}})).status()).toBe(401);
 await signIn(request,privateKeyToAccount(`0x${'11'.repeat(32)}`));
 expect((await request.post(`/api/operator/orders/${orderId}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'check'}})).status()).toBe(403);
});
test('an exhausted case permits a fresh deterministic check with durable actor audit',async({request})=>{
 const {operatorFixture}=await import('./operator-fixture');const fixture=await operatorFixture();
 try{await signIn(request);
 const before=await(await request.get(`/api/operator/orders/${fixture.id}/recovery`)).json();expect(before.case.callsUsed).toBe(12);
 const response=await request.post(`/api/operator/orders/${fixture.id}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'check'}});
 expect(response.status()).toBe(200);const body=await response.json();
 expect(body.operatorRequest.action).toBe('check');expect(body.operatorRequest.actor).toBe(operator.address.toLowerCase());
 expect(body.operatorRequest.outcome).toBe('checked');expect(body.case.callsUsed).toBe(12);
 expect(body.operatorRequests.some((item:{id:string})=>item.id===body.operatorRequest.id)).toBe(true);
 expect(JSON.stringify(body)).not.toMatch(/tokenHash|sessionHash|results\//);
 const investigation=await(await request.post(`/api/operator/orders/${fixture.id}/investigate`,{headers:{Origin:process.env.TEST_BASE_URL!}})).json();
 expect(investigation.operatorRequest.outcomeEvidence.reason).toBe('budget_exhausted');expect(investigation.case.callsUsed).toBe(12);
 }finally{await fixture.cleanup();}
});
test('guarded actions reject unknown actions and refresh stale clicks with an audited explanation',async({request})=>{
 await signIn(request);
 expect((await request.post(`/api/operator/orders/${orderId}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'force_refund'}})).status()).toBe(400);
 const response=await request.post('/api/operator/orders/1e29d2bc-afd1-4f5f-a3af-d4dee236518b/actions',{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'retry'}});
 expect(response.status()).toBe(200);const body=await response.json();
 expect(body.operatorRequest.outcome).toBe('skipped');expect(body.operatorRequest.outcomeEvidence.reason).toBe('no_unresolved_paid_obligation');
 expect(body.evidence.disposition).toBe('delivery');expect(body.evidence.attempts.map((a:{generation:number})=>a.generation)).toEqual([0,1]);
});

test('an admitted retry with an execution failure is uncertain, never a skipped action',async({request})=>{
 const {operatorFixture}=await import('./operator-fixture');const fixture=await operatorFixture(true);
 try{await signIn(request);const response=await request.post(`/api/operator/orders/${fixture.id}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'retry'}});
 expect(response.status()).toBe(200);const body=await response.json();
 expect(body.evidence.attempts.map((a:{generation:number})=>a.generation),JSON.stringify(body.operatorRequest.outcomeEvidence)).toEqual([0,1]);
 expect(body.operatorRequest.outcome).toBe('uncertain');expect(body.case.callsUsed).toBe(12);
 }finally{await fixture.cleanup();}
});

test('concurrent operator retry clicks admit only one generation and preserve the purchased deadline',async({request})=>{
 const {operatorFixture}=await import('./operator-fixture');const fixture=await operatorFixture();
 try{await signIn(request);const before=await(await request.get(`/api/operator/orders/${fixture.id}/recovery`)).json();
 const responses=await Promise.all([1,2].map(()=>request.post(`/api/operator/orders/${fixture.id}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'retry'}})));
 for(const response of responses)expect(response.status()).toBe(200);
 const after=await(await request.get(`/api/operator/orders/${fixture.id}/recovery`)).json();
 expect(after.evidence.attempts.map((a:{generation:number})=>a.generation)).toEqual([0,1]);expect(after.case.callsUsed).toBe(12);
 expect(after.operatorRequests.some((r:{outcome:string})=>r.outcome==='completed')).toBe(true);
 expect(after.operatorRequests.some((r:{outcome:string})=>r.outcome==='skipped')).toBe(true);
 const attempts=await fixture.owner.query('SELECT deadline FROM execution_attempts WHERE order_id=$1',[fixture.id]);expect(attempts[0].deadline).toEqual(attempts[1].deadline);
 expect(before.case.escalation).toBe('fixture_budget_exhausted');
 }finally{await fixture.cleanup();}
});

test('deferred requests revalidate revoked sessions and deterministic invocations cannot run model tools',async({request})=>{
 const {operatorFixture}=await import('./operator-fixture');const fixture=await operatorFixture();
 const {readFileSync}=await import('node:fs'),{parseEnv}=await import('node:util'),{randomUUID}=await import('node:crypto'),{neon}=await import('@neondatabase/serverless');
 const load=(name:string)=>parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/${name}.env`,'utf8'));
 const web=neon(load('database-web').DATABASE_URL_UNPOOLED),worker=neon(load('database-worker').DATABASE_URL_UNPOOLED);
 const service=parseEnv(readFileSync('/private/tmp/mend-conversion6-service.env','utf8'));
 try{await signIn(request);const session=(await fixture.owner.query('SELECT token_hash FROM auth_sessions WHERE wallet=$1 AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1',[operator.address.toLowerCase()]))[0];
 const requestId=randomUUID();const [begun]=await web.query('SELECT mend_operator_begin($1::uuid,$2::uuid,$3,$4,$5) AS request',[requestId,fixture.id,session.token_hash,'check',operator.address.toLowerCase()]);
 const invocation=begun.request.invocationId;
 await expect(worker.query('SELECT mend_agent_claim($1::uuid,$2::uuid)',[invocation,randomUUID()])).rejects.toThrow();
 const misuse=await fetch(service.CONVERSION_FUNCTION_URL.replace(/\/$/,'')+'/agent/inspect',{method:'POST',headers:{Authorization:'Bearer '+service.AGENT_CONVERSION_SECRET,'Content-Type':'application/json'},body:JSON.stringify({invocationId:invocation})});expect(misuse.status).toBe(403);
 await request.post('/api/auth/logout',{headers:{Origin:process.env.TEST_BASE_URL!}});
 const denied=await fetch(service.CONVERSION_FUNCTION_URL.replace(/\/$/,'')+'/operator',{method:'POST',headers:{Authorization:'Bearer '+service.OPERATOR_CONVERSION_SECRET,'Content-Type':'application/json'},body:JSON.stringify({requestId})});expect(denied.status).toBe(200);
 const result=await denied.json();expect(result.outcome).toBe('skipped');expect(result.evidence.reason).toBe('operator_session_expired');
 await signIn(request);const after=await(await request.get(`/api/operator/orders/${fixture.id}/recovery`)).json();expect(after.case.callsUsed).toBe(12);expect(after.evidence.attempts).toHaveLength(1);
 }finally{await fixture.cleanup();}
});

test('a verified prepared output restores after exhaustion and survives a refreshed stale action',async({request})=>{
 const {operatorFixture}=await import('./operator-fixture');const fixture=await operatorFixture(false,true);
 try{
 await signIn(request);const response=await request.post(`/api/operator/orders/${fixture.id}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'restore'}});expect(response.status()).toBe(200);
 const restored=await response.json();expect(restored.operatorRequest.outcome).toBe('completed');expect(restored.evidence.delivery.establishedAt).toBeTruthy();expect(restored.case.callsUsed).toBe(12);
 const stale=await(await request.post(`/api/operator/orders/${fixture.id}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'retry'}})).json();expect(stale.operatorRequest.outcome).toBe('skipped');expect(stale.evidence.disposition).toBe('delivery');expect(stale.evidence.attempts).toHaveLength(1);
 const refreshed=await(await request.get(`/api/operator/orders/${fixture.id}/recovery`)).json();expect(refreshed.operatorRequests.some((r:{id:string;outcome:string})=>r.id===restored.operatorRequest.id&&r.outcome==='completed')).toBe(true);expect(refreshed.case.callsUsed).toBe(12);
 await signIn(request,privateKeyToAccount(`0x${'11'.repeat(32)}`));const customer=await(await request.get(`/api/orders/${fixture.id}`)).json();expect(customer.status).toBe('delivered');expect(customer.delivery.establishedAt).toBeTruthy();expect(JSON.stringify(customer)).not.toMatch(/operatorRequests|requestEvidence|outcomeEvidence|sessionHash|tokenHash|results\//);expect(JSON.stringify(customer)).not.toContain(operator.address.toLowerCase());
 }finally{await fixture.cleanup();}
});

test('automatic investigation leases block stale operator actions without consuming a model call',async({request})=>{
 const {operatorFixture}=await import('./operator-fixture');const fixture=await operatorFixture();
 const {readFileSync}=await import('node:fs'),{parseEnv}=await import('node:util'),{neon}=await import('@neondatabase/serverless'),{randomUUID}=await import('node:crypto');const worker=neon(parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/database-worker.env`,'utf8')).DATABASE_URL_UNPOOLED);const invocation=randomUUID();
 try{await fixture.owner.query('UPDATE recovery_cases SET calls_used=11 WHERE order_id=$1',[fixture.id]);
 const [begun]=await worker.query('SELECT mend_agent_begin($1::uuid,$2::uuid) AS result',[fixture.id,invocation]);expect(begun.result.error).toBeUndefined();
 await signIn(request);const blocked=await(await request.post(`/api/operator/orders/${fixture.id}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'retry'}})).json();expect(blocked.operatorRequest.outcomeEvidence.reason).toBe('investigation_running');expect(blocked.evidence.attempts).toHaveLength(1);expect(blocked.case.callsUsed).toBe(11);
 await worker.query("SELECT mend_agent_finish($1::uuid,'investigated')",[invocation]);
 const fresh=await(await request.post(`/api/operator/orders/${fixture.id}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'check'}})).json();expect(fresh.operatorRequest.outcome).toBe('checked');expect(fresh.case.callsUsed).toBe(11);
 }finally{await fixture.cleanup();}
});
