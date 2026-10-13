import {test,expect,type Page} from '@playwright/test';
import {privateKeyToAccount} from 'viem/accounts';
import {hexToBytes,type Hex} from 'viem';
const accounts=['11','22','44'].map(value=>privateKeyToAccount(`0x${value.repeat(32)}`));
async function wallet(page:Page,index=0,chainId=5042002) {
  await page.exposeFunction('signWalletMessage',async(address:string,message:Hex)=>{
    const account=accounts.find(a=>a.address.toLowerCase()===address.toLowerCase());
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
  },{addresses:accounts.map(a=>a.address),index,chainId});
}
async function connect(page:Page) {await page.goto('/');await page.getByRole('button',{name:'Connect wallet',exact:true}).click();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();}
test('connection and actual EOA sign-in are separate; customer cannot enter operator desk',async({page})=>{
  await wallet(page);await connect(page);
  await expect(page.getByText('Wallet connected. Sign in to access private orders.',{exact:true})).toBeVisible();
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByText('Authenticated',{exact:true})).toBeVisible();
  await page.getByRole('link',{name:'Recovery desk',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Operator access required'})).toBeVisible();
});

async function signInBrowser(page:Page) {await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByText('Authenticated',{exact:true})).toBeVisible();}
test('private orders show loading, readable network failure and a working retry',async({page})=>{
  await wallet(page);await connect(page);
  let release!:()=>void;
  const held=new Promise<void>(resolve=>{release=resolve;});
  await page.route('**/api/orders',async route=>{await held;await route.abort('failed');});
  await signInBrowser(page);
  await expect(page.getByRole('status')).toContainText('Loading private orders');
  release();await expect(page.getByRole('heading',{name:'Orders could not load'})).toBeVisible();
  await page.unroute('**/api/orders');await page.getByRole('button',{name:'Retry',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Orders could not load'})).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveCount(0);
  expect((await page.request.get('/api/orders')).status()).toBe(200);
});
async function control(page:Page,method:'switch'|'reject'|'hold'|'release'|'chain',value?:number) {await page.evaluate(({method,value})=>{const wallet=(window as unknown as {__wallet:Record<string,(v?:number)=>void>}).__wallet;wallet[method](value);},{method,value});}
async function browserDraft(page:Page) {
  const {randomBytes,randomUUID,createHash}=await import('node:crypto');const {PDFDocument,StandardFonts}=await import('pdf-lib');
  const document=await PDFDocument.create();document.addPage().drawText('Synthetic private browser document',{font:await document.embedFont(StandardFonts.Helvetica)});
  const bytes=Buffer.from(await document.save()),capability=randomBytes(32).toString('hex'),headers={Authorization:`Bearer ${capability}`};
  const staged=await(await page.request.post('/api/submissions',{headers,data:{idempotencyKey:randomUUID(),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}})).json();
  await page.request.put(staged.upload.url,{headers:staged.upload.headers,data:bytes});
  const completed=await page.request.post(`/api/submissions/${staged.id}/complete`,{headers});expect(completed.status()).toBe(201);
  return {id:(await completed.json()).id as string,capability};
}
test('rejected signatures remain signed out and retry with a fresh real signature',async({page})=>{
  await wallet(page);await connect(page);await control(page,'reject');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect(page.getByRole('status')).toContainText('rejected');expect((await page.request.get('/api/auth/session')).status()).toBe(401);
  await signInBrowser(page);
});
test('wrong network blocks sign-in; switching to Arc permits a real signature',async({page})=>{
  await wallet(page,0,1);await page.goto('/');await page.getByRole('button',{name:'Connect wallet',exact:true}).click();
  await expect(page.getByText('Wrong network. Switch to Arc testnet before signing in.')).toBeVisible();await expect(page.getByRole('button',{name:'Sign in',exact:true})).toHaveCount(0);
  await page.getByRole('button',{name:'Switch to Arc testnet',exact:true}).click();await signInBrowser(page);
  await control(page,'chain',1);await expect(page.getByText('Authenticated',{exact:true})).toHaveCount(0);
  await expect.poll(async()=>(await page.request.get('/api/auth/session')).status()).toBe(401);
});
test('account switching hides claimed private data and revokes the previous cookie before the new wallet signs in',async({page})=>{
  await wallet(page);await connect(page);const draft=await browserDraft(page);await signInBrowser(page);
  await page.getByLabel('Order ID',{exact:true}).fill(draft.id);await page.getByLabel('Private order capability',{exact:true}).fill(draft.capability);await page.getByRole('button',{name:'Claim order',exact:true}).click();
  await expect(page.getByText(draft.id,{exact:true})).toBeVisible();
  await control(page,'switch',1);
  await expect(page.getByText(draft.id,{exact:true})).toHaveCount(0);await expect(page.getByText('Authenticated',{exact:true})).toHaveCount(0);
  await expect.poll(async()=>(await page.request.get(`/api/orders/${draft.id}`)).status()).toBe(401);
  await signInBrowser(page);await expect(page.getByText(draft.id,{exact:true})).toHaveCount(0);
  expect((await page.request.get(`/api/orders/${draft.id}`)).status()).toBe(404);
});
test('switching account during an open signature cannot restore the previous identity',async({page})=>{
  await wallet(page);await connect(page);await control(page,'hold');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__wallet:{waiting:boolean}}).__wallet.waiting)).toBe(true);
  await control(page,'switch',1);await control(page,'release');
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();await expect(page.getByText('Authenticated',{exact:true})).toHaveCount(0);
  expect((await page.request.get('/api/auth/session')).status()).toBe(401);await signInBrowser(page);
  expect((await(await page.request.get('/api/auth/session')).json()).wallet).toBe(accounts[1].address.toLowerCase());
});
test('the configured operator signs in to a genuine empty Recovery desk',async({page})=>{
  test.skip(process.env.TEST_OPERATOR_ADDRESS?.toLowerCase()!==accounts[2].address.toLowerCase(),'Configure local disposable operator fixture.');
  await wallet(page,2);await connect(page);await signInBrowser(page);await page.getByRole('link',{name:'Recovery desk',exact:true}).click();
  await expect(page.getByRole('heading',{name:'No unresolved paid orders'})).toBeVisible();
  expect((await page.request.get('/api/operator/orders')).status()).toBe(200);
});
test('narrow layouts and keyboard sign-in remain usable without horizontal overflow',async({page})=>{
  await wallet(page);await page.setViewportSize({width:375,height:812});await page.goto('/');
  await page.getByRole('button',{name:'Connect wallet',exact:true}).focus();await page.keyboard.press('Enter');
  const sign=page.getByRole('button',{name:'Sign in',exact:true});await expect(sign).toBeEnabled();await sign.focus();
  expect(await sign.evaluate(element=>getComputedStyle(element).outlineStyle)).not.toBe('none');await page.keyboard.press('Enter');
  await expect(page.getByText('Authenticated',{exact:true})).toBeVisible();
  for(const width of [375,768,1280]){await page.setViewportSize({width,height:900});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);}
  await page.getByRole('button',{name:'Sign out',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible();
});
test('expired browser challenge and session give readable fresh-sign-in paths',async({page})=>{
  test.skip(!process.env.AUTH_FIXTURE_SETUP,'Local owner fixture setup not enabled.');
  const {execFileSync}=await import('node:child_process');await wallet(page);await connect(page);
  await page.route('**/api/auth/challenge',async route=>{
    const response=await route.fetch();const issued=await response.json();
    execFileSync('node',['tests/auth-fixture-expiry.mjs','challenge',issued.challengeId],{stdio:'pipe'});
    await route.fulfill({response});
  });
  await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('status')).toContainText('expired');
  await page.unroute('**/api/auth/challenge');await signInBrowser(page);
  execFileSync('node',['tests/auth-fixture-expiry.mjs','session',accounts[0].address.toLowerCase()],{stdio:'pipe'});
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('Authenticated',{exact:true})).toHaveCount(0);await expect(page.getByRole('status')).toContainText('expired');
  await expect(page.getByRole('button',{name:'Sign in',exact:true})).toBeEnabled();
});

test('a wallet prompt returning focus does not cancel the current account signature',async({page})=>{
  await wallet(page);await connect(page);await control(page,'hold');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as unknown as {__wallet:{waiting:boolean}}).__wallet.waiting)).toBe(true);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await control(page,'release');
  await expect(page.getByText('Authenticated',{exact:true})).toBeVisible();
});
test('an in-flight private download cannot open after the connected wallet changes',async({page})=>{
  await wallet(page);await connect(page);const draft=await browserDraft(page);await signInBrowser(page);
  await page.getByLabel('Order ID',{exact:true}).fill(draft.id);await page.getByLabel('Private order capability',{exact:true}).fill(draft.capability);await page.getByRole('button',{name:'Claim order',exact:true}).click();
  await expect(page.getByText(draft.id,{exact:true})).toBeVisible();
  let release!:()=>void,received!:()=>void;
  const gated=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{received=resolve;});
  let grantUrl:string|undefined;
  await page.route('**/api/orders/*/upload',async route=>{const response=await route.fetch();grantUrl=(await response.json()).url;received();await gated;await route.fulfill({response});});
  // Track the issued private grant, independent of deployment/proxy origin or asset requests.
  let privateDownload=false;page.on('request',request=>{if(grantUrl && request.url()===grantUrl)privateDownload=true;});
  await page.getByRole('button',{name:'Download upload',exact:true}).click();await ready;await control(page,'switch',1);
  await expect(page.getByText('Authenticated',{exact:true})).toHaveCount(0);
  const completed=page.waitForResponse(response=>response.url().endsWith(`/api/orders/${draft.id}/upload`));release();await completed;
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  expect(grantUrl).toBeTruthy();
  expect(privateDownload).toBe(false);
});
