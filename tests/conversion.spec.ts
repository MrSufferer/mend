import {test,expect,type APIRequestContext} from '@playwright/test';
import {privateKeyToAccount} from 'viem/accounts';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {PDFDocument,StandardFonts} from 'pdf-lib';
const origin=process.env.TEST_AUTH_ORIGIN||'http://127.0.0.1:3028';
async function signIn(request:APIRequestContext,account:ReturnType<typeof privateKeyToAccount>) {
 const issued=await(await request.post('/api/auth/challenge',{headers:{Origin:origin},data:{address:account.address,chainId:5042002}})).json();
 expect((await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature:await account.signMessage({message:issued.message})}})).status()).toBe(200);
}
async function draft(request:APIRequestContext) {
 const pdf=await PDFDocument.create();pdf.addPage().drawText('Verified plain text conversion',{font:await pdf.embedFont(StandardFonts.Helvetica)});const bytes=Buffer.from(await pdf.save());
 const headers={Authorization:`Bearer ${randomBytes(32).toString('hex')}`};const start=await request.post('/api/submissions',{headers,data:{idempotencyKey:randomUUID(),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});expect(start.status()).toBe(201);const staged=await start.json();expect((await request.put(staged.upload.url,{headers:staged.upload.headers,data:bytes})).ok()).toBe(true);const complete=await request.post(`/api/submissions/${staged.id}/complete`,{headers});expect(complete.status()).toBe(201);return {headers,order:await complete.json()};
}
test('an authenticated unpaid order cannot produce a result or start conversion',async({request})=>{
 const saved=await draft(request);await signIn(request,privateKeyToAccount(`0x${'11'.repeat(32)}`));
 expect((await request.post(`/api/orders/${saved.order.id}/claim`,{headers:{Origin:origin,...saved.headers}})).status()).toBe(200);
 expect((await request.get(`/api/orders/${saved.order.id}/result`)).status()).toBe(409);
 const status=await(await request.get(`/api/orders/${saved.order.id}`)).json();expect(status.payment.processingStarted).toBe(false);
});
test('a real paid PDF becomes available separately from its authenticated download',async({request,playwright})=>{
 test.skip(!process.env.PAYMENT_TEST_PURCHASER_ENV,'Dedicated purchaser required.');
 const {readFileSync,writeFileSync,existsSync}=await import('node:fs');const {parseEnv}=await import('node:util');const {x402Client}=await import('@x402/core/client');const {ExactEvmScheme}=await import('@x402/evm/exact/client');
 const env=parseEnv(readFileSync(process.env.PAYMENT_TEST_PURCHASER_ENV!,'utf8'));const payer=privateKeyToAccount(env.TEST_PURCHASER_PRIVATE_KEY as `0x${string}`);
 const path=process.env.CONVERSION_TEST_STATE||'/private/tmp/mend-ticket5-normal.json';let saved:any;
 if(existsSync(path))saved=JSON.parse(readFileSync(path,'utf8'));
 else {saved=await draft(request);const challenge=await request.post(`/api/orders/${saved.order.id}/payment`,{headers:saved.headers});const required=JSON.parse(Buffer.from(challenge.headers()['payment-required'],'base64').toString());const client=new x402Client().register('eip155:5042002',new ExactEvmScheme(payer));saved.signature=Buffer.from(JSON.stringify(await client.createPaymentPayload(required))).toString('base64');writeFileSync(path,JSON.stringify(saved),{mode:0o600});}
 const headers={...saved.headers,'PAYMENT-SIGNATURE':saved.signature};
 await Promise.all([request.post(`/api/orders/${saved.order.id}/payment`,{headers}),request.post(`/api/orders/${saved.order.id}/payment`,{headers})]);
 await signIn(request,payer);
 const status=await(await request.get(`/api/orders/${saved.order.id}`)).json();
 expect(status.result?.available).toBe(true);expect(status.delivery?.establishedAt).toBeTruthy();
 const originalExpiry=status.result.expiresAt,originalDelivery=status.delivery.establishedAt;
 const anonymous=await playwright.request.newContext({baseURL:origin});try{expect((await anonymous.get(`/api/orders/${saved.order.id}/result`,{headers:saved.headers})).status()).toBe(401);await signIn(anonymous,privateKeyToAccount(`0x${'22'.repeat(32)}`));expect((await anonymous.get(`/api/orders/${saved.order.id}/result`)).status()).toBe(404);}finally{await anonymous.dispose();}
 const download=await request.get(`/api/orders/${saved.order.id}/result`);expect(download.status()).toBe(200);expect(download.headers()['content-type']).toContain('text/plain');expect(await download.text()).toContain('Verified plain text conversion');
 const after=await(await request.get(`/api/orders/${saved.order.id}`)).json();expect(after.result.expiresAt).toBe(originalExpiry);expect(after.delivery.establishedAt).toBe(originalDelivery);expect(after.result.lastDownloadAt).toBeTruthy();expect(new Date(after.result.expiresAt).getTime()-new Date(after.result.createdAt).getTime()).toBe(7*86400000);expect(after.upload.expiresAt).not.toBe(after.result.expiresAt);
});

// Management credentials stay in this local test process, never the application/function.
test('an expired delivered result returns 410 without extending retention or download activity',async({request})=>{
 test.skip(!process.env.CONVERSION_FIXTURE_DB_ENV||!process.env.PAYMENT_TEST_PURCHASER_ENV,'Isolated fixture and purchaser required.');
 const {readFileSync}=await import('node:fs');const {parseEnv}=await import('node:util');const {neon}=await import('@neondatabase/serverless');
 const saved=JSON.parse(readFileSync(process.env.CONVERSION_TEST_STATE||'/private/tmp/mend-ticket5-normal.json','utf8'));
 const payer=privateKeyToAccount(parseEnv(readFileSync(process.env.PAYMENT_TEST_PURCHASER_ENV!,'utf8')).TEST_PURCHASER_PRIVATE_KEY as `0x${string}`);await signIn(request,payer);
 const sql=neon(parseEnv(readFileSync(process.env.CONVERSION_FIXTURE_DB_ENV!,'utf8')).DATABASE_URL_UNPOOLED);
 const [original]=await sql`SELECT result,last_download_at FROM orders WHERE id=${saved.order.id}`;
 const expired={...original.result,expiresAt:'2000-01-01T00:00:00.000Z'};
 try {
  await sql`UPDATE orders SET result=${JSON.stringify(expired)}::jsonb WHERE id=${saved.order.id}`;
  expect((await request.get(`/api/orders/${saved.order.id}/result`)).status()).toBe(410);
  const status=await(await request.get(`/api/orders/${saved.order.id}`)).json();expect(status.result.available).toBe(false);expect(status.outcome).toBe('Delivered result expired');expect(status.delivery.establishedAt).toBeTruthy();expect(status.result.lastDownloadAt).toBe(original.last_download_at?new Date(original.last_download_at).toISOString():null);
 }finally{await sql`UPDATE orders SET result=${JSON.stringify(original.result)}::jsonb WHERE id=${saved.order.id}`;}
});

test('a controlled input integrity failure preserves the paid obligation without publishing a result',async({request})=>{
 test.skip(!process.env.CONVERSION_FIXTURE_DB_ENV||!process.env.PAYMENT_TEST_PURCHASER_ENV,'Isolated fixture and purchaser required.');
 const {readFileSync,writeFileSync,existsSync}=await import('node:fs');const {parseEnv}=await import('node:util');const {neon}=await import('@neondatabase/serverless');const {x402Client}=await import('@x402/core/client');const {ExactEvmScheme}=await import('@x402/evm/exact/client');
 const payer=privateKeyToAccount(parseEnv(readFileSync(process.env.PAYMENT_TEST_PURCHASER_ENV!,'utf8')).TEST_PURCHASER_PRIVATE_KEY as `0x${string}`);
 const sql=neon(parseEnv(readFileSync(process.env.CONVERSION_FIXTURE_DB_ENV!,'utf8')).DATABASE_URL_UNPOOLED),path='/private/tmp/mend-ticket5-failure.json';let saved:any;
 if(existsSync(path))saved=JSON.parse(readFileSync(path,'utf8'));
 else {
  saved=await draft(request);const [original]=await sql`SELECT upload_sha256 FROM orders WHERE id=${saved.order.id}`;saved.originalHash=original.upload_sha256;
  const challenge=await request.post(`/api/orders/${saved.order.id}/payment`,{headers:saved.headers});const required=JSON.parse(Buffer.from(challenge.headers()['payment-required'],'base64').toString());const client=new x402Client().register('eip155:5042002',new ExactEvmScheme(payer));saved.signature=Buffer.from(JSON.stringify(await client.createPaymentPayload(required))).toString('base64');writeFileSync(path,JSON.stringify(saved),{mode:0o600});
 }
 await sql`UPDATE orders SET upload_sha256=${'0'.repeat(64)} WHERE id=${saved.order.id} AND paid_at IS NULL`;
 try {
  await expect.poll(async()=> (await request.post(`/api/orders/${saved.order.id}/payment`,{headers:{...saved.headers,'PAYMENT-SIGNATURE':saved.signature}})).status(),{timeout:30000,intervals:[1000,2000,3000]}).toBe(200);
  await signIn(request,payer);const status=await(await request.get(`/api/orders/${saved.order.id}`)).json();expect(status.payment.confirmed).toBe(true);expect(status.outcome).toBe('Conversion needs recovery');expect(status.result).toBeNull();expect(status.delivery.establishedAt).toBeNull();expect((await request.get(`/api/orders/${saved.order.id}/result`)).status()).toBe(409);expect(JSON.stringify(status)).not.toContain('upload_integrity');
 }finally{await sql`UPDATE orders SET upload_sha256=${saved.originalHash} WHERE id=${saved.order.id}`;}
});

test('the paying wallet downloads its real result with the keyboard on a narrow customer page',async({page})=>{
 test.skip(!process.env.PAYMENT_TEST_PURCHASER_ENV,'Dedicated purchaser required.');
 const {readFileSync}=await import('node:fs');const {parseEnv}=await import('node:util');const {hexToBytes}=await import('viem');
 const payer=privateKeyToAccount(parseEnv(readFileSync(process.env.PAYMENT_TEST_PURCHASER_ENV!,'utf8')).TEST_PURCHASER_PRIVATE_KEY as `0x${string}`),saved=JSON.parse(readFileSync('/private/tmp/mend-ticket5-normal.json','utf8'));
 await page.exposeFunction('signPurchaseWalletMessage',(message:`0x${string}`)=>payer.signMessage({message:{raw:hexToBytes(message)}}));
 await page.addInitScript(({address})=>{
  let connected=false;const listeners=new Map<string,Set<(value:unknown)=>void>>();
  Object.assign(window,{ethereum:{isMetaMask:true,on(event:string,callback:(value:unknown)=>void){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(callback);},removeListener(event:string,callback:(value:unknown)=>void){listeners.get(event)?.delete(callback);},async request({method,params}:{method:string;params?:string[]}){
   if(method==='eth_chainId')return '0x4cef52';if(method==='eth_requestAccounts'){connected=true;return[address];}if(method==='eth_accounts')return connected?[address]:[];if(method==='wallet_requestPermissions')return[{parentCapability:'eth_accounts'}];if(method==='wallet_getPermissions')return connected?[{parentCapability:'eth_accounts'}]:[];
   if(method==='personal_sign')return (window as unknown as {signPurchaseWalletMessage:(m:string)=>Promise<string>}).signPurchaseWalletMessage(params![0]);throw new Error('Unsupported test wallet method');
  }}});
 },{address:payer.address});
 await page.setViewportSize({width:375,height:812});await page.goto('/orders');await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByText('Authenticated',{exact:true})).toBeVisible();
 await page.getByRole('button').filter({has:page.getByText(saved.order.id.slice(0,8),{exact:true})}).click();
 await expect(page.getByRole('heading',{name:'Result available',exact:true})).toBeVisible();await expect(page.getByRole('link',{name:'View confirmed payment on Arc explorer'})).toBeVisible();
 const button=page.getByRole('button',{name:'Download text result',exact:true});await button.focus();expect(await button.evaluate(element=>element===document.activeElement)).toBe(true);
 const event=page.waitForEvent('download');await page.keyboard.press('Enter');const download=await event;expect(download.suggestedFilename()).toBe('result.txt');const stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(chunk);expect(Buffer.concat(chunks).toString()).toContain('Verified plain text conversion');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
