import {test,expect} from '@playwright/test';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {PDFDocument,StandardFonts} from 'pdf-lib';
async function draft(request:import('@playwright/test').APIRequestContext) {
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);pdf.addPage().drawText('Payment lifecycle acceptance',{font});const bytes=Buffer.from(await pdf.save());
 const headers={Authorization:`Bearer ${randomBytes(32).toString('hex')}`};const start=await request.post('/api/submissions',{headers,data:{idempotencyKey:randomUUID(),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});expect(start.status()).toBe(201);const staged=await start.json();await request.put(staged.upload.url,{headers:staged.upload.headers,data:bytes});const done=await request.post(`/api/submissions/${staged.id}/complete`,{headers});expect(done.status()).toBe(201);return {headers,order:await done.json()};
}
test('unpaid order advertises exact 1 test USDC x402 challenge and stays gated',async({request})=>{
 const {headers,order}=await draft(request);const response=await request.post(`/api/orders/${order.id}/payment`,{headers});expect(response.status()).toBe(402);
 const challenge=JSON.parse(Buffer.from(response.headers()['payment-required'],'base64').toString());expect(challenge.x402Version).toBe(2);expect(challenge.accepts[0]).toMatchObject({scheme:'exact',network:'eip155:5042002',amount:'1000000',asset:'0x3600000000000000000000000000000000000000'});
 const status=await request.get(`/api/orders/${order.id}`,{headers});expect((await status.json()).payment.confirmed).toBe(false);
});
test('real Arcus settlement survives response loss, concurrent replay and receipt reuse',async({request})=>{
 test.skip(!process.env.PAYMENT_TEST_PURCHASER_ENV,'Dedicated purchaser required; real test spends 1 test USDC.');
 const {readFileSync,writeFileSync,existsSync}=await import('node:fs');const {parseEnv}=await import('node:util');const {privateKeyToAccount}=await import('viem/accounts');const {x402Client}=await import('@x402/core/client');const {ExactEvmScheme}=await import('@x402/evm/exact/client');
 const stateFile=process.env.PAYMENT_TEST_STATE_FILE||'/private/tmp/mend-ticket4-live-state.json';let saved:any;
 if(existsSync(stateFile)) saved=JSON.parse(readFileSync(stateFile,'utf8'));
 else {const {headers,order}=await draft(request);const challenge=await request.post(`/api/orders/${order.id}/payment`,{headers});const required=JSON.parse(Buffer.from(challenge.headers()['payment-required'],'base64').toString());const env=parseEnv(readFileSync(process.env.PAYMENT_TEST_PURCHASER_ENV!,'utf8'));const signer=privateKeyToAccount(env.TEST_PURCHASER_PRIVATE_KEY as `0x${string}`);const client=new x402Client().register('eip155:5042002',new ExactEvmScheme(signer));const payload=await client.createPaymentPayload(required);saved={headers,order,signature:Buffer.from(JSON.stringify(payload)).toString('base64'),payer:signer.address.toLowerCase()};writeFileSync(stateFile,JSON.stringify(saved),{mode:0o600});}
 const headers={...saved.headers,'PAYMENT-SIGNATURE':saved.signature};
 const responses=await Promise.all([request.post(`/api/orders/${saved.order.id}/payment`,{headers}),request.post(`/api/orders/${saved.order.id}/payment`,{headers})]);for(const r of responses)expect([200,202],`Payment returned ${r.status()}: ${(await r.json()).error??'no error'}`).toContain(r.status());
 // Treat both initial responses as lost. Reconcile the same authorization.
 await expect.poll(async()=>{const r=await request.post(`/api/orders/${saved.order.id}/payment`,{headers});const b=await r.json();return b.payment?.confirmed;},{timeout:60000}).toBe(true);
 const reconciled=await request.post(`/api/orders/${saved.order.id}/payment`,{headers});expect(reconciled.headers()['payment-response']).toBeTruthy();const confirmed=await reconciled.json();expect(confirmed.status).toBe('paid');expect(confirmed.payment.payer).toBe(saved.payer);expect(confirmed.payment.amount).toBe('1');expect(confirmed.payment.currency).toBe('test USDC');expect(confirmed.payment.transaction).toMatch(/^0x[0-9a-f]{64}$/);expect(confirmed.payment.processingStarted).toBe(false);expect(confirmed.payment.receipt).toMatchObject({status:'success',amountAtomic:'1000000',decimals:6});expect(confirmed.payment.receipt.blockNumber).toMatch(/^[0-9]+$/);
 const other=await draft(request);const reuse=await request.post(`/api/orders/${other.order.id}/payment`,{headers:{...other.headers,'PAYMENT-SIGNATURE':saved.signature}});expect(reuse.status()).toBe(409);
});
