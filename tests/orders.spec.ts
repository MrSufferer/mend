import { test, expect } from '@playwright/test';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';
async function document() {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Synthetic Mend acceptance document', {font});
  return Buffer.from(await pdf.save());
}
test('accepted private upload creates recoverable unpaid order with purchased terms', async ({ request }) => {
  const headers = {Authorization: `Bearer ${randomBytes(32).toString('hex')}`};
  const bytes = await document();
  const input = {idempotencyKey: randomUUID(), size: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
  const begin = await request.post('/api/submissions', {headers, data: input});
  expect(begin.status()).toBe(201);
  const submission = await begin.json();
  const uploaded = await request.put(submission.upload.url, {data: bytes, headers: submission.upload.headers});
  expect(uploaded.ok()).toBeTruthy();
  const done = await request.post(`/api/submissions/${submission.id}/complete`, {headers});
  expect(done.status()).toBe(201);
  const order = await done.json();
  expect(order.status).toBe('unpaid');
  expect(order.terms.price).toEqual({amount:'1', currency:'test USDC', network:'Arc testnet'});
  expect(order.terms.deliverySeconds).toBe(120);
  expect(order.terms.maxRetries).toBe(1);
  const recovered = await request.post('/api/submissions', {headers, data: input});
  expect((await recovered.json()).order.id).toBe(order.id);
  const inspected = await request.get(`/api/orders/${order.id}`, {headers});
  expect(await inspected.json()).toEqual(order);
  expect((await request.get(`/api/orders/${order.id}`)).status()).toBe(401);
  expect((await request.get(`/api/orders/${order.id}`, {headers:{Authorization:`Bearer ${randomBytes(32).toString('hex')}`}})).status()).toBe(404);
});

test('every page in an accepted document is text-based; image-only pages are rejected before purchase', async ({ request }) => {
  const pdf=await PDFDocument.create(); const font=await pdf.embedFont(StandardFonts.Helvetica);
  pdf.addPage().drawText('Text cover page',{font});
  const image=await pdf.embedPng(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=','base64'));
  pdf.addPage().drawImage(image,{x:0,y:0,width:100,height:100});
  const bytes=Buffer.from(await pdf.save()); const headers={Authorization:`Bearer ${randomBytes(32).toString('hex')}`};
  const begin=await request.post('/api/submissions',{headers,data:{idempotencyKey:randomUUID(),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
  const staged=await begin.json();
  expect((await request.put(staged.upload.url,{data:bytes,headers:staged.upload.headers})).ok()).toBeTruthy();
  const done=await request.post(`/api/submissions/${staged.id}/complete`,{headers});
  expect(done.status()).toBe(422);
  expect((await done.json()).error).toBe('scanned_pdf');
});

test('a submission preserves disclosed terms when future recovery policy changes', async ({request}) => {
  test.skip(!process.env.POLICY_TEST_ENV_FILE, 'Local owner configuration setup required; not a web credential.');
  const {execFileSync} = await import('node:child_process');
  const {readFileSync}=await import('node:fs'); const {parseEnv}=await import('node:util');
  const localOwner=parseEnv(readFileSync(process.env.POLICY_TEST_ENV_FILE!, 'utf8'));
  const configure=(seconds:string,retries:string)=>execFileSync('npm',['run','policy:set','--',seconds,retries,'10'],{stdio:'pipe',env:{...process.env,...localOwner}});
  configure('120','1');
  const bytes=await document(); const headers={Authorization:`Bearer ${randomBytes(32).toString('hex')}`};
  const start=await request.post('/api/submissions',{headers,data:{idempotencyKey:randomUUID(),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
  const staged=await start.json();
  try {
    configure('60','0');
    await request.put(staged.upload.url,{data:bytes,headers:staged.upload.headers});
    const done=await request.post(`/api/submissions/${staged.id}/complete`,{headers});
    expect((await done.json()).terms.deliverySeconds).toBe(120);
    const next=await request.post('/api/submissions',{headers,data:{idempotencyKey:randomUUID(),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});
    expect((await next.json()).terms.deliverySeconds).toBe(60);
  } finally {configure('120','1');}
});

async function submitBytes(request: import('@playwright/test').APIRequestContext,bytes:Buffer) {
  const headers={Authorization:`Bearer ${randomBytes(32).toString('hex')}`};
  const input={idempotencyKey:randomUUID(),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  const begin=await request.post('/api/submissions',{headers,data:input}); expect(begin.status()).toBe(201);
  const staged=await begin.json();
  expect((await request.put(staged.upload.url,{data:bytes,headers:staged.upload.headers})).ok()).toBeTruthy();
  return {headers,input,staged,done:await request.post(`/api/submissions/${staged.id}/complete`,{headers})};
}
for (const filename of ['encrypted.pdf','empty-password-encrypted.pdf']) {
  test(`rejects ${filename} before creating an order`,async({request})=>{
    const {readFile}=await import('node:fs/promises');
    const {done,headers,input}=await submitBytes(request,await readFile(`tests/fixtures/${filename}`));
    expect(done.status()).toBe(422); expect((await done.json()).error).toBe('encrypted_pdf');
    const retry=await request.post('/api/submissions',{headers,data:input});
    expect(retry.status()).toBe(422); expect((await retry.json()).error).toBe('encrypted_pdf');
  });
}
test('invalid, scanned, and over-page-limit documents are rejected before purchase',async({request})=>{
  const invalid=await submitBytes(request,Buffer.from('not a PDF')); expect(invalid.done.status()).toBe(422); expect((await invalid.done.json()).error).toBe('invalid_pdf');
  const blank=await PDFDocument.create(); blank.addPage();
  const scanned=await submitBytes(request,Buffer.from(await blank.save())); expect(scanned.done.status()).toBe(422); expect((await scanned.done.json()).error).toBe('scanned_pdf');
  const many=await PDFDocument.create(); for(let page=0;page<51;page++) many.addPage();
  const pages=await submitBytes(request,Buffer.from(await many.save())); expect(pages.done.status()).toBe(422); expect((await pages.done.json()).error).toBe('page_limit');
});
test('oversized declarations and document changes cannot create a purchase',async({request})=>{
  const headers={Authorization:`Bearer ${randomBytes(32).toString('hex')}`};
  const input={idempotencyKey:randomUUID(),size:10*1024*1024+1,sha256:'1'.repeat(64)};
  const over=await request.post('/api/submissions',{headers,data:input}); expect(over.status()).toBe(422);
  const bytes=await document(); input.size=bytes.length;
  const start=await request.post('/api/submissions',{headers,data:input}); const staged=await start.json();
  await request.put(staged.upload.url,{data:bytes,headers:staged.upload.headers});
  const changed=await request.post(`/api/submissions/${staged.id}/complete`,{headers});
  expect(changed.status()).toBe(422); expect((await changed.json()).error).toBe('document_mismatch');
});
test('concurrent replay yields one private unpaid order and rejects idempotency reuse for different bytes',async({request})=>{
  const bytes=await document(); const headers={Authorization:`Bearer ${randomBytes(32).toString('hex')}`};
  const input={idempotencyKey:randomUUID(),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
  const starts=await Promise.all([request.post('/api/submissions',{headers,data:input}),request.post('/api/submissions',{headers,data:input})]);
  const staged=await starts[0].json(); expect((await starts[1].json()).id).toBe(staged.id);
  await request.put(staged.upload.url,{data:bytes,headers:staged.upload.headers});
  const completions=await Promise.all([request.post(`/api/submissions/${staged.id}/complete`,{headers}),request.post(`/api/submissions/${staged.id}/complete`,{headers})]);
  const results=await Promise.all(completions.map(r=>r.json())); expect(results[0].id).toBe(results[1].id); expect(results[0].status).toBe('unpaid');
  const conflict=await request.post('/api/submissions',{headers,data:{...input,sha256:'2'.repeat(64)}}); expect(conflict.status()).toBe(409);
  const unauthenticated=await request.get(`/api/orders/${results[0].id}/upload`); expect(unauthenticated.status()).toBe(401);
  const access=await request.get(`/api/orders/${results[0].id}/upload`,{headers}); expect(access.status()).toBe(200);
  const download=await access.json(); expect((await request.get(download.url)).ok()).toBeTruthy();
  const anonymous=new URL(download.url); anonymous.search=''; expect((await request.get(anonymous.toString())).ok()).toBeFalsy();
  // A still-live staging grant can never alter the accepted object.
  await request.put(staged.upload.url,{data:Buffer.alloc(bytes.length,42),headers:staged.upload.headers});
  const saved=await request.get(download.url); expect(await saved.body()).toEqual(bytes);
});

test('direct private upload supports the full 10 MB limit beyond hosting ingress cap',async({request})=>{
  const {PDFRawStream,PDFName}=await import('pdf-lib');
  const pdf=await PDFDocument.create(); const font=await pdf.embedFont(StandardFonts.Helvetica); pdf.addPage().drawText('Large synthetic document',{font});
  const limit=10*1024*1024; let padding=limit-2000; let bytes:Buffer;
  for (let attempt=0;attempt<5;attempt++) {
    const stream=PDFRawStream.of(pdf.context.obj({}),Buffer.alloc(padding,32));
    const reference=pdf.context.register(stream); pdf.catalog.set(PDFName.of('MendSyntheticPadding'),reference);
    bytes=Buffer.from(await pdf.save({useObjectStreams:false}));
    if(bytes.length===limit) break;
    // Replace the same stream instead of leaving prior large streams behind.
    pdf.context.delete(reference); padding+=limit-bytes.length;
  }
  expect(bytes!.length).toBe(limit);
  const {done}=await submitBytes(request,bytes!); expect(done.status()).toBe(201);
  const order=await done.json(); expect(order.upload.size).toBe(limit); expect(order.status).toBe('unpaid');
});
