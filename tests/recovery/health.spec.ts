import {test,expect,type APIRequestContext} from '@playwright/test';
import {lifecycle,type Lifecycle} from './harness';

let h:Lifecycle;
test.beforeAll(async()=>{h=await lifecycle();});
test.afterAll(async()=>{await h?.close();});
test.beforeEach(async()=>{await h.reset();});
async function startHealth(request:APIRequestContext){
 const response=await request.post('/api/operator/service/health',{headers:{Origin:h.origin},data:{}});
 expect(response.status()).toBe(200);const health=await response.json();
 expect(health.status).toBe('running');expect(health.components.parser.status).toBe('passed');
 expect(health.components.retrieval.status).toBe('pending');return health;
}
async function passed(request:APIRequestContext){
 const health=await startHealth(request);
 expect((await request.get(`/api/operator/service/health/${health.id}/result`)).status()).toBe(200);
 const response=await request.get(`/api/operator/service/health/${health.id}`);expect(response.status()).toBe(200);
 const current=await response.json();expect(current.status).toBe('passed');return current;
}

test('lost authenticated health retrieval survives web and storage-fixture death without inventing a pass',async({playwright})=>{
 const request=await playwright.request.newContext({baseURL:h.origin});await h.signIn(request);
 expect((await request.post('/api/operator/service',{headers:{Origin:h.origin},data:{reason:'Isolated crash proof'}})).status()).toBe(200);
 const health=await startHealth(request),reads=(await h.state()).events.filter((v:string)=>v==='output-read').length;
 await h.control({hold:'output-read'});
 const pending=request.get(`/api/operator/service/health/${health.id}/result`).catch(()=>null);
 await h.event('output-read',reads+1);await h.web.kill();await pending;
 await h.restartEffects();await h.restartWeb();
 const interrupted=await(await request.get(`/api/operator/service/health/${health.id}`)).json();
 expect(interrupted.status).toBe('running');expect(interrupted.components.retrieval.passedAt).toBeNull();
 const replay=await request.get(`/api/operator/service/health/${health.id}/result`);expect(replay.status()).toBe(200);
 expect(replay.headers()['cache-control']).toContain('private');
 expect((await(await request.get(`/api/operator/service/health/${health.id}`)).json()).status).toBe('passed');
 expect((await(await request.get('/api/operator/service')).json()).availability.paused).toBe(true);
 expect((await h.state()).charges).toHaveLength(0);expect((await h.state()).refunds).toHaveLength(0);
 expect(Number((await h.owner`SELECT count(*) AS n FROM orders`)[0].n)).toBe(0);await request.dispose();
});

test('a real conversion failure invalidates both health proofs across restarts and fences stale resume replay',async({playwright})=>{
 await h.restartWeb({CONVERSION_FUNCTION_URL:''});
 const purchase=await h.draft(playwright);expect((await purchase.pay()).status()).toBe(200);
 await h.restart('conversion',{INTERRUPTION_EXPERIMENT_ORDER:purchase.id});
 const request=purchase.request;
 expect((await request.post('/api/operator/service',{headers:{Origin:h.origin},data:{reason:'Isolated health generation race'}})).status()).toBe(200);
 const health=await passed(request);
 const begun=await request.post('/api/operator/service/resume',{headers:{Origin:h.origin},data:{healthId:health.id}});
 expect(begun.status()).toBe(200);const recheck=await begun.json();
 expect((await request.get(`/api/operator/service/health/${recheck.id}/result`)).status()).toBe(200);
 expect((await(await request.get(`/api/operator/service/health/${recheck.id}`)).json()).status).toBe('passed');
 expect((await h.call('conversion','/experiment',{orderId:purchase.id,mode:'failure'})).status).toBe(200);
 await h.restart('conversion');await h.restartWeb({CONVERSION_FUNCTION_URL:''});
 for(const id of [health.id,recheck.id])expect((await(await request.get(`/api/operator/service/health/${id}`)).json()).status).toBe('stale');
 const resume=await request.post('/api/operator/service/resume',{headers:{Origin:h.origin},data:{healthId:health.id,recheckId:recheck.id}});
 expect(resume.status()).toBe(409);
 expect((await(await request.get('/api/operator/service')).json()).availability.paused).toBe(true);
 const order=await(await request.get(`/api/orders/${purchase.id}`)).json();expect(order.payment.confirmed).toBe(true);
 expect(order.refund.confirmedAt).toBeNull();expect((await h.state()).charges).toHaveLength(1);
 await request.dispose();
});
