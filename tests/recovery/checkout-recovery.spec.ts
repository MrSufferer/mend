import {test,expect,type Page} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {wallet} from '../wallet-fixture';
import {lifecycle,type Lifecycle} from './harness';

let h:Lifecycle;
test.beforeAll(async()=>{h=await lifecycle();});
test.afterAll(async()=>{await h?.close();});
test.beforeEach(async()=>{await h.reset();});

async function authenticate(page:Page){
 await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByText('Authenticated',{exact:true})).toBeVisible();
}
async function validatedSample(page:Page){
 await wallet(page);await page.goto(h.origin);await authenticate(page);
 await page.getByRole('button',{name:'Use sample PDF',exact:true}).click();
 await page.getByLabel('I accept the disclosed purchase terms').check();
 await page.getByRole('button',{name:'Upload and validate PDF',exact:true}).click();
 await expect(page.getByRole('button',{name:'Review payment in wallet',exact:true})).toBeEnabled();
}
async function signingUnavailable(page:Page){
 await page.evaluate(()=>{
  const provider=(window as unknown as {ethereum:{request:(args:{method:string})=>Promise<unknown>}}).ethereum;
  const original=provider.request.bind(provider);
  provider.request=async args=>{if(args.method.startsWith('eth_signTypedData'))throw Object.assign(new Error('Typed-data signing unavailable'),{code:4200});return original(args);};
 });
}

test('lost settled response replays one authorization and downloads the real sample without another job',async({page})=>{
 await validatedSample(page);
 let original='';let orderId='';
 await page.route('**/api/orders/*/payment',async route=>{
  const header=route.request().headers()['payment-signature'];
  if(!header){await route.continue();return;}
  original=header;orderId=new URL(route.request().url()).pathname.split('/')[3];
  const response=await route.fetch({timeout:90000});expect(response.status()).toBe(200);
  await route.abort();
 });
 await page.getByRole('button',{name:'Review payment in wallet',exact:true}).click();
 await expect.poll(()=>original).not.toBe('');
 await expect.poll(async()=>(await h.state()).charges.length).toBe(1);
 await expect(page.getByRole('button',{name:'Check existing payment',exact:true})).toBeEnabled();
 await page.unroute('**/api/orders/*/payment');
 await page.route('**/api/purchase/config',route=>route.abort());await page.reload();await authenticate(page);
 await signingUnavailable(page);
 let replay='';await page.route('**/api/orders/*/payment',async route=>{replay=route.request().headers()['payment-signature']??'';await route.continue();});
 await page.getByRole('button',{name:'Check existing payment',exact:true}).click();
 await expect.poll(()=>replay).toBe(original);
 await expect(page.getByText('Payment confirmed',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Download text result',exact:true})).toBeVisible({timeout:30000});
 const event=page.waitForEvent('download');await page.getByRole('button',{name:'Download text result',exact:true}).click();
 const download=await event;expect(await download.failure()).toBeNull();
 const text=await readFile((await download.path())!,'utf8');
 expect(text).toContain('Mend sample document.');expect(text).toContain('Browser checkout converts this PDF to text.');
 expect((await h.state()).charges).toHaveLength(1);
 const executions=await h.owner`SELECT count(*)::int AS count FROM execution_attempts WHERE order_id=${orderId}::uuid`;
 expect(executions[0].count).toBe(1);
 // The browser can lose its local material; confirmed server ownership still recovers the result.
 await page.evaluate(async()=>{await new Promise<void>((resolve,reject)=>{const request=indexedDB.deleteDatabase('mend-purchase');request.onsuccess=()=>resolve();request.onerror=()=>reject(request.error);});});
 await page.reload();await authenticate(page);
 await expect(page.getByText(orderId,{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Review payment in wallet',exact:true})).toHaveCount(0);
 await expect(page.getByText('Returning on another device or after clearing storage?',{exact:false})).toBeVisible();
});

test('unavailable durable storage blocks upload and leaves no accepted order or payment',async({page})=>{
 await wallet(page);await page.addInitScript(()=>{indexedDB.open=()=>{throw new Error('Synthetic storage unavailable');};});
 await page.goto(h.origin);await authenticate(page);
 await page.getByRole('button',{name:'Use sample PDF',exact:true}).click();
 await page.getByLabel('I accept the disclosed purchase terms').check();
 await expect(page.getByText('Safe private browser storage and cross-tab coordination are required before upload or payment.',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Upload and validate PDF',exact:true})).toHaveCount(0);
 expect((await h.owner`SELECT count(*)::int AS count FROM submissions`)[0].count).toBe(0);
 expect((await h.state()).charges).toHaveLength(0);
});

test('a switched account cannot see the original payer purchase filename or journal',async({page})=>{
 await validatedSample(page);
 await expect(page.getByText('mend-sample.pdf',{exact:true})).toBeVisible();
 await page.evaluate(()=>(window as unknown as {__wallet:{switch(index:number):void}}).__wallet.switch(1));
 await expect(page.getByText('mend-sample.pdf',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Saved purchases')).toHaveCount(0);
 await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByText('Authenticated',{exact:true})).toBeVisible();
 await expect(page.getByText('mend-sample.pdf',{exact:true})).toHaveCount(0);
 await expect(page.getByLabel('Saved purchases')).toHaveCount(0);
 expect((await h.state()).charges).toHaveLength(0);
});

test('unsupported wallet signing preserves an unsigned validated purchase and sends no transfer',async({page})=>{
 await validatedSample(page);await signingUnavailable(page);
 await page.getByRole('button',{name:'Review payment in wallet',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:/signing unavailable|not supported|unsupported/i})).toBeVisible();
 await expect(page.getByRole('button',{name:'Review payment in wallet',exact:true})).toBeEnabled();
 expect((await h.state()).charges).toHaveLength(0);
 expect((await h.owner`SELECT count(*)::int AS count FROM payment_attempts`)[0].count).toBe(0);
});


test('chosen files validate real content, recover from rejection, and support blank pages at phone width',async({page},testInfo)=>{
 await wallet(page);await page.setViewportSize({width:375,height:812});await page.goto(h.origin+'/orders');await authenticate(page);
 await page.getByLabel('Choose a PDF',{exact:true}).setInputFiles({name:'invalid.pdf',mimeType:'application/pdf',buffer:Buffer.from('not a real PDF')});
 await page.getByLabel('I accept the disclosed purchase terms').check();
 await page.getByRole('button',{name:'Upload and validate PDF',exact:true}).click();
 await expect(page.getByRole('status').filter({hasText:/PDF|invalid/i})).toBeVisible();
 expect((await h.owner`SELECT count(*)::int AS count FROM orders`)[0].count).toBe(0);
 await page.getByRole('button',{name:'Start another unsigned draft',exact:true}).click();
 const pdf=await PDFDocument.create();const font=await pdf.embedFont(StandardFonts.Helvetica);
 pdf.addPage().drawText('Chosen document has a supported blank page.',{font,size:14});pdf.addPage();
 await page.getByLabel('Choose a PDF',{exact:true}).setInputFiles({name:'chosen-text-and-blank.pdf',mimeType:'application/pdf',buffer:Buffer.from(await pdf.save())});
 await page.getByLabel('I accept the disclosed purchase terms').check();
 const validate=page.getByRole('button',{name:'Upload and validate PDF',exact:true});
 await validate.focus();await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');expect(await validate.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');await page.keyboard.press('Enter');
 await expect(page.getByRole('button',{name:'Review payment in wallet',exact:true})).toBeEnabled();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 expect((await h.state()).charges).toHaveLength(0);
 await page.screenshot({path:testInfo.outputPath('checkout-phone.png'),fullPage:true});
 await page.setViewportSize({width:1440,height:1000});await page.goto(h.origin);await authenticate(page);
 await page.getByLabel('Saved purchases').selectOption({label:'chosen-text-and-blank.pdf · validated'});
 await expect(page.getByRole('heading',{name:'Your PDF is validated',exact:true})).toBeVisible();
 await page.screenshot({path:testInfo.outputPath('checkout-desktop.png'),fullPage:true});
});


test('a stale second tab reuses the first tab authorization without another wallet signature',async({page,context})=>{
 // Connect both synthetic wallets before creating the shared SIWE session. Connecting
 // a previously disconnected tab deliberately revokes any existing session.
 await wallet(page);await page.goto(h.origin);
 const other=await context.newPage();await wallet(other);await other.goto(h.origin);
 const disconnectedSessionRevoked=other.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/logout'&&response.ok());
 await other.getByRole('button',{name:'Connect wallet',exact:true}).click();
 await disconnectedSessionRevoked;
 await expect(other.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
 await page.bringToFront();await authenticate(page);
 await page.getByRole('button',{name:'Use sample PDF',exact:true}).click();
 await page.getByLabel('I accept the disclosed purchase terms').check();
 await page.getByRole('button',{name:'Upload and validate PDF',exact:true}).click();
 await expect(page.getByRole('button',{name:'Review payment in wallet',exact:true})).toBeEnabled();
 const loadedSession=other.waitForResponse(response=>new URL(response.url()).pathname==='/api/auth/session'&&response.status()===200);
 await other.evaluate(()=>window.dispatchEvent(new Event('focus')));await loadedSession;
 await expect(other.getByText('Authenticated',{exact:true})).toBeVisible();
 await expect(other.getByRole('button',{name:'Review payment in wallet',exact:true})).toBeVisible();
 await other.getByLabel('I accept the disclosed purchase terms').check();
 await page.bringToFront();
 let original='';await page.route('**/api/orders/*/payment',async route=>{const header=route.request().headers()['payment-signature'];if(header){original=header;await route.abort();}else await route.continue();});
 await page.getByRole('button',{name:'Review payment in wallet',exact:true}).click();
 await expect(page.getByRole('button',{name:'Check existing payment',exact:true})).toBeEnabled();expect(original).toBeTruthy();
 await signingUnavailable(other);
 let replay='';await other.route('**/api/orders/*/payment',async route=>{replay=route.request().headers()['payment-signature']??'';await route.abort();});
 await other.getByRole('button',{name:'Review payment in wallet',exact:true}).click();
 await expect.poll(()=>replay).toBe(original);
 await expect(other.getByRole('button',{name:'Check existing payment',exact:true})).toBeEnabled();
 expect((await h.state()).charges).toHaveLength(0);await other.close();
});
