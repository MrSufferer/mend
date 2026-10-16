import {test,expect,type Page} from '@playwright/test';
import {wallet} from '../wallet-fixture';
import {lifecycle,type Lifecycle} from './harness';

let h:Lifecycle;
test.beforeAll(async()=>{h=await lifecycle();});
test.afterAll(async()=>{await h?.close();});
test.beforeEach(async()=>{await h.reset();});

async function activateWithKeyboard(page:Page,name:string){
 const button=page.getByRole('button',{name,exact:true});
 await expect(button).toBeEnabled();
 for(let steps=0;steps<50&&!await button.evaluate(element=>element===document.activeElement);steps++)await page.keyboard.press('Tab');
 await expect(button).toBeFocused();
 expect(await button.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');
 await page.keyboard.press('Enter');
}
async function connect(page:Page){
 await wallet(page);await page.setViewportSize({width:375,height:812});
 const hydrated=page.waitForResponse(response=>response.url()===h.origin+'/api/auth/session');
 await page.goto(h.origin+'/orders');await hydrated;
 await activateWithKeyboard(page,'Connect wallet');
 await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
}
async function signIn(page:Page){
 await activateWithKeyboard(page,'Sign in');await expect(page.getByText('Authenticated',{exact:true})).toBeVisible();
}
async function switchWallet(page:Page){
 await page.evaluate(()=>(window as unknown as {__wallet:{switch(index:number):void}}).__wallet.switch(1));
 await expect(page.getByText('Authenticated',{exact:true})).toHaveCount(0);
 await expect.poll(async()=>(await page.request.get(h.origin+'/api/auth/session')).status()).toBe(401);
}


test('narrow keyboard flow shows durable uncertainty and a customer-safe timeline after worker death',async({page,playwright})=>{
 const purchase=await h.paidWithPausedExecution(playwright);
 await h.call('conversion','/experiment',{orderId:purchase.id,mode:'noack'}).catch(()=>null);
 await h.restart('conversion');await h.call('conversion','/stop',{orderId:purchase.id});
 await h.call('conversion','/reconcile',{orderId:purchase.id});
 await connect(page);
 expect((await page.request.get(h.origin+'/api/orders/'+purchase.id)).status()).toBe(401);
 await signIn(page);await expect(page.getByText(purchase.id,{exact:true})).toBeVisible();
 await page.getByText('Order history',{exact:true}).click();
 await expect(page.getByRole('heading',{name:'Order timeline',exact:true})).toBeVisible();
 await page.locator('summary').filter({hasText:/^Conversion attempts$/}).click();
 await page.getByText('Refund details',{exact:true}).click();
 await expect(page.getByText('Whole execution has no confirmed stop.',{exact:false})).toBeVisible();
 await expect(page.getByText('Funds have no confirmed return receipt.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Download text result',exact:true})).toHaveCount(0);
 const response=await page.request.get(h.origin+'/api/orders/'+purchase.id);expect(response.status()).toBe(200);
 const order=await response.json();expect(order.recovery.execution).toBe('unknown');expect(order.refund.confirmedAt).toBeNull();
 const visibleTimeline=JSON.stringify(order.timeline);
 for(const privateField of ['raw_transaction','capability_hash','DATABASE_URL',h.secret])expect(visibleTimeline.includes(privateField)).toBe(false);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await activateWithKeyboard(page,'Sign out');await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible();
 await purchase.request.dispose();
});

test('restored private result downloads from the keyboard and disappears on wallet switch',async({page,playwright})=>{
 const purchase=await h.paidWithPausedExecution(playwright);
 expect((await h.call('conversion','/experiment',{orderId:purchase.id,mode:'publication'})).status).toBe(200);
 await h.restart('conversion');await h.call('conversion','/reconcile',{orderId:purchase.id});
 await connect(page);await signIn(page);await expect(page.getByText(purchase.id,{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'Result available',exact:true})).toBeVisible();
 await expect(page.getByText('No refund action needed.',{exact:false})).toHaveCount(0);
 await expect(page.getByText('Funds have no confirmed return receipt.',{exact:false})).not.toBeVisible();
 const downloaded=page.waitForEvent('download');await activateWithKeyboard(page,'Download text result');
 const file=await downloaded;expect(await file.failure()).toBeNull();expect(file.suggestedFilename()).toMatch(/\.txt$/);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await switchWallet(page);await expect(page.getByText(purchase.id,{exact:true})).toHaveCount(0);
 await signIn(page);await expect(page.getByText(purchase.id,{exact:true})).toHaveCount(0);
 for(const suffix of ['', '/upload','/result'])expect((await page.request.get(h.origin+'/api/orders/'+purchase.id+suffix)).status()).toBe(404);
 await purchase.request.dispose();
});

test('rejection, expired challenge and expired session offer fresh real-signature recovery',async({page})=>{
 await connect(page);
 await page.evaluate(()=>(window as unknown as {__wallet:{reject():void}}).__wallet.reject());
 await activateWithKeyboard(page,'Sign in');await expect(page.getByRole('status')).toContainText('rejected');
 expect((await page.request.get(h.origin+'/api/auth/session')).status()).toBe(401);
 await page.route('**/api/auth/challenge',async route=>{
  const response=await route.fetch(),issued=await response.json();
  await h.owner`UPDATE auth_challenges SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${issued.challengeId}::uuid`;
  await route.fulfill({response});
 });
 await activateWithKeyboard(page,'Sign in');await expect(page.getByRole('status')).toContainText('expired');
 await page.unroute('**/api/auth/challenge');await signIn(page);
 const session=await(await page.request.get(h.origin+'/api/auth/session')).json();
 await h.owner`UPDATE auth_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE wallet=${session.wallet}`;
 await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await expect(page.getByText('Authenticated',{exact:true})).toHaveCount(0);await expect(page.getByRole('status')).toContainText('expired');
 await signIn(page);
});

test('wallet switch during an in-flight restored result download prevents opening private bytes',async({page,playwright})=>{
 const purchase=await h.paidWithPausedExecution(playwright);
 expect((await h.call('conversion','/experiment',{orderId:purchase.id,mode:'publication'})).status).toBe(200);
 await h.restart('conversion');await h.call('conversion','/reconcile',{orderId:purchase.id});
 await connect(page);await signIn(page);await expect(page.getByText(purchase.id,{exact:true})).toBeVisible();
 let release!:()=>void,received!:()=>void;
 const held=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{received=resolve;});
 await page.route('**/api/orders/*/result',async route=>{const response=await route.fetch();received();await held;await route.fulfill({response});});
 let downloads=0;page.on('download',()=>{downloads++;});
 await activateWithKeyboard(page,'Download text result');await ready;await switchWallet(page);
 const completed=page.waitForResponse(response=>response.url().endsWith('/api/orders/'+purchase.id+'/result'));
 release();await completed;
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 expect(downloads).toBe(0);await signIn(page);
 expect((await page.request.get(h.origin+'/api/orders/'+purchase.id+'/result')).status()).toBe(404);
 await purchase.request.dispose();
});
