import { test, expect } from '@playwright/test';
import { privateKeyToAccount } from 'viem/accounts';
const alice=privateKeyToAccount(`0x${'11'.repeat(32)}`);
const origin=process.env.TEST_AUTH_ORIGIN || 'http://127.0.0.1:3022';
const baseURL=process.env.TEST_BASE_URL || origin;
test('a real EOA signature creates an authenticated session and a nonce cannot be replayed',async({request})=>{
  const challenge=await request.post('/api/auth/challenge',{headers:{Origin:origin},data:{address:alice.address,chainId:5042002}});
  expect(challenge.status()).toBe(200);
  const issued=await challenge.json();
  const signature=await alice.signMessage({message:issued.message});
  const verified=await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature}});
  expect(verified.status()).toBe(200);
  expect((await (await request.get('/api/auth/session')).json()).wallet).toBe(alice.address.toLowerCase());
  const replay=await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature}});
  expect(replay.status()).toBe(401);
});

const bob=privateKeyToAccount(`0x${'22'.repeat(32)}`);
async function signIn(request:import('@playwright/test').APIRequestContext,account=alice) {
  const response=await request.post('/api/auth/challenge',{headers:{Origin:origin},data:{address:account.address,chainId:5042002}});
  expect(response.status()).toBe(200);
  const issued=await response.json();
  const result=await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature:await account.signMessage({message:issued.message})}});
  expect(result.status()).toBe(200);
}
async function newOrder(request:import('@playwright/test').APIRequestContext) {
  const {randomBytes,randomUUID,createHash}=await import('node:crypto');
  const {PDFDocument,StandardFonts}=await import('pdf-lib');
  const pdf=await PDFDocument.create(); pdf.addPage().drawText('Synthetic wallet ownership acceptance',{font:await pdf.embedFont(StandardFonts.Helvetica)});
  const bytes=Buffer.from(await pdf.save()),headers={Authorization:`Bearer ${randomBytes(32).toString('hex')}`};
  const input={idempotencyKey:randomUUID(),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  const staged=await(await request.post('/api/submissions',{headers,data:input})).json();
  expect((await request.put(staged.upload.url,{headers:staged.upload.headers,data:bytes})).ok()).toBeTruthy();
  const completed=await request.post(`/api/submissions/${staged.id}/complete`,{headers});expect(completed.status()).toBe(201);
  return {order:await completed.json(),headers,input,submissionId:staged.id};
}
test('only session plus capability claims an unpaid order, and claimed private content rejects other wallets and capability alone',async({request,playwright})=>{
  const draft=await newOrder(request);
  expect((await request.post(`/api/orders/${draft.order.id}/claim`,{headers:{Origin:origin,...draft.headers}})).status()).toBe(401);
  await signIn(request);
  expect((await request.post(`/api/orders/${draft.order.id}/claim`,{headers:{Origin:origin}})).status()).toBe(401);
  const claim=await request.post(`/api/orders/${draft.order.id}/claim`,{headers:{Origin:origin,...draft.headers}});expect(claim.status()).toBe(200);
  expect((await claim.json()).payment.confirmed).toBe(false);
  const listed=await request.get('/api/orders');expect(listed.status()).toBe(200);expect((await listed.json()).orders.map((o:{id:string})=>o.id)).toContain(draft.order.id);
  const other=await playwright.request.newContext({baseURL});
  try {
    expect((await other.get(`/api/orders/${draft.order.id}`,{headers:draft.headers})).status()).toBe(401);
    await signIn(other,bob);
    for(const path of ['', '/upload']) expect((await other.get(`/api/orders/${draft.order.id}${path}`,{headers:draft.headers})).status()).toBe(404);
    expect((await other.post(`/api/orders/${draft.order.id}/claim`,{headers:{Origin:origin,...draft.headers}})).status()).toBe(404);
    expect((await other.post('/api/submissions',{headers:draft.headers,data:draft.input})).status()).toBe(404);
    expect((await other.post(`/api/submissions/${draft.submissionId}/complete`,{headers:draft.headers})).status()).toBe(404);
    expect((await other.get('/api/operator/orders')).status()).toBe(403);
    expect((await request.get(`/api/orders/${draft.order.id}/upload`)).status()).toBe(200);
  } finally {await other.dispose();}
});

test('origin, network, canonical message, browser binding and actual signature are required',async({request,playwright})=>{
  const input={address:alice.address,chainId:5042002};
  expect((await request.post('/api/auth/challenge',{data:input})).status()).toBe(403);
  expect((await request.post('/api/auth/challenge',{headers:{Origin:'https://attacker.invalid'},data:input})).status()).toBe(403);
  expect((await request.post('/api/auth/challenge',{headers:{Origin:origin},data:{...input,chainId:1}})).status()).toBe(400);
  const issued=await(await request.post('/api/auth/challenge',{headers:{Origin:origin},data:input})).json();
  const signature=await alice.signMessage({message:issued.message});
  const other=await playwright.request.newContext({baseURL});
  try {expect((await other.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature}})).status()).toBe(401);} finally {await other.dispose();}
  const mutations=[issued.message.replace(new URL(origin).host,'attacker.invalid'),issued.message.replace(`URI: ${origin}`,'URI: https://attacker.invalid'),issued.message.replace('Chain ID: 5042002','Chain ID: 1'),issued.message.replace('Version: 1','Version: 2'),issued.message.replace(alice.address,bob.address),issued.message+'\nResources:\n- https://attacker.invalid'];
  for(const message of mutations) expect((await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,message,signature:await alice.signMessage({message})}})).status()).toBe(401);
  expect((await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature:await bob.signMessage({message:issued.message})}})).status()).toBe(401);
  expect((await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature}})).status()).toBe(200);
  expect((await request.post('/api/auth/logout',{headers:{Origin:'https://attacker.invalid'}})).status()).toBe(403);
  expect((await request.post('/api/auth/logout',{headers:{Origin:origin}})).status()).toBe(200);
  expect((await request.get('/api/auth/session')).status()).toBe(401);
});
test('concurrent verification consumes a challenge once and replacement revokes the preceding session',async({request,playwright})=>{
  await signIn(request);
  const saved=await request.storageState();
  const preceding=await playwright.request.newContext({baseURL,storageState:saved});
  try {
    const issued=await(await request.post('/api/auth/challenge',{headers:{Origin:origin},data:{address:bob.address,chainId:5042002}})).json();
    const payload={...issued,signature:await bob.signMessage({message:issued.message})};
    const results=await Promise.all([request.post('/api/auth/verify',{headers:{Origin:origin},data:payload}),request.post('/api/auth/verify',{headers:{Origin:origin},data:payload})]);
    expect(results.map(r=>r.status()).sort()).toEqual([200,401]);
    expect((await preceding.get('/api/auth/session')).status()).toBe(401);
    expect((await(await request.get('/api/auth/session')).json()).wallet).toBe(bob.address.toLowerCase());
  } finally {await preceding.dispose();}
});
test('expired challenges and expired sessions require a fresh sign-in',async({request})=>{
  test.skip(!process.env.AUTH_FIXTURE_SETUP,'Local owner fixture setup not enabled.');
  const {execFileSync}=await import('node:child_process');
  const fixture=privateKeyToAccount(`0x${'33'.repeat(32)}`);
  const issued=await(await request.post('/api/auth/challenge',{headers:{Origin:origin},data:{address:fixture.address,chainId:5042002}})).json();
  execFileSync('node',['tests/auth-fixture-expiry.mjs','challenge',issued.challengeId],{stdio:'pipe'});
  expect((await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature:await fixture.signMessage({message:issued.message})}})).status()).toBe(401);
  await signIn(request,fixture);
  execFileSync('node',['tests/auth-fixture-expiry.mjs','session',fixture.address.toLowerCase()],{stdio:'pipe'});
  const session=await request.get('/api/auth/session');expect(session.status()).toBe(401);expect((await session.json()).error).toBe('session_expired');
});
test('a simultaneous cross-wallet claim has one owner and can never be rebound',async({request,playwright})=>{
  const draft=await newOrder(request);await signIn(request);
  const other=await playwright.request.newContext({baseURL});
  try {
    await signIn(other,bob);
    const responses=await Promise.all([request,other].map(context=>context.post(`/api/orders/${draft.order.id}/claim`,{headers:{Origin:origin,...draft.headers}})));
    expect(responses.map(r=>r.status()).sort()).toEqual([200,404]);
    const denied=responses[0].status()===200?other:request;
    expect((await denied.get(`/api/orders/${draft.order.id}`)).status()).toBe(404);
    expect((await denied.post(`/api/orders/${draft.order.id}/claim`,{headers:{Origin:origin,...draft.headers}})).status()).toBe(404);
  } finally {await other.dispose();}
});
