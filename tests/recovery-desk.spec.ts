import {test,expect} from '@playwright/test';
const id='00000000-0000-4000-8000-000000000000';
test('private evidence and agent investigation require a signed-in operator',async({request})=>{
  expect((await request.get(`/api/operator/orders/${id}/recovery`)).status()).toBe(401);
  expect((await request.post(`/api/operator/orders/${id}/investigate`,{headers:{Origin:process.env.TEST_BASE_URL!}})).status()).toBe(401);
});
import {privateKeyToAccount} from 'viem/accounts';
import {hexToBytes,type Hex} from 'viem';
import type {Page} from '@playwright/test';
const operator=privateKeyToAccount(`0x${'44'.repeat(32)}`);
async function signIn(request:import('@playwright/test').APIRequestContext,account=operator){
 const issued=await(await request.post('/api/auth/challenge',{headers:{Origin:process.env.TEST_BASE_URL!},data:{address:account.address,chainId:5042002}})).json();
 expect((await request.post('/api/auth/verify',{headers:{Origin:process.env.TEST_BASE_URL!},data:{...issued,signature:await account.signMessage({message:issued.message})}})).status()).toBe(200);
}
test('operator filters paid processing, unpaid and completed records and rejects unknown views',async({request})=>{
 await signIn(request);
 for(const filter of ['unresolved','processing','unpaid','completed']){
  const response=await request.get(`/api/operator/orders?filter=${filter}`);expect(response.status()).toBe(200);
  const body=await response.json();expect(body.filter).toBe(filter);
  for(const order of body.orders){
   if(filter==='unresolved')expect(['unpaid','delivered','refunded']).not.toContain(order.status);
   if(filter==='processing')expect(order.status).toBe('processing');
   if(filter==='unpaid')expect(order.payment.confirmed).toBe(false);
   if(filter==='completed')expect(['delivered','refunded']).toContain(order.status);
  }
 }
 expect((await request.get('/api/operator/orders?filter=anything')).status()).toBe(400);
});
async function wallet(page:Page,index=0,chainId=5042002) {
  await page.exposeFunction('signWalletMessage',async(address:string,message:Hex)=>{
    const account=[operator].find(a=>a.address.toLowerCase()===address.toLowerCase());
    if(!account) throw new Error('Unknown synthetic signer');
    return account.signMessage({message:{raw:hexToBytes(message)}});
  });
  await page.addInitScript(({addresses,index,chainId})=>{
    type Callback=(value:unknown)=>void;
    const listeners=new Map<string,Set<Callback>>();
    let selected=index,chain=chainId,connected=false,reject=false,hold=false,release:(()=>void)|undefined;
    const emit=(event:string,value:unknown)=>listeners.get(event)?.forEach(fn=>fn(value));
    const provider={isMetaMask:true,on(event:string,fn:Callback){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(fn);},removeListener(event:string,fn:Callback){listeners.get(event)?.delete(fn);},async request({method,params}:{method:string,params?:unknown[]}) {
      if(method==='eth_chainId')return '0x'+chain.toString(16);
      if(method==='eth_requestAccounts'){connected=true;return[addresses[selected]];}
      if(method==='eth_accounts')return connected?[addresses[selected]]:[];
      if(method==='wallet_switchEthereumChain'){chain=parseInt((params![0] as {chainId:string}).chainId,16);emit('chainChanged','0x'+chain.toString(16));return null;}
      if(method==='wallet_requestPermissions')return[{parentCapability:'eth_accounts'}];
      if(method==='wallet_getPermissions')return connected?[{parentCapability:'eth_accounts'}]:[];
      if(method==='personal_sign'){
        if(reject){reject=false;throw Object.assign(new Error('User rejected signature'),{code:4001});}
        const [message,address]=params as [string,string];
        if(hold)await new Promise<void>(resolve=>{release=resolve;});
        return (window as unknown as {signWalletMessage:(a:string,m:string)=>Promise<string>}).signWalletMessage(address,message);
      }
      throw Object.assign(new Error('Unsupported synthetic wallet method '+method),{code:-32601});
    }};
    Object.assign(window,{ethereum:provider,__wallet:{get waiting(){return !!release;},switch(index:number){selected=index;emit('accountsChanged',[addresses[selected]]);},reject(){reject=true;},hold(){hold=true;},release(){hold=false;release?.();release=undefined;},chain(id:number){chain=id;emit('chainChanged','0x'+id.toString(16));}}});
  },{addresses:[operator].map(a=>a.address),index,chainId});
}

test('Recovery desk exposes unresolved-first filters and durable evidence without customer downloads',async({page})=>{
 await wallet(page);await page.goto('/recovery');await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByText('Authenticated',{exact:true})).toBeVisible();
 await expect(page.getByLabel('Order view')).toBeVisible();
 await expect(page.getByLabel('Order view')).toHaveValue('unresolved');
 await page.getByLabel('Order view').selectOption('unpaid');
 await expect(page.getByRole('heading',{name:'Unpaid drafts',exact:true})).toBeVisible();
 await page.getByLabel('Order view').selectOption('unresolved');
 const first=page.locator('.order-row').first();
 await expect(first).toBeVisible();
 {
  await first.click();await expect(page.getByRole('heading',{name:'Recovery evidence',exact:true})).toBeVisible();
  await expect(page.getByRole('heading',{name:'Agent action history',exact:true})).toBeVisible();
  if(process.env.RECOVERY_DESK_SCREENSHOT){await page.screenshot({path:process.env.RECOVERY_DESK_SCREENSHOT,fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
 }
});

test('signed customers cannot read operator evidence or invoke recovery',async({request})=>{
 await signIn(request,privateKeyToAccount(`0x${'11'.repeat(32)}`));
 expect((await request.get(`/api/operator/orders/${id}/recovery`)).status()).toBe(403);
 expect((await request.post(`/api/operator/orders/${id}/investigate`,{headers:{Origin:process.env.TEST_BASE_URL!}})).status()).toBe(403);
});
test('unresolved queue keeps escalation first and overdue obligations in deadline order',async({request})=>{
 await signIn(request);
 const response=await request.get('/api/operator/orders');expect(response.status()).toBe(200);
 const {orders}=await response.json();expect(orders.length).toBeGreaterThan(0);
 let seenOrdinary=false,seenNotOverdue=false,lastDeadline=-Infinity;
 const now=Date.now();
 for(const order of orders){
  if(order.agent.escalation){expect(seenOrdinary).toBe(false);continue;}
  seenOrdinary=true;
  const deadline=order.delivery.deadline?Date.parse(order.delivery.deadline):Infinity;
  const overdue=!order.delivery.establishedAt&&deadline<=now;
  if(overdue){expect(seenNotOverdue).toBe(false);expect(deadline).toBeGreaterThanOrEqual(lastDeadline);lastDeadline=deadline;}
  else seenNotOverdue=true;
 }
 const selected=orders.find((order:{agent:{escalation:string|null}})=>order.agent.escalation)||orders[0];
 const history=await request.get(`/api/operator/orders/${selected.id}/recovery`);expect(history.status()).toBe(200);
 const body=await history.json();expect(body.case.callsUsed).toBe(selected.agent.callsUsed);expect(body.case.escalation).toBe(selected.agent.escalation);expect(body.evidence.delivery).toEqual(selected.delivery);
 expect((await request.get('/api/operator/orders/------------------------------------/recovery')).status()).toBe(404);
 expect((await request.post(`/api/operator/orders/${selected.id}/investigate`,{headers:{Origin:'https://attacker.invalid'}})).status()).toBe(403);
});
