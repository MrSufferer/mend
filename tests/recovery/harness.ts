import {expect,type APIRequestContext,type APIRequest} from '@playwright/test';
import {neon} from '@neondatabase/serverless';
import {createServer} from 'node:net';
import {spawn,type ChildProcess} from 'node:child_process';
import {existsSync,mkdtempSync,readFileSync,writeFileSync,appendFileSync,rmSync,symlinkSync,realpathSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {parseEnv} from 'node:util';
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {build} from 'esbuild';
import {privateKeyToAccount} from 'viem/accounts';
import {PDFDocument,StandardFonts} from 'pdf-lib';
import {purchasedTerms,defaultPolicy} from '../../lib/server/terms';
const guard='mend_ticket16_lifecycle';
type Playwright={request:APIRequest};
export const payer=privateKeyToAccount(`0x${'11'.repeat(32)}`),other=privateKeyToAccount(`0x${'22'.repeat(32)}`);
const roleNames=['migration','database-web','database-conversion','database-worker','database-registrar','database-refund-worker','database-payment-reconciler'];
async function port(){const server=createServer();await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const p=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));return p;}
export type Owned={pid:number;url:string;kill(signal?:NodeJS.Signals):Promise<void>};
export type Lifecycle=Awaited<ReturnType<typeof lifecycle>>;
export async function lifecycle(){
 if(['.env','.env.local','.env.development','.env.development.local'].some(path=>existsSync(path)))throw Error('Refusing automatic Next dotenv loading; run recovery tests from a clean isolated checkout');
 const directory=process.env.RECOVERY_ENV_DIR;if(!directory)throw Error('RECOVERY_ENV_DIR is required; no legacy/default credentials are read');
 const envs=Object.fromEntries(roleNames.map(name=>{const parsed=parseEnv(readFileSync(join(directory,name+'.env'),'utf8')),value=parsed.DATABASE_URL_UNPOOLED??parsed.DATABASE_URL;if(!value||new URL(value).pathname!=='/'+guard)throw Error('Refusing nonisolated database destination');return [name,{DATABASE_URL:value}];}));
 // Destination verification happens for EVERY role before the first fixture write.
 const expectedRoles:Record<string,string>={migration:'neondb_owner','database-web':'mend_web','database-conversion':'mend_conversion','database-worker':'mend_worker','database-registrar':'mend_registrar','database-refund-worker':'mend_refund_worker','database-payment-reconciler':'mend_ticket16_receipts'};
 for(const name of roleNames){const identity=await neon(envs[name].DATABASE_URL)`SELECT current_database() AS database,current_user AS role`;if(identity[0].database!==guard||identity[0].role!==expectedRoles[name])throw Error('Isolated database/role identity mismatch: '+name);}
 const owner=neon(envs.migration.DATABASE_URL);
 const journal=JSON.parse(readFileSync('drizzle/meta/_journal.json','utf8'));
 const expectedHashes=journal.entries.map((entry:{tag:string})=>createHash('sha256').update(readFileSync(join('drizzle',entry.tag+'.sql'))).digest('hex'));
 const applied=await owner`SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at,id`;
 if(expectedHashes.length!==47||applied.length!==expectedHashes.length||applied.some((row,index)=>row.hash!==expectedHashes[index]))throw Error('Expected exact ticket15 migration prefix through 0046_private_retention');
 await owner`CREATE TABLE IF NOT EXISTS recovery_acceptance_marker (name text PRIMARY KEY CHECK(name='mend_ticket16_lifecycle'))`;
 await owner`INSERT INTO recovery_acceptance_marker(name) VALUES('mend_ticket16_lifecycle') ON CONFLICT DO NOTHING`;
 const policyBaseline=await owner`SELECT * FROM recovery_policies`;
 async function resetDatabase(){
  const identity=await owner`SELECT current_database() AS database,current_user AS role,(SELECT count(*) FROM recovery_acceptance_marker WHERE name='mend_ticket16_lifecycle') AS marker`;
  if(identity[0].database!==guard||identity[0].role!=='neondb_owner'||Number(identity[0].marker)!==1)throw Error('Refusing cleanup outside owned suite database');
  const tables=await owner`SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename NOT IN ('recovery_acceptance_marker','refund_signers','recovery_policies')`;
  await owner.query('TRUNCATE '+tables.map(r=>'public."'+r.tablename.replaceAll('"','""')+'"').join(','));
  await owner`INSERT INTO service_availability(id) VALUES('merchant')`;
  await owner`INSERT INTO refund_capacity(id) VALUES('merchant')`;
  await owner`UPDATE refund_signers SET next_nonce=0`;
  await owner`DELETE FROM recovery_policies`;
  for(const row of policyBaseline)await owner`INSERT INTO recovery_policies(id,created_at,policy) VALUES(${row.id},${row.created_at},${JSON.stringify(row.policy)}::jsonb)`;
 }
 await resetDatabase();
 const artifact=mkdtempSync(join(tmpdir(),'mend-ticket16-')),runId=randomUUID(),secret=randomBytes(32).toString('hex'),children=new Set<Owned>();
 try {
 writeFileSync(join(artifact,'manifest.json'),JSON.stringify({runId,database:guard,roles:roleNames,migrations:47,controlledExternalEffects:true}),{mode:0o600});
 symlinkSync(realpathSync('node_modules'),join(artifact,'node_modules'));
 const opts={bundle:true,packages:'external' as const,platform:'node' as const,target:'node24',format:'esm' as const,banner:{js:"import{createRequire as ___cr}from'node:module';const require=___cr(import.meta.url);"}};
 await build({...opts,entryPoints:['tests/recovery/effects.ts'],outfile:join(artifact,'effects.mjs')});
 await build({...opts,entryPoints:['tests/recovery/service.ts'],outfile:join(artifact,'service.mjs')});
 await build({...opts,packages:'bundle',absWorkingDir:artifact,stdin:{contents:readFileSync('backend/parser.ts','utf8'),resolveDir:artifact,sourcefile:'parser.ts',loader:'ts'},outfile:join(artifact,'parser.mjs')});
 async function launch(entry:string,env:Record<string,string>,fixedPort?:number):Promise<Owned>{
  const args=entry==='web'?[resolve('node_modules/next/dist/bin/next'),'dev','--webpack','--hostname','127.0.0.1','--port',String(fixedPort)]:[join(artifact,entry+'.mjs')];
  const child=spawn(process.execPath,args,{cwd:process.cwd(),env:{PATH:process.env.PATH,NODE_ENV:'development',...env},stdio:['ignore','pipe','pipe'],detached:true});
  const output=join(artifact,entry+'-'+child.pid+'.log');let observed='';
  for(const stream of [child.stdout,child.stderr])stream?.on('data',b=>{observed=(observed+b).slice(-10000);appendFileSync(output,b,{mode:0o600});});
  const owned:Owned={pid:child.pid!,url:fixedPort?'http://127.0.0.1:'+fixedPort:'',async kill(signal='SIGKILL'){
   if(child.exitCode!==null||child.signalCode!==null)return;const exited=new Promise<void>(r=>child.once('exit',()=>r()));
   try{process.kill(-child.pid!,signal);}catch{}await Promise.race([exited,new Promise<void>(r=>setTimeout(r,3000))]);
   if(child.exitCode===null&&child.signalCode===null){try{process.kill(-child.pid!,'SIGKILL');}catch{}await exited;}children.delete(owned);
  }};children.add(owned);
  try{await expect.poll(async()=>{
   if(child.exitCode!==null||child.signalCode!==null)throw Error('Owned process exited; private log '+output);
   if(entry==='web'){try{return(await fetch(owned.url+'/api/auth/session')).status===401;}catch{return false;}}
   const match=/READY:(\d+)/.exec(observed);if(match)owned.url='http://127.0.0.1:'+match[1];return !!match;
  },{timeout:90000}).toBe(true);return owned;}catch(e){await owned.kill();throw e;}
 }
 const effectPort=await port(),webPort=await port(),origin='http://127.0.0.1:'+webPort;
 let effects=await launch('effects',{RECOVERY_EFFECT_FILE:join(artifact,'effects.json'),RECOVERY_EFFECT_PORT:String(effectPort)},effectPort);
 const effectUrl=effects.url;
 const common={RECOVERY_EFFECT_URL:effectUrl,AWS_ENDPOINT_URL_S3:effectUrl,AWS_REGION:'us-east-1',AWS_ACCESS_KEY_ID:'owned-fixture',AWS_SECRET_ACCESS_KEY:'owned-fixture',UPLOAD_BUCKET:'ticket16-'+runId+'-uploads',OUTPUT_BUCKET:'ticket16-'+runId+'-outputs',ARC_RPC_URL:effectUrl+'/rpc',X402_FACILITATOR_URL:effectUrl,MERCHANT_ADDRESS:'0x'+'33'.repeat(20),OPERATOR_WALLET_ADDRESS:payer.address.toLowerCase(),CONVERSION_SERVICE_SECRET:secret,REGISTRAR_CONVERSION_SECRET:secret,AGENT_CONVERSION_SECRET:secret,OPERATOR_CONVERSION_SECRET:secret,REGISTRAR_SERVICE_SECRET:secret,REFUND_SERVICE_SECRET:secret,AGENT_SERVICE_SECRET:secret,RECEIPT_SERVICE_SECRET:secret,HEALTH_CONVERSION_SECRET:secret,HEALTH_REGISTRAR_SECRET:secret,OPERATOR_REGISTRAR_SECRET:secret,AGENT_REGISTRAR_SECRET:secret,RECONCILIATION_TRIGGER_ID:'ticket16-conversion',AGENT_TRIGGER_ID:'ticket16-agent',REFUND_TRIGGER_ID:'ticket16-refund',RECEIPT_TRIGGER_ID:'ticket16-receipt'};
 const services:Record<string,Owned>={},servicePorts:Record<string,number>={};
 async function backend(name:string,extra:Record<string,string>={}){
  const role=name==='agent'?'worker':name==='refund'?'refund-worker':name==='receipts'?'payment-reconciler':name;
  servicePorts[name]??=await port();
  const service=await launch('service',{RECOVERY_SERVICE_PORT:String(servicePorts[name]),...common,...envs['database-'+role],RECOVERY_SERVICE:name,CONVERSION_FUNCTION_URL:services.conversion?.url??'',AGENT_CONVERSION_URL:services.conversion?.url??'',AGENT_REGISTRAR_URL:services.registrar?.url??'',REGISTRAR_SERVICE_URL:services.registrar?.url??'',OPENROUTER_API_KEY:'controlled-not-a-provider-key',...extra});services[name]=service;return service;
 }
 await backend('conversion');await backend('registrar');await backend('refund');await backend('agent');await backend('receipts');
 const webEnv={...common,...envs['database-web'],APP_ORIGIN:origin,SESSION_SECRET:secret,CONVERSION_FUNCTION_URL:services.conversion.url,HEALTH_CONVERSION_URL:services.conversion.url,HEALTH_REGISTRAR_URL:services.registrar.url,OPERATOR_CONVERSION_URL:services.conversion.url,OPERATOR_REGISTRAR_URL:services.registrar.url,RECOVERY_AGENT_URL:services.agent.url,RECOVERY_AGENT_SECRET:secret};
 let web=await launch('web',webEnv,webPort);
 async function control(value:Record<string,unknown>){const response=await fetch(effectUrl+'/control',{method:'POST',body:JSON.stringify(value)});expect(response.status).toBe(200);}
 const state=async()=>await(await fetch(effectUrl+'/state')).json();
 async function event(name:string,count=1){await expect.poll(async()=>((await state()).events as string[]).filter(v=>v===name).length,{timeout:30000}).toBeGreaterThanOrEqual(count);}
 async function call(name:string,path:string,body:Record<string,unknown>){return fetch(services[name].url+path,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify(body)});}
 async function signIn(request:APIRequestContext,account=payer){const challenge=await request.post('/api/auth/challenge',{headers:{Origin:origin},data:{address:account.address,chainId:5042002}});expect(challenge.status()).toBe(200);const issued=await challenge.json();const response=await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature:await account.signMessage({message:issued.message})}});expect(response.status()).toBe(200);return issued;}
 async function draft(playwright:Playwright){
  const capability=randomBytes(32).toString('hex'),headers={Authorization:'Bearer '+capability};
  const request=await playwright.request.newContext({baseURL:origin});const pdf=await PDFDocument.create(),page=pdf.addPage(),font=await pdf.embedFont(StandardFonts.Helvetica);page.drawText('Mend isolated lifecycle document '+runId,{font,size:14});const bytes=Buffer.from(await pdf.save());
  const submission=await request.post('/api/submissions',{headers,data:{idempotencyKey:randomUUID(),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}});expect(submission.status()).toBe(201);const s=await submission.json();
  expect(new URL(s.upload.url).origin).toBe(effectUrl);expect((await request.put(s.upload.url,{headers:s.upload.headers,data:bytes})).status()).toBe(200);
  const completed=await request.post(`/api/submissions/${s.id}/complete`,{headers});expect(completed.status()).toBe(201);const order=await completed.json();
  await signIn(request);
  expect((await request.post(`/api/orders/${order.id}/claim`,{headers:{...headers,Origin:origin}})).status()).toBe(200);
  const nonce='0x'+randomBytes(32).toString('hex'),authorization={from:payer.address,to:common.MERCHANT_ADDRESS,value:'1000000',validAfter:'0',validBefore:String(Math.floor(Date.now()/1000)+300),nonce};
  const signature=await payer.signTypedData({domain:{name:'USDC',version:'2',chainId:5042002,verifyingContract:'0x3600000000000000000000000000000000000000'},types:{TransferWithAuthorization:[{name:'from',type:'address'},{name:'to',type:'address'},{name:'value',type:'uint256'},{name:'validAfter',type:'uint256'},{name:'validBefore',type:'uint256'},{name:'nonce',type:'bytes32'}]},primaryType:'TransferWithAuthorization',message:{...authorization,from:payer.address,to:common.MERCHANT_ADDRESS as `0x${string}`,value:BigInt(1000000),validAfter:BigInt(0),validBefore:BigInt(authorization.validBefore),nonce:nonce as `0x${string}`}});
  const requirements={scheme:'exact',network:'eip155:5042002',asset:'0x3600000000000000000000000000000000000000',amount:'1000000',payTo:common.MERCHANT_ADDRESS,maxTimeoutSeconds:300,extra:{name:'USDC',version:'2'}};
  const payment=Buffer.from(JSON.stringify({x402Version:2,accepted:requirements,payload:{authorization,signature}})).toString('base64');
  return {id:order.id,submission:s.id,terms:order.terms,request,headers,payment,async pay(){return request.post(`/api/orders/${order.id}/payment`,{headers:{...headers,'PAYMENT-SIGNATURE':payment},timeout:90000});}};
 }
 async function paidWithPausedExecution(playwright:Playwright){
  await web.kill();web=await launch('web',{...webEnv,CONVERSION_FUNCTION_URL:''},webPort);
  const purchase=await draft(playwright);expect((await purchase.pay()).status()).toBe(200);
  await services.conversion.kill();await backend('conversion',{INTERRUPTION_EXPERIMENT_ORDER:purchase.id});return purchase;
 }
 async function seed(options:{stopped?:boolean;confirmedParserFailure?:boolean;paidAgoSeconds?:number;calls?:number;prepared?:boolean;expired?:boolean}={}){
  const id=randomUUID(),submission=randomUUID(),attempt=randomUUID(),terms=purchasedTerms(defaultPolicy,'ticket16-synthetic'),key=`results/${id}/${attempt}.txt`,now=new Date(Date.now()-(options.expired?8*86400000:0)).toISOString();
  const sha=createHash('sha256').update('Synthetic retained result').digest('hex'),publication={state:'prepared',key,sha256:sha,size:25,preparedAt:now};
  const receipt={status:'success',blockNumber:'100',blockHash:'0x'+'55'.repeat(32),amountAtomic:'1000000',decimals:6,gasUsed:'21000',effectiveGasPrice:'1'};
  await owner`INSERT INTO submissions(id,capability_hash,idempotency_key,size,sha256,terms,expires_at) VALUES(${submission},${id},${id},1,${sha},${JSON.stringify(terms)}::jsonb,clock_timestamp()+interval '1 day')`;
  await owner`INSERT INTO orders(id,submission_id,capability_hash,owner_wallet,payer_wallet,status,paid_at,payment_transaction,payment_receipt,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages) VALUES(${id},${submission},${id},${payer.address.toLowerCase()},${payer.address.toLowerCase()},'processing_failed',clock_timestamp()-${options.paidAgoSeconds??86400}*interval '1 second',${'0x'+randomBytes(32).toString('hex')},${JSON.stringify(receipt)}::jsonb,${JSON.stringify(terms)}::jsonb,clock_timestamp(),clock_timestamp()+interval '7 days',${`accepted/${submission}.pdf`},1,${sha},1)`;
  await owner`INSERT INTO execution_attempts(id,order_id,generation,state,stopped_at,publisher_finished_at,publication_fenced_at,final_output_check,output_publication,stop_reason,parser_exit_code) VALUES(${attempt},${id},0,'stopped',clock_timestamp(),CASE WHEN ${!!options.stopped} THEN clock_timestamp() END,CASE WHEN ${!!options.stopped} THEN clock_timestamp() END,CASE WHEN ${!!options.prepared} THEN 'unknown' ELSE 'absent' END,${options.prepared?JSON.stringify(publication):null}::jsonb,${options.confirmedParserFailure?'parser_error':null},${options.confirmedParserFailure?1:null})`;
  if(options.calls!==undefined)await owner`INSERT INTO recovery_cases(order_id,calls_used) VALUES(${id},${options.calls})`;
  return {id,attempt,submission,key,publication};
 }
 return {role:(name:string)=>neon(envs[name].DATABASE_URL),get web(){return web;},origin,services,owner,artifact,secret,common,control,state,event,call,signIn,draft,paidWithPausedExecution,seed,
  async restartWeb(extra:Record<string,string>={}){await web.kill();web=await launch('web',{...webEnv,...extra},webPort);},
  async restartEffects(){await effects.kill();effects=await launch('effects',{RECOVERY_EFFECT_FILE:join(artifact,'effects.json'),RECOVERY_EFFECT_PORT:String(effectPort)},effectPort);},
  async restart(name:string,extra:Record<string,string>={}){await services[name].kill();return backend(name,extra);},
  async reset(){await resetDatabase();await control({reset:true});},
  async close(){await Promise.all([...children].map(p=>p.kill()));await resetDatabase();/* Keep private diagnostics locally; never attach raw fixture state or sessions. */},
 };
 }catch(error){await Promise.all([...children].map(p=>p.kill()));await resetDatabase();throw error;}
}
