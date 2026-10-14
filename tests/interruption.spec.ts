import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
const service=parseEnv(readFileSync(process.env.CONVERSION_SERVICE_ENV||'/private/tmp/mend-conversion-service.env','utf8'));
service.CONVERSION_FUNCTION_URL=service.CONVERSION_FUNCTION_URL.replace(/\/$/,'');
const saved=JSON.parse(readFileSync(process.env.INTERRUPTION_ORDER_STATE||'/private/tmp/mend-ticket5-failure.json','utf8'));
const orderId=saved.order.id;
const headers={Authorization:`Bearer ${service.CONVERSION_SERVICE_SECRET}`};
test('durable execution observation distinguishes parser exit from parent termination',async({request})=>{
 const response=await request.get(`${service.CONVERSION_FUNCTION_URL}/status?orderId=${orderId}`,{headers});
 expect(response.status()).toBe(200);
 const observed=await response.json();
 expect(observed.order.id).toBe(orderId);
 expect(observed.order.deadline).toBeTruthy();
 expect(observed.order.terms.deliverySeconds).toBe(120);
 expect(observed.attempts).toHaveLength(1);
 expect(observed.attempts[0].parserExitedAt).toBeTruthy();
 expect(observed.attempts[0].executionStoppedAt).toBeNull();
 expect(observed.execution).toBe('unknown');
});
test('concurrent stop requests are durable but never fabricate execution termination',async({request})=>{
 const responses=await Promise.all([1,2].map(()=>request.post(`${service.CONVERSION_FUNCTION_URL}/stop`,{headers,data:{orderId}})));
 for(const response of responses)expect(response.status()).toBe(200);
 const first=await(await request.get(`${service.CONVERSION_FUNCTION_URL}/status?orderId=${orderId}`,{headers})).json();
 expect(first.attempts[0].stopRequestedAt).toBeTruthy();
 expect(first.attempts[0].executionStoppedAt).toBeNull();
 expect(first.execution).toBe('unknown');
 await request.post(`${service.CONVERSION_FUNCTION_URL}/stop`,{headers,data:{orderId}});
 const second=await(await request.get(`${service.CONVERSION_FUNCTION_URL}/status?orderId=${orderId}`,{headers})).json();
 expect(second.attempts[0].stopRequestedAt).toBe(first.attempts[0].stopRequestedAt);
});
test('reconciliation preserves unknown old execution instead of restarting it',async({request})=>{
 const before=await(await request.get(`${service.CONVERSION_FUNCTION_URL}/status?orderId=${orderId}`,{headers})).json();
 const responses=await Promise.all([1,2].map(()=>request.post(`${service.CONVERSION_FUNCTION_URL}/reconcile`,{headers,data:{orderId}})));
 for(const response of responses)expect(response.status()).toBe(200);
 const after=await(await request.get(`${service.CONVERSION_FUNCTION_URL}/status?orderId=${orderId}`,{headers})).json();
 expect(after.order.deadline).toBe(before.order.deadline);
 expect(after.order.terms).toEqual(before.order.terms);
 expect(after.attempts.map((a:any)=>a.id)).toEqual(before.attempts.map((a:any)=>a.id));
 expect(after.execution).toBe('unknown');
 expect(after.reconciliation.checkedAt).toBeTruthy();
 expect(after.reconciliation.outcome).toBe('execution_unknown');
});

test('real cooperative shutdown and hard exit retain different durable proof',async({request})=>{
 test.skip(!process.env.INTERRUPTION_LIVE_STATES,'Live cached acceptance orders required.');
 const status=async(mode:string)=>{const state=JSON.parse(readFileSync(`/private/tmp/mend-ticket6-${mode}.json`,'utf8'));return(await request.get(`${service.CONVERSION_FUNCTION_URL}/status?orderId=${state.order.id}`,{headers})).json();};
 const shutdown=await status('shutdown');expect(shutdown.execution).toBe('stopped');expect(shutdown.attempts[0].parserExitedAt).toBeTruthy();expect(shutdown.attempts[0].executionStoppedAt).toBeTruthy();expect(shutdown.attempts[0].publicationFencedAt).toBeTruthy();expect(shutdown.attempts[0].finalOutputCheck).toBe('absent');
 const unknown=await status('noack');expect(unknown.execution).toBe('unknown');expect(unknown.attempts[0].parserExitedAt).toBeNull();expect(unknown.attempts[0].executionStoppedAt).toBeNull();expect(unknown.attempts).toHaveLength(1);
 const deadline=unknown.order.deadline;const responses=await Promise.all([1,2,3].map(()=>request.post(service.CONVERSION_FUNCTION_URL,{headers,data:{orderId:unknown.order.id}})));for(const response of responses)expect(response.status()).toBe(200);expect((await status('noack')).order.deadline).toBe(deadline);expect((await status('noack')).attempts).toHaveLength(1);
});
test('external schedule headers cannot invoke reconciliation',async({request})=>{
 const response=await request.post(`${service.CONVERSION_FUNCTION_URL}/scheduled`,{headers:{'X-Neon-Trigger-Invocation-Id':'spoof'},data:{version:1,invocation_id:'spoof',trigger:{type:'schedule',id:'trigger-ed102c55-a3a1-4d8c-9223-12c74908312c'},data:{scheduled_at:new Date().toISOString()}}});expect(response.status()).toBe(403);
});
test('retired conversion and worker credentials cannot author trusted facts',async()=>{
 test.skip(!process.env.INTERRUPTION_ROLE_DIRECTORY,'Local isolated role credentials required.');const{neon}=await import('@neondatabase/serverless');const directory=process.env.INTERRUPTION_ROLE_DIRECTORY!;
 for(const role of['conversion','worker']){const config=parseEnv(readFileSync(`${directory}/database-${role}.env`,'utf8'));const query=neon(config.DATABASE_URL_UNPOOLED||config.DATABASE_URL);for(const mutation of[`UPDATE orders SET result=result,delivered_at=delivered_at WHERE id='${orderId}'`,`UPDATE execution_attempts SET output_publication=output_publication WHERE order_id='${orderId}'`,`UPDATE orders SET paid_at=paid_at,terms=terms WHERE id='${orderId}'`]){let denied=false;try{await query.query(mutation);}catch(error){denied=(error as{code?:string}).code==='42501';}expect(denied).toBe(true);}}
});
test('authentic scheduled reconciliation restores private output without another execution',async({request})=>{
 test.skip(!process.env.INTERRUPTION_LIVE_STATES,'Live cached acceptance orders required.');const state=JSON.parse(readFileSync('/private/tmp/mend-ticket6-publication.json','utf8'));
 const inspect=async()=>{const response=await request.get(`${service.CONVERSION_FUNCTION_URL}/status?orderId=${state.order.id}`,{headers});return response.json();};
 await expect.poll(async()=>(await inspect()).order.deliveredAt,{timeout:130000,intervals:[1000,3000,5000]}).toBeTruthy();
 const observed=await inspect();expect(observed.order.deadline).toBe(state.receipt.delivery.deadline);expect(observed.order.terms).toEqual(state.receipt.terms);expect(observed.attempts).toHaveLength(1);expect(observed.attempts[0].finalOutputCheck).toBe('unknown');expect(observed.reconciliation.outcome).toBe('valid_output');
 const sweeps=await(await request.get(`${service.CONVERSION_FUNCTION_URL}/sweeps`,{headers})).json();expect(sweeps.some((s:any)=>s.completedAt&&s.id!=='spoof'&&s.observedOrders>0)).toBe(true);
});
test('the paying customer sees honest overdue uncertainty and the restored private result',async({request})=>{
 test.skip(!process.env.INTERRUPTION_PURCHASER_ENV,'Dedicated local purchaser required.');const{privateKeyToAccount}=await import('viem/accounts');const account=privateKeyToAccount(parseEnv(readFileSync(process.env.INTERRUPTION_PURCHASER_ENV!,'utf8')).TEST_PURCHASER_PRIVATE_KEY as`0x${string}`),origin=process.env.TEST_AUTH_ORIGIN||'http://127.0.0.1:3030';
 const issued=await(await request.post('/api/auth/challenge',{headers:{Origin:origin},data:{address:account.address,chainId:5042002}})).json();expect((await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature:await account.signMessage({message:issued.message})}})).status()).toBe(200);
 const unknown=JSON.parse(readFileSync('/private/tmp/mend-ticket6-noack.json','utf8')),publication=JSON.parse(readFileSync('/private/tmp/mend-ticket6-publication.json','utf8'));
 await expect.poll(async()=>(await(await request.get(`/api/orders/${unknown.order.id}`)).json()).delivery.overdue,{timeout:130000,intervals:[1000,5000]}).toBe(true);
 const state=await(await request.get(`/api/orders/${unknown.order.id}`)).json();expect(state.outcome).toBe('Delivery overdue · unresolved');expect(state.recovery.execution).toBe('unknown');expect(state.recovery.hostingDelay).toContain('15 minutes');expect(state.nextStep).toContain('original delivery deadline');expect(JSON.stringify(state)).not.toContain('results/');expect(state.delivery.deadline).toBe(unknown.receipt.delivery.deadline);
 const result=await request.get(`/api/orders/${publication.order.id}/result`);expect(result.status()).toBe(200);expect(await result.text()).toContain('Durable publication acceptance output');
});
