import {expect,type APIRequestContext} from '@playwright/test';
import {neon} from '@neondatabase/serverless';
import {readFileSync,mkdtempSync,writeFileSync,rmSync,appendFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createServer,type Server} from 'node:http';
import {spawn,type ChildProcess} from 'node:child_process';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {privateKeyToAccount} from 'viem/accounts';
import {encodeAbiParameters,toFunctionSelector} from 'viem';
import {build} from 'esbuild';
export const origin='http://127.0.0.1:3042';
export const operator=privateKeyToAccount(`0x${'11'.repeat(32)}`);
export const healthSecrets={conversion:'controlled-health-conversion-'.repeat(3),registrar:'controlled-health-registrar-'.repeat(3)};
export const conversionSecret='controlled-legacy-conversion-'.repeat(3);
export const role=(name:string)=>neon(parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/${name}.env`,'utf8')).DATABASE_URL_UNPOOLED);
export const owner=()=>role('migration');
const env=(name:string)=>parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/${name}.env`,'utf8'));
export async function signIn(request:APIRequestContext,key='11'){
 const a=privateKeyToAccount(`0x${key.repeat(32)}`),challenge=await request.post('/api/auth/challenge',{headers:{Origin:origin},data:{address:a.address,chainId:5042002}});expect(challenge.status()).toBe(200);
 const issued=await challenge.json();expect((await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature:await a.signMessage({message:issued.message})}})).status()).toBe(200);
}
export async function healthFixture(){
 expect((await owner()`SELECT current_database() AS name`)[0].name).toBe('mend_ticket14_health');
 // Refuse an existing listener: each test invocation must use its own controlled providers.
 await new Promise<void>((resolve,reject)=>{const probe=createServer();probe.once('error',reject);probe.listen(3042,'127.0.0.1',()=>probe.close(error=>error?reject(error):resolve()));});
 const objects=new Map<string,{bytes:Buffer;at:Date}>(),children:ChildProcess[]=[],servers:Server[]=[];
 const settings={support:true,chain:5042002,blockAge:0,balance:BigInt(8000000),allowance:BigInt(10000000),corruptOutput:false,missingOutput:false,oversizedOutput:false,parserHoldMs:0,rpcDelay:0};
 const effects={verify:0,settle:0,inputWrites:0,outputWrites:0,reads:0};
 async function listen(server:Server){servers.push(server);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}
 const storage=await listen(createServer(async(req,res)=>{
  const key=new URL(req.url!,'http://fixture').pathname;res.setHeader('Content-Type','application/xml');
  if(req.method==='PUT'){const chunks:Buffer[]=[];for await(const c of req)chunks.push(c);const bytes=Buffer.concat(chunks);objects.set(key,{bytes,at:new Date()});if(key.endsWith('.pdf'))effects.inputWrites++;else effects.outputWrites++;res.end();return;}
  if(req.method==='DELETE'){objects.delete(key);res.statusCode=204;res.end();return;}
  const value=objects.get(key);if(!value||(settings.missingOutput&&key.endsWith('.txt'))){res.statusCode=404;res.end('<Error><Code>NoSuchKey</Code></Error>');return;}
  const bytes=settings.oversizedOutput&&key.endsWith('.txt')?Buffer.alloc(10485761):settings.corruptOutput&&key.endsWith('.txt')?Buffer.from('Wrong private output'):value.bytes;
  effects.reads++;res.setHeader('Content-Length',bytes.length);res.setHeader('Last-Modified',value.at.toUTCString());res.setHeader('ETag','"controlled"');res.end(req.method==='HEAD'?undefined:bytes);
 }));
 const facilitator=await listen(createServer(async(req,res)=>{
  res.setHeader('Content-Type','application/json');if(req.url==='/verify')effects.verify++;if(req.url==='/settle')effects.settle++;
  if(req.url!=='/supported'){res.statusCode=400;res.end('{}');return;}
  res.end(JSON.stringify({kinds:settings.support?[{x402Version:2,scheme:'exact',network:'eip155:5042002'}]:[],extensions:[],signers:{'eip155:*':['0x'+ '22'.repeat(20)]}}));
 }));
 const rpc=await listen(createServer(async(req,res)=>{
  let raw='';for await(const c of req)raw+=c;
  if(settings.rpcDelay)await new Promise(r=>setTimeout(r,settings.rpcDelay));
  const body=JSON.parse(raw);let result:unknown;
  if(body.method==='eth_chainId')result='0x'+settings.chain.toString(16);
  else if(body.method==='eth_getBlockByNumber')result={number:'0x64',hash:'0x'+ '55'.repeat(32),timestamp:'0x'+(Math.floor(Date.now()/1000)-settings.blockAge).toString(16),transactions:[]};
  else if(body.method==='eth_call'){
   const selector=body.params[0].data.slice(0,10);
   if(selector===toFunctionSelector('entitlements(bytes32)')){result=encodeAbiParameters([{type:'address'},{type:'uint256'},{type:'bool'}],['0x0000000000000000000000000000000000000000',BigInt(0),false]);}else{const amount=selector===toFunctionSelector('balanceOf(address)')?settings.balance:selector===toFunctionSelector('remainingDailyAllowance()')?settings.allowance:selector===toFunctionSelector('decimals()')?BigInt(6):BigInt(0);
   result=encodeAbiParameters([{type:'uint256'}],[amount]);}
  } else {res.statusCode=400;res.end('{}');return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({jsonrpc:'2.0',id:body.id,result}));
 }));
 const artifact=mkdtempSync(join(tmpdir(),'mend-health14-'));
 const options={bundle:true,platform:'node' as const,target:'node24',format:'esm' as const,banner:{js:"import{createRequire as ___cr}from'node:module';const require=___cr(import.meta.url);"}};
 await build({...options,entryPoints:['backend/parser.ts'],outfile:join(artifact,'parser.mjs')});
 for(const name of ['conversion','registrar'])await build({...options,entryPoints:[`backend/${name}.ts`],outfile:join(artifact,`${name}.mjs`)});
 writeFileSync(join(artifact,'runner.mjs'),`import {createServer} from 'node:http';const {default:service}=await import(process.env.HEALTH_TEST_ENTRY);const server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const response=await service.fetch(new Request('http://fixture'+req.url,{method:req.method,headers:req.headers,body:['GET','HEAD'].includes(req.method)?undefined:Buffer.concat(chunks)}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('{}');}});server.listen(0,'127.0.0.1',()=>console.log('READY:'+server.address().port));`);
 const common={PATH:process.env.PATH,HOME:process.env.HOME,NODE_ENV:'development' as const,OPERATOR_WALLET_ADDRESS:operator.address.toLowerCase(),AWS_ENDPOINT_URL_S3:storage,AWS_REGION:'auto',AWS_ACCESS_KEY_ID:'controlled',AWS_SECRET_ACCESS_KEY:'controlled',UPLOAD_BUCKET:'health-uploads',OUTPUT_BUCKET:'health-outputs',ARC_RPC_URL:rpc,MERCHANT_ADDRESS:'0x'+ '33'.repeat(20),X402_FACILITATOR_URL:facilitator};
 async function backend(name:string){const child=spawn(process.execPath,[join(artifact,'runner.mjs')],{env:{...common,...env(`database-${name}`),HEALTH_TEST_ENTRY:join(artifact,`${name}.mjs`),CONVERSION_SERVICE_SECRET:conversionSecret,HEALTH_CONVERSION_SECRET:healthSecrets.conversion,HEALTH_REGISTRAR_SECRET:healthSecrets.registrar},stdio:['ignore','pipe','pipe']});children.push(child);child.stderr?.on('data',b=>appendFileSync('/private/tmp/mend-recovery-context/test14-backend.log',b));return new Promise<string>((resolve,reject)=>{child.stdout?.on('data',b=>{const m=/READY:(\d+)/.exec(String(b));if(m)resolve('http://127.0.0.1:'+m[1]);});child.on('exit',()=>reject(Error('Owned health backend exited')));});}
 const conversion=await backend('conversion'),registrar=await backend('registrar');
 const web=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port','3042'],{env:{...common,...env('database-web'),APP_ORIGIN:origin,SESSION_SECRET:'controlled-session-secret-health-'.repeat(3),HEALTH_CONVERSION_URL:conversion,HEALTH_CONVERSION_SECRET:healthSecrets.conversion,HEALTH_REGISTRAR_URL:registrar,HEALTH_REGISTRAR_SECRET:healthSecrets.registrar},stdio:['ignore','pipe','pipe']});children.push(web);
 let logs='';web.stdout?.on('data',b=>{logs+=b.toString().slice(-2000);appendFileSync('/private/tmp/mend-recovery-context/test14-web.log',b);});web.stderr?.on('data',b=>{logs+=b.toString().slice(-2000);appendFileSync('/private/tmp/mend-recovery-context/test14-web.log',b);});
 await expect.poll(async()=>{try{return (await fetch(origin+'/api/auth/session')).status;}catch{return 0;}},{timeout:90000}).toBe(401);
 return {settings,effects,objects,conversion,registrar,logs:()=>logs,async cleanup(){for(const p of children)p.kill('SIGTERM');await Promise.all(children.map(p=>new Promise<void>(r=>{if(p.exitCode!==null)r();else p.once('exit',()=>r());})));for(const s of servers){s.closeAllConnections();await new Promise<void>(r=>s.close(()=>r()));}rmSync(artifact,{recursive:true,force:true});}};
}
/** A real separately connected SQL transaction, used only on this explicitly guarded DB. */
export async function serviceLock(){
 const u=new URL(env('migration').DATABASE_URL_UNPOOLED);expect(u.pathname).toBe('/mend_ticket14_health');
 const child=spawn('/opt/homebrew/opt/postgresql@16/bin/psql',['-X','-q','-t','-A','-v','ON_ERROR_STOP=1'],{env:{NODE_ENV:'test',PATH:process.env.PATH,PGHOST:u.hostname,PGPORT:'5432',PGDATABASE:'mend_ticket14_health',PGUSER:decodeURIComponent(u.username),PGPASSWORD:decodeURIComponent(u.password),PGSSLMODE:'require',PGAPPNAME:'mend14-owned-lock'},stdio:['pipe','pipe','pipe']});
 await new Promise<void>((resolve,reject)=>{child.stdout?.on('data',b=>{if(String(b).includes('locked'))resolve();});child.once('error',reject);child.stdin!.write("BEGIN; SELECT 1 FROM service_availability WHERE id='merchant' FOR UPDATE; SELECT 'locked';\n");});
 return async(statement='')=>new Promise<void>((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(Error('Owned lock transaction failed')));child.stdin!.end(statement+'; COMMIT;\n');});
}
export async function waiting(fragment:string){await expect.poll(async()=>Number((await owner().query(`SELECT count(*) AS n FROM pg_stat_activity WHERE wait_event_type='Lock' AND query LIKE $1`,['%'+fragment+'%']))[0].n)).toBeGreaterThan(0);}
