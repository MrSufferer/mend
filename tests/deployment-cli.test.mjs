import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';

for(const [script,args,prefix] of [
 ['deploy-agent.mjs',[],'AGENT'],['deploy-conversion.mjs',[],'CONVERSION'],
 ['deploy-receipts.mjs',[],'RECEIPTS'],['deploy-refund.mjs',['registrar'],'REGISTRAR'],['deploy-refund.mjs',['refund'],'REFUND'],
]){
 test(`${prefix}: missing explicit slug fails before any credential read`,()=>{
  const result=spawnSync(process.execPath,[`scripts/${script}`,...args],{
   env:{PATH:process.env.PATH,HOME:'/nonexistent-deployment-cli-test',MEND_CREDENTIAL_DIRECTORY:'/nonexistent-deployment-cli-test'},encoding:'utf8',
  });
  assert.equal(result.status,1);
  assert.match(result.stderr,new RegExp(`${prefix}_FUNCTION_SLUG required`));
  assert.doesNotMatch(result.stderr,/credentials\.json|access_token/);
 });
}

import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {readFileSync} from 'node:fs';
const destination=JSON.parse(readFileSync('docs/provisioning-status.json')).neon;
async function enrolled(run){
 const directory=await mkdtemp(resolve('.mend-cli-'));
 const path=join(directory,'conversion.env');
 await writeFile(path,'CONVERSION_SERVICE_SECRET="test-only-never-a-real-credential"\nCONVERSION_FUNCTION_URL="https://unrelated-mendconversion6.compute.attacker.invalid/"\n',{mode:0o600});
 const identity={project:destination.project_id,branch:destination.branch_id,slug:'mendconversion6',role:'conversion-service'};
 await writeFile(path+'.identity.json',JSON.stringify(identity));
 try{await run({path,identity,invoke:()=>spawnSync(process.execPath,['scripts/deploy-conversion.mjs'],{env:{PATH:process.env.PATH,HOME:'/nonexistent-deployment-cli-test',MEND_CREDENTIAL_DIRECTORY:directory,CONVERSION_FUNCTION_SLUG:'mendconversion6',CONVERSION_SERVICE_ENV:path},encoding:'utf8'})});}
 finally{await rm(directory,{recursive:true,force:true});}
}
test('conversion refuses a peer URL outside the enrolled Neon destination before reading deployment credentials',async()=>{
 await enrolled(async({invoke})=>{
  const result=invoke();assert.equal(result.status,1);
  assert.match(result.stderr,/Service URL does not match reviewed function/);
  assert.doesNotMatch(result.stderr,/test-only-never-a-real-credential|database-conversion/);
 });
});

test('receipts deployment preserves enrolled values and saves a reusable service file after exact active completion',async()=>{
 const directory=await mkdtemp(resolve('.mend-cli-'));
 try{
  const servicePath=join(directory,'receipts.env'),databasePath=join(directory,'database.env'),preload=join(directory,'provider.mjs');
  await writeFile(servicePath,'RECEIPT_SERVICE_SECRET="test-receipt-secret"\nUNCHANGED_SETTING="preserved"\n',{mode:0o600});
  await writeFile(servicePath+'.identity.json',JSON.stringify({project:destination.project_id,branch:destination.branch_id,slug:'mendreceipts',role:'receipts-service'}));
  await writeFile(databasePath,'DATABASE_URL="postgresql://example.invalid/test"\nDATABASE_URL_UNPOOLED="postgresql://example.invalid/test"\n');
  await writeFile(join(directory,'rpc.env'),'ARC_RPC_URL="https://example.invalid/rpc"\n');
  await import('node:fs/promises').then(fs=>fs.mkdir(join(directory,'.config/neon'),{recursive:true}));
  await writeFile(join(directory,'.config/neon/credentials.json'),JSON.stringify({access_token:'test-management-token'}));
  await writeFile(preload,`let posted=false;globalThis.fetch=async(url,options={})=>{
   if(!String(url).startsWith('https://console.neon.tech/api/v2/projects/'))throw Error('Unexpected network');
   if(options.method==='POST'){posted=true;return new Response(JSON.stringify({id:6}));}
   const deployment={id:posted?6:5,status:'completed'};
   return new Response(JSON.stringify({function:{invocation_url:'https://br-patient-wave-azrhhl2v-mendreceipts.compute.c-3.ap-southeast-1.aws.neon.tech/',current_deployment:deployment,active_deployment:deployment}}));
  };`);
  const result=spawnSync(process.execPath,['--import',preload,'scripts/deploy-receipts.mjs'],{env:{PATH:process.env.PATH,HOME:directory,MEND_CREDENTIAL_DIRECTORY:directory,RECEIPTS_FUNCTION_SLUG:'mendreceipts',RECEIPTS_SERVICE_ENV:servicePath,RECEIPT_DATABASE_ENV:databasePath},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const saved=readFileSync(servicePath,'utf8');
  assert.match(saved,/^RECEIPT_SERVICE_SECRET="test-receipt-secret"\nUNCHANGED_SETTING="preserved"\nRECEIPT_FUNCTION_URL="https:\/\//);
  assert.match(result.stdout,/"deploymentId":6/);
  assert.match(result.stdout,/"zipSha256":"[a-f0-9]{64}"/);
  assert.doesNotMatch(result.stdout+result.stderr,/test-receipt-secret|test-management-token/);
 }finally{await rm(directory,{recursive:true,force:true});}
});

test('conversion refuses credentials enrolled for a different branch without rewriting the file',async()=>{
 await enrolled(async({path,identity,invoke})=>{
  const before=readFileSync(path,'utf8');
  await writeFile(path+'.identity.json',JSON.stringify({...identity,branch:'br-other-branch'}));
  const result=invoke();assert.equal(result.status,1);
  assert.match(result.stderr,/identity does not match reviewed destination and role/);
  assert.equal(readFileSync(path,'utf8'),before);
 });
});
test('a missing enrolled credential file fails without generating a replacement',async()=>{
 await enrolled(async({path,invoke})=>{
  await rm(path);
  const result=invoke();assert.equal(result.status,1);assert.match(result.stderr,/ENOENT/);
  assert.throws(()=>readFileSync(path),/ENOENT/);
 });
});

test('release CLI refuses source changes before reading service or provider credentials',()=>{
 const result=spawnSync(process.execPath,['scripts/deploy-release.mjs','conversion'],{env:{PATH:process.env.PATH,HOME:'/nonexistent-deployment-cli-test',MEND_REVIEWED_SHA:'0000000000000000000000000000000000000000'},encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/Exact clean reviewed source required/);
 assert.doesNotMatch(result.stderr,/credentials\.json|access_token/);
});
