import {test,expect} from '@playwright/test';
import {lifecycle,type Lifecycle} from './harness';
let h:Lifecycle;
test.beforeAll(async()=>{h=await lifecycle();});
test.afterAll(async()=>{await h?.close();});
test.beforeEach(async()=>{await h.reset();});
test('lost settlement response survives real web and fixture death without another charge',async({playwright})=>{
 const purchase=await h.draft(playwright);
 await h.control({hold:'settlement'});
 const pending=purchase.pay().catch(()=>null);
 await h.event('settlement');
 const before=h.web.pid;
 await h.web.kill();await pending;
 await h.restartEffects();await h.restartWeb();
 await h.control({hold:'receipt-read'});const receipt=h.call('receipts','/reconcile',{}).catch(()=>null);await h.event('receipt-read');
 await h.services.receipts.kill();await receipt;await h.restartEffects();await h.restart('receipts');expect((await h.call('receipts','/reconcile',{})).status).toBe(200);
 expect(h.web.pid).not.toBe(before);
 const reconciled=await purchase.pay();expect(reconciled.status()).toBe(200);
 const order=await reconciled.json();expect(order.payment.confirmed).toBe(true);
 const replay=await purchase.pay();expect(replay.status()).toBe(200);
 expect((await h.state()).charges).toHaveLength(1);
 expect((await replay.json()).payment.confirmedAt).toBe(order.payment.confirmedAt);
 await purchase.request.dispose();
});
test('an orphan-block payment receipt never becomes customer-visible paid state',async({playwright})=>{
 const purchase=await h.draft(playwright);
 await h.control({orphan:true});
 const response=await purchase.pay();
 expect(response.status()).not.toBe(200);
 const visible=await purchase.request.get(`/api/orders/${purchase.id}`);expect(visible.status()).toBe(200);expect((await visible.json()).payment.confirmed).toBe(false);
 const paid=await h.owner`SELECT paid_at FROM orders WHERE id=${purchase.id}`;
 expect(paid[0].paid_at).toBeNull();
 await h.control({orphan:false});
 expect((await purchase.pay()).status()).toBe(200);
 expect((await h.state()).charges.filter((c:any)=>c.nonce===JSON.parse(Buffer.from(purchase.payment,'base64').toString()).payload.authorization.nonce)).toHaveLength(1);
 await purchase.request.dispose();
});

async function delayedPurchase(playwright:Parameters<Lifecycle['draft']>[0]){
 await h.restartWeb({CONVERSION_FUNCTION_URL:''});
 const purchase=await h.draft(playwright);expect((await purchase.pay()).status()).toBe(200);
 await h.restart('conversion',{INTERRUPTION_EXPERIMENT_ORDER:purchase.id});
 return purchase;
}
async function projected(purchase:Awaited<ReturnType<Lifecycle['draft']>>){const r=await purchase.request.get(`/api/orders/${purchase.id}`);expect(r.status()).toBe(200);return r.json();}
test('hard-killed parser remains unknown across stop requests and duplicate conversion deliveries',async({playwright})=>{
 const purchase=await delayedPurchase(playwright),pid=h.services.conversion.pid;
 await h.call('conversion','/experiment',{orderId:purchase.id,mode:'noack'}).catch(()=>null);
 await h.restart('conversion');expect(h.services.conversion.pid).not.toBe(pid);
 await h.call('conversion','/stop',{orderId:purchase.id});
 await h.call('conversion','/reconcile',{orderId:purchase.id});
 const replay=await h.call('conversion','/',{orderId:purchase.id});expect(replay.status).toBe(200);
 const order=await projected(purchase);expect(order.recovery.execution).toBe('unknown');expect(order.recovery.attempts).toHaveLength(1);
 expect(order.recovery.attempts[0].executionStoppedAt).toBeNull();expect(order.payment.confirmed).toBe(true);
 expect((await h.state()).charges).toHaveLength(1);expect((await h.state()).refunds).toHaveLength(0);
 await purchase.request.dispose();
});
test('hard kill after output PUT preserves unknown publication and never fabricates refund or delivery',async({playwright})=>{
 const purchase=await delayedPurchase(playwright);await h.control({hold:'output-put'});
 const work=h.call('conversion','/',{orderId:purchase.id}).catch(()=>null);await h.event('output-put');
 await h.services.conversion.kill();await work;await h.restartEffects();await h.restart('conversion');
 await h.call('conversion','/stop',{orderId:purchase.id});await h.call('conversion','/reconcile',{orderId:purchase.id});
 expect((await (await h.call('registrar','/register',{orderId:purchase.id})).json()).status).toBe('unresolved');
 const order=await projected(purchase);expect(order.result).toBeNull();expect(order.recovery.execution).toBe('unknown');expect(order.recovery.attempts).toHaveLength(1);
 expect(order.recovery.attempts[0].executionStoppedAt).toBeNull();expect((await h.state()).refunds).toHaveLength(0);
 await purchase.request.dispose();
});
test('cooperatively stopped publication restores original private output after process restart',async({playwright})=>{
 const purchase=await delayedPurchase(playwright),before=await projected(purchase);
 expect((await h.call('conversion','/experiment',{orderId:purchase.id,mode:'publication'})).status).toBe(200);
 const pid=h.services.conversion.pid;await h.restart('conversion');expect(h.services.conversion.pid).not.toBe(pid);
 await Promise.all([h.call('conversion','/reconcile',{orderId:purchase.id}),h.call('registrar','/register',{orderId:purchase.id})]);
 const restored=await projected(purchase);expect(restored.result.available).toBe(true);expect(restored.recovery.attempts).toHaveLength(1);
 expect(restored.delivery.deadline).toBe(before.delivery.deadline);expect(restored.payment.confirmedAt).toBe(before.payment.confirmedAt);
 const first=restored.result;expect((await purchase.request.get(`/api/orders/${purchase.id}/result`)).status()).toBe(200);
 await h.call('conversion','/reconcile',{orderId:purchase.id});expect((await projected(purchase)).result.expiresAt).toBe(first.expiresAt);
 const stranger=await playwright.request.newContext({baseURL:h.origin});await h.signIn(stranger,(await import('./harness')).other);
 expect((await stranger.get(`/api/orders/${purchase.id}/result`)).status()).toBe(404);await stranger.dispose();await purchase.request.dispose();
});
test('cooperative SIGINT confirms whole execution stop while a hard kill cannot',async({playwright})=>{
 const purchase=await delayedPurchase(playwright);
 await h.call('conversion','/experiment',{orderId:purchase.id,mode:'shutdown'}).catch(()=>null);await h.restart('conversion');
 await h.call('conversion','/reconcile',{orderId:purchase.id});const order=await projected(purchase);
 expect(order.recovery.execution).toBe('stopped');expect(order.recovery.attempts[0].executionStoppedAt).toBeTruthy();expect(order.recovery.attempts[0].parserExitedAt).toBeTruthy();
 await purchase.request.dispose();
});

test('twelve real SDK dispatch claims survive worker death and never permit a thirteenth',async({playwright})=>{
 const fixture=await h.seed({stopped:true,calls:0});
 const request=await playwright.request.newContext({baseURL:h.origin});await h.signIn(request);
 for(let i=1;i<=5;i++){expect((await h.call('agent','/investigate',{orderId:fixture.id})).status).toBe(200);await h.restart('agent');}
 await h.control({hold:'model'});const pending=h.call('agent','/investigate',{orderId:fixture.id}).catch(()=>null);await h.event('model',6);
 const before=await h.owner`SELECT deadline FROM agent_invocations WHERE order_id=${fixture.id} AND finished_at IS NULL`;
 await h.services.agent.kill();await pending;await h.restartEffects();await h.restart('agent');
 const duplicate=await h.call('agent','/investigate',{orderId:fixture.id});expect((await duplicate.json()).error).toBeTruthy();
 // Real invocation expiry is deliberately observed, never changed through a test-only clock.
 await expect.poll(async()=>Date.now()>new Date(before[0].deadline).getTime(),{timeout:65000,intervals:[1000]}).toBe(true);
 for(let i=7;i<=12;i++){expect((await h.call('agent','/investigate',{orderId:fixture.id})).status).toBe(200);await h.restart('agent');}
 const attempts=await Promise.all([1,2,3].map(()=>h.call('agent','/investigate',{orderId:fixture.id})));
 expect((await h.state()).modelCalls).toBe(12);for(const response of attempts)expect((await response.json()).error).toBeTruthy();
 const visible=await request.get(`/api/operator/orders/${fixture.id}/recovery`);expect(visible.status()).toBe(200);expect((await visible.json()).case.callsUsed).toBe(12);
 await fenced(fixture);await h.call('refund','/reconcile',{orderId:fixture.id});
 const refunded=await request.get(`/api/orders/${fixture.id}`);expect((await refunded.json()).refund.status).toBe('refunded');expect((await h.state()).modelCalls).toBe(12);expect((await h.state()).refunds).toHaveLength(1);await request.dispose();
});
// Artificial stopped execution/payment metadata isolates the financial outbox lifecycle.
// It is never asserted to be independent canonical payment evidence.
async function fenced(existing?:Awaited<ReturnType<Lifecycle['seed']>>){
 const fixture=existing??await h.seed({stopped:true,calls:12});
 await h.role('database-conversion')`SELECT mend_refund_output_check(${fixture.id}::uuid,${JSON.stringify([fixture.attempt])}::jsonb,'absent')`;
 const order=await h.owner`SELECT payment_transaction,payer_wallet FROM orders WHERE id=${fixture.id}`;
 const evidence={transaction:order[0].payment_transaction,payer:order[0].payer_wallet,amountAtomic:'1000000',chainId:'5042002',checkedAt:new Date().toISOString()};
 const result=await h.role('database-registrar')`SELECT mend_refund_fence(${fixture.id}::uuid,${JSON.stringify(evidence)}::jsonb) AS refund`;
 expect(result[0].refund.order_id).toBe(fixture.id);return fixture;
}
test('registrar death after signed bytes resumes the same operation and canonical entitlement once',async()=>{
 const fixture=await fenced();await h.control({hold:'registrar-signed'});
 const pending=h.call('registrar','/register',{orderId:fixture.id}).then(async r=>{const b=await r.json();if(b.reason)throw Error('Registrar fixture: '+b.reason);return b;}).catch(e=>{if(e.message?.startsWith('Registrar fixture:'))throw e;return null;});await Promise.race([h.event('registrar-signed'),pending.then(()=>{throw Error('Unexpected early registration completion');})]);
 const first=await h.owner`SELECT nonce,raw_transaction,hash FROM refund_transactions WHERE order_id=${fixture.id}`;
 await h.services.registrar.kill();await pending;await h.restartEffects();await h.restart('registrar');
 const replay=await h.call('registrar','/register',{orderId:fixture.id});expect(replay.status).toBe(200);expect((await replay.json()).status).toBe('registered');
 const second=await h.owner`SELECT nonce,raw_transaction,hash FROM refund_transactions WHERE order_id=${fixture.id}`;
 expect(second).toEqual(first);expect((await h.state()).registrations).toHaveLength(1);expect((await h.state()).refunds).toHaveLength(0);
});
test('a signed unbroadcast refund remains aggregate debt until canonical repayment',async()=>{
 const fixture=await fenced();expect((await (await h.call('registrar','/register',{orderId:fixture.id})).json()).status).toBe('registered');
 await h.control({hold:'refund-signed'});const pending=h.call('refund','/reconcile',{orderId:fixture.id}).catch(()=>null);await h.event('refund-signed');
 const capacity=await (await h.call('registrar','/capacity',{})).json();expect(capacity.orders).toBe(1);expect(capacity.debtAtomic).toBe('1000000');expect((await h.state()).refunds).toHaveLength(0);
 await h.services.refund.kill();await pending;await h.restartEffects();await h.restart('refund');await h.call('refund','/reconcile',{orderId:fixture.id});
 const after=await (await h.call('registrar','/capacity',{})).json();expect(after.orders).toBe(0);expect(after.debtAtomic).toBe('0');expect((await h.state()).refunds).toHaveLength(1);
});
test('refund inclusion survives worker and chain-fixture death, missing receipt stays unresolved, replay pays once',async({playwright})=>{
 const fixture=await fenced();expect(await (await h.call('registrar','/register',{orderId:fixture.id})).json()).toMatchObject({status:'registered'});
 await h.control({hold:'refund-included'});const pending=h.call('refund','/reconcile',{orderId:fixture.id}).catch(()=>null);await h.event('refund-included');
 await h.services.refund.kill();await pending;await h.restartEffects();await h.restart('refund');
 const request=await playwright.request.newContext({baseURL:h.origin});await h.signIn(request);
 await h.control({hideReceipts:true});await h.call('refund','/reconcile',{orderId:fixture.id});
 const uncertain=await (await request.get(`/api/orders/${fixture.id}`)).json();expect(uncertain.refund.confirmedAt).toBeNull();expect((await h.state()).refunds).toHaveLength(1);
 await h.control({hideReceipts:false});
 await Promise.all([1,2,3].map(()=>h.call('refund','/reconcile',{orderId:fixture.id})));
 const done=await (await request.get(`/api/orders/${fixture.id}`)).json();expect(done.refund.status).toBe('refunded');expect(done.refund.payer).toBe((await import('./harness')).payer.address.toLowerCase());
 expect((await h.state()).refunds).toHaveLength(1);expect((await h.state()).registrations).toHaveLength(1);
 const ops=await h.owner`SELECT count(*) AS n FROM refund_transactions WHERE order_id=${fixture.id} AND kind='refund'`;expect(Number(ops[0].n)).toBe(1);await request.dispose();
});

test('concurrent real operator and model retry requests claim only the sole purchased generation',async({playwright})=>{
 const purchase=await delayedPurchase(playwright);await h.call('conversion','/experiment',{orderId:purchase.id,mode:'failure'});
 const original=await projected(purchase);await h.control({modelTool:'retry_once',hold:'input-read'});
 const agent=h.call('agent','/investigate',{orderId:purchase.id});
 const operator=purchase.request.post(`/api/operator/orders/${purchase.id}/actions`,{headers:{Origin:h.origin},data:{action:'retry'}});
 await expect.poll(async()=>Number((await h.owner`SELECT count(*) AS n FROM execution_attempts WHERE order_id=${purchase.id}`)[0].n),{timeout:15000}).toBe(2);
 await h.control({release:'input-read'});await Promise.all([agent,operator]);
 const after=await projected(purchase);expect(after.recovery.attempts.map((a:any)=>a.generation)).toEqual([0,1]);expect(after.payment.confirmedAt).toBe(original.payment.confirmedAt);expect(after.delivery.deadline).toBe(original.delivery.deadline);
 expect((await h.state()).charges).toHaveLength(1);await purchase.request.dispose();
});
test('retention worker death after actual DELETE keeps absence durable and unresolved obligation intact',async({playwright})=>{
 const fixture=await h.seed({stopped:false,prepared:true,expired:true});
 // Artificially old content clock exercises the seven-day boundary without altering process time.
 const old=new Date(Date.now()-8*86400000).toISOString();
 await h.owner`SELECT mend_retention_clock(${fixture.attempt}::uuid,${old}::timestamptz)`;
 const path=h.common.AWS_ENDPOINT_URL_S3+'/'+h.common.OUTPUT_BUCKET+'/'+fixture.key;
 expect((await fetch(path,{method:'PUT',headers:{Authorization:'fixture'},body:'Synthetic retained result'})).status).toBe(200);
 await h.control({hold:'delete'});const pending=h.call('conversion','/retention',{orderId:fixture.id}).catch(()=>null);await h.event('delete');
 const claim=await h.owner`SELECT claimed_until FROM content_retention WHERE object_key=${fixture.key}`;
 await h.services.conversion.kill();await pending;await h.restartEffects();await h.restart('conversion');
 await expect.poll(()=>Date.now()>new Date(claim[0].claimed_until).getTime(),{timeout:65000,intervals:[1000]}).toBe(true);
 await h.call('conversion','/retention',{orderId:fixture.id});
 expect((await fetch(path,{headers:{Authorization:'fixture'}})).status).toBe(404);
 const record=await h.owner`SELECT deleted_at FROM content_retention WHERE object_key=${fixture.key}`;expect(record[0].deleted_at).toBeTruthy();
 await h.call('conversion','/reconcile',{orderId:fixture.id});
 const request=await playwright.request.newContext({baseURL:h.origin});await h.signIn(request);
 const order=await (await request.get(`/api/orders/${fixture.id}`)).json();expect(order.payment.confirmed).toBe(true);expect(order.recovery.execution).toBe('unknown');expect(order.refund.confirmedAt).toBeNull();expect(order.result).toBeNull();
 expect(Number((await h.owner`SELECT count(*) AS n FROM execution_attempts WHERE order_id=${fixture.id}`)[0].n)).toBe(1);
 expect((await h.state()).refunds).toHaveLength(0);await request.dispose();
});
test('aggregate deficit permits affordable debt, persists blockers, and resumes deterministic repayment after refill',async({playwright})=>{
 const first=await fenced(),second=await fenced();
 for(const f of [first,second])expect((await (await h.call('registrar','/register',{orderId:f.id})).json()).status).toBe('registered');
 await h.control({balance:'1000000',allowance:'1000000'});
 const capacity=await (await h.call('registrar','/capacity',{})).json();expect(capacity.status).toBe('deficit');expect(capacity.orders).toBe(2);
 await h.call('refund','/reconcile',{orderId:first.id});await h.call('refund','/reconcile',{orderId:second.id});
 const request=await playwright.request.newContext({baseURL:h.origin});await h.signIn(request);
 expect((await (await request.get(`/api/orders/${first.id}`)).json()).refund.status).toBe('refunded');
 const blocked=await (await request.get(`/api/orders/${second.id}`)).json();expect(blocked.refund.status).toBe('waiting_for_reserve');expect(blocked.refund.confirmedAt).toBeNull();
 await h.restart('refund');await h.restart('registrar');await h.control({balance:'10000000',allowance:'0'});
 await h.call('refund','/reconcile',{orderId:second.id});
 expect((await (await request.get(`/api/orders/${second.id}`)).json()).refund.status).toBe('waiting_for_allowance');
 await h.control({allowance:'10000000'});await Promise.all([1,2].map(()=>h.call('refund','/reconcile',{orderId:second.id})));
 expect((await (await request.get(`/api/orders/${second.id}`)).json()).refund.status).toBe('refunded');expect((await h.state()).refunds).toHaveLength(2);
 const calls=await h.owner`SELECT calls_used FROM recovery_cases`;expect(calls.every(row=>row.calls_used===12)).toBe(true);await request.dispose();
});
test('publication-first recovery after the purchased deadline forbids a later entitlement fence',async({playwright})=>{
 // A labeled synthetic aged payment makes the refund deadline eligible without changing process time.
 const fixture=await h.seed({stopped:true,prepared:true,calls:12});
 const path=h.common.AWS_ENDPOINT_URL_S3+'/'+h.common.OUTPUT_BUCKET+'/'+fixture.key;
 expect((await fetch(path,{method:'PUT',headers:{Authorization:'fixture'},body:'Synthetic retained result'})).status).toBe(200);
 await h.call('conversion','/reconcile',{orderId:fixture.id});
 const request=await playwright.request.newContext({baseURL:h.origin});await h.signIn(request);
 const visible=await (await request.get(`/api/orders/${fixture.id}`)).json();expect(visible.result.available).toBe(true);
 const fence=await h.role('database-registrar')`SELECT mend_refund_fence(${fixture.id}::uuid) AS result`;expect(fence[0].result.reason).toBe('delivery_preferred');
 expect((await (await h.call('registrar','/register',{orderId:fixture.id})).json()).status).toBe('delivered');expect((await h.state()).refunds).toHaveLength(0);await request.dispose();
});
test('entitlement-first ordering rejects a stale publisher and repays once',async({playwright})=>{
 const fixture=await fenced();
 // Entitlement wins the authoritative disposition lock. A stale publisher has no delivery authority.
 const publication={state:'prepared',key:fixture.key,size:4,sha256:'a'.repeat(64),preparedAt:new Date().toISOString()};
 const prepared=await h.role('database-conversion')`SELECT mend_prepare_output(${fixture.attempt}::uuid,${JSON.stringify(publication)}::jsonb) AS result`;
 expect(prepared[0].result).toBe(false);
 const request=await playwright.request.newContext({baseURL:h.origin});await h.signIn(request);
 await h.call('conversion','/reconcile',{orderId:fixture.id});
 expect((await (await request.get(`/api/orders/${fixture.id}`)).json()).result).toBeNull();
 await h.call('refund','/reconcile',{orderId:fixture.id});expect((await (await request.get(`/api/orders/${fixture.id}`)).json()).refund.status).toBe('refunded');
 expect((await h.state()).refunds).toHaveLength(1);await request.dispose();
});
test('fresh UTC allowance observation replaces an exhausted prior-day snapshot after worker restart',async()=>{
 const fixture=await fenced();await h.call('registrar','/register',{orderId:fixture.id});
 await h.control({allowance:'0'});await h.call('refund','/reconcile',{orderId:fixture.id});
 // A labeled prior-day snapshot represents a worker offline across midnight. SQL time is untouched.
 const midnight=new Date();midnight.setUTCHours(0,0,0,0);
 await h.owner`UPDATE refund_capacity SET observed_at=clock_timestamp()-interval '1 day',observation=jsonb_set(observation,'{allowanceResetAt}',${JSON.stringify(midnight.toISOString())}::jsonb) WHERE id='merchant'`;
 await h.restart('registrar');await h.restart('refund');
 // Contract fixture exposes the new UTC day's restored allowance on a newly mined immutable block.
 await h.control({allowance:'10000000',offset:0});
 const refreshed=await (await h.call('registrar','/capacity',{})).json();
 const tomorrow=new Date(midnight.getTime()+86400000).toISOString();expect(refreshed.allowanceResetAt).toBe(tomorrow);expect(refreshed.allowanceAtomic).toBe('10000000');
 await h.call('refund','/reconcile',{orderId:fixture.id});expect((await h.state()).refunds).toHaveLength(1);
});
test('purchase policy survives later configuration and purchase pause while paid recovery continues',async({playwright})=>{
 const purchase=await delayedPurchase(playwright);await h.call('conversion','/experiment',{orderId:purchase.id,mode:'failure'});
 const original=await projected(purchase);
 await h.owner`INSERT INTO recovery_policies(id,created_at,policy) VALUES(gen_random_uuid(),clock_timestamp()+interval '1 second','{"deliverySeconds":1,"maxRetries":0,"automaticRefundAllowance":"1"}'::jsonb)`;
 expect((await purchase.request.post('/api/operator/service',{headers:{Origin:h.origin},data:{reason:'Owned lifecycle controlled incident'}})).status()).toBe(200);
 const replay=await purchase.pay();expect(replay.status()).toBe(200);expect((await replay.json()).terms).toEqual(original.terms);
 const newPurchase=await h.draft(playwright);expect((await newPurchase.pay()).status()).toBe(503);await newPurchase.request.dispose();
 const refund=await h.call('registrar','/register',{orderId:purchase.id});expect((await refund.json()).status).toBe('unresolved');
 const retry=await purchase.request.post(`/api/operator/orders/${purchase.id}/actions`,{headers:{Origin:h.origin},data:{action:'retry'}});expect(retry.status()).toBe(200);
 const finished=await projected(purchase);expect(finished.recovery.attempts).toHaveLength(2);expect(finished.terms).toEqual(original.terms);expect(finished.delivery.deadline).toBe(original.delivery.deadline);expect(finished.result.available).toBe(true);
 expect((await h.state()).charges).toHaveLength(1);await purchase.request.dispose();
});
