import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';

async function host(name,aliases,run){
 const directory=await mkdtemp(join(tmpdir(),'mend-web-alias-'));
 let child;
 try{
  await symlink(resolve('node_modules'),join(directory,'node_modules'));
  const entry=join(directory,'service.mjs');
  await build({entryPoints:['tests/recovery/service.ts'],outfile:entry,bundle:true,packages:'external',platform:'node',target:'node24',format:'esm',banner:{js:"import{createRequire as ___cr}from'node:module';const require=___cr(import.meta.url);"}});
  child=spawn(process.execPath,[entry],{env:{PATH:process.env.PATH,RECOVERY_SERVICE:name,...aliases},stdio:['ignore','pipe','pipe']});
  const url=await new Promise((resolve,reject)=>{let output='';const timer=setTimeout(()=>reject(Error('worker startup timeout')),15000);child.once('exit',()=>{clearTimeout(timer);reject(Error('worker exited'));});child.stdout.on('data',chunk=>{output+=chunk;const match=/READY:(\d+)/.exec(output);if(match){clearTimeout(timer);resolve('http://127.0.0.1:'+match[1]);}});});
  await run(async(path,secret,body={},method='POST')=>fetch(url+path,{method,headers:secret?{Authorization:'Bearer '+secret}:{},body:method==='GET'?undefined:JSON.stringify(body)}));
 }finally{if(child&&child.exitCode===null){const exited=new Promise(r=>child.once('exit',r));child.kill('SIGKILL');await exited;}await rm(directory,{recursive:true,force:true});}
}
const web='a'.repeat(64),legacy='b'.repeat(64),operator='c'.repeat(64);
test('web conversion credential admits only paid conversion entry, preserving backend credentials',async()=>{
 await host('conversion',{WEB_CONVERSION_SECRET:web,CONVERSION_SERVICE_SECRET:legacy},async call=>{
  assert.equal((await call('/',web)).status,400);
  assert.equal((await call('/',web,{orderId:'11111111-1111-4111-8111-111111111111',payer:'invented'})).status,400);
  assert.equal((await call('/',undefined)).status,401);
  assert.equal((await call('/','wrong')).status,401);
  for(const path of ['/experiment','/stop','/reconcile','/status','/sweeps','/scheduled','/agent/inspect','/registrar/check','/operator','/health/execute','/health/cleanup','/probe','/retention']){
   const response=await call(path,web);assert.ok([401,403].includes(response.status),path+' must deny web credential');
  }
  assert.equal((await call('/',web,{},'GET')).status,401);
  assert.equal((await call('/',legacy)).status,400);
 });
});
test('web conversion operator credential reaches only strict durable request dispatch',async()=>{
 await host('conversion',{WEB_OPERATOR_CONVERSION_SECRET:operator,CONVERSION_SERVICE_SECRET:legacy},async call=>{
  assert.equal((await call('/operator',operator)).status,400);
  assert.equal((await call('/operator','wrong')).status,401);
  for(const path of ['/','/experiment','/stop','/reconcile','/status','/sweeps','/scheduled','/agent/inspect','/registrar/check','/health/execute','/health/cleanup','/probe','/retention'])assert.ok([401,403].includes((await call(path,operator)).status),path);
  assert.equal((await call('/operator',operator,{},'GET')).status,401);
 });
});
test('web registrar operator credential cannot invoke registrar financial or health routes',async()=>{
 await host('registrar',{WEB_OPERATOR_REGISTRAR_SECRET:operator,REGISTRAR_SERVICE_SECRET:legacy},async call=>{
  assert.equal((await call('/operator',operator)).status,503);
  assert.equal((await call('/operator','wrong')).status,401);
  for(const path of ['/register','/agent','/capacity','/probe','/health/check'])assert.equal((await call(path,operator)).status,401,path);
  assert.equal((await call('/operator',operator,{},'GET')).status,404);
 });
});
test('web agent credential requires a strict operator request before database or model use',async()=>{
 await host('agent',{WEB_OPERATOR_AGENT_SECRET:operator,AGENT_SERVICE_SECRET:legacy},async call=>{
  const response=await call('/investigate',operator,{orderId:'11111111-1111-4111-8111-111111111111'});
  assert.equal(response.status,400);assert.equal((await response.json()).error,'invalid_request');
  assert.equal((await call('/investigate','wrong')).status,401);
  for(const path of ['/case','/probe'])assert.equal((await call(path,operator)).status,401,path);
  assert.equal((await call('/scheduled',operator)).status,403);
  assert.equal((await call('/investigate',operator,{},'GET')).status,401);
 });
});
