// Local management process only: secrets are multipart fields, never CLI arguments.
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
const slug='mendreceipts';
if(!/^[a-z0-9]{1,20}$/.test(slug))throw new Error('Invalid slug');
const inventory=process.env.MEND_CREDENTIAL_DIRECTORY;if(!inventory)throw new Error('MEND_CREDENTIAL_DIRECTORY required');
const load=async name=>parseEnv(await readFile(`${inventory}/${name}.env`,'utf8'));
const publicConfig=JSON.parse(await readFile('docs/provisioning-status.json','utf8'));
const {project_id:project,branch_id:branch}=publicConfig.neon;
const credentials=JSON.parse(await readFile(`${homedir()}/.config/neon/credentials.json`,'utf8'));
const servicePath=process.env.RECEIPT_SERVICE_ENV||'/private/tmp/mend-receipt-service.env';
let service;try{service=parseEnv(await readFile(servicePath,'utf8'));}catch{service={RECEIPT_SERVICE_SECRET:randomBytes(32).toString('hex')};}
const db=parseEnv(await readFile(process.env.RECEIPT_DATABASE_ENV,'utf8')),rpc=await load('rpc');
// Explicit allowlist: this isolate never receives sessions, files, or signing credentials.
const environment={DATABASE_URL:db.DATABASE_URL,DATABASE_URL_UNPOOLED:db.DATABASE_URL_UNPOOLED,ARC_RPC_URL:rpc.ARC_RPC_URL,RECEIPT_SERVICE_SECRET:service.RECEIPT_SERVICE_SECRET,AWS_ACCESS_KEY_ID:'disabled',AWS_SECRET_ACCESS_KEY:'disabled',AWS_SESSION_TOKEN:'disabled'};
if(Object.hasOwn(process.env,'RECEIPT_TRIGGER_ID'))environment.RECEIPT_TRIGGER_ID=process.env.RECEIPT_TRIGGER_ID;
if(Object.entries(environment).some(([name,value])=>!value&&name!=='RECEIPT_TRIGGER_ID'))throw new Error('Incomplete receipt credentials');
await rm('.receipts-build',{recursive:true,force:true});await mkdir('.receipts-build');
const options={bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import{createRequire as ___cr}from'node:module';const require=___cr(import.meta.url);"}};
await build({...options,entryPoints:['backend/receipts.ts'],outfile:'.receipts-build/index.mjs'});
execFileSync('zip',['-j','function.zip','index.mjs'],{cwd:'.receipts-build',stdio:'pipe'});
const api=`https://console.neon.tech/api/v2/projects/${project}/branches/${branch}/functions/${slug}`;
const headers={Authorization:`Bearer ${credentials.access_token}`};
const form=new FormData();form.set('zip',new Blob([await readFile('.receipts-build/function.zip')],{type:'application/zip'}),'function.zip');form.set('runtime','nodejs24');form.set('environment',JSON.stringify(environment));
const deployed=await fetch(`${api}/deployments`,{method:'POST',headers,body:form});if(!deployed.ok)throw new Error(`Deployment HTTP ${deployed.status}`);
await writeFile(servicePath,Object.entries(service).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{mode:0o600});
for(let n=0;n<60;n++) {
 const response=await fetch(api,{headers});if(!response.ok)throw new Error(`Deployment status HTTP ${response.status}`);const body=await response.json();const fn=body.function??body;
 const state=fn.current_deployment?.status;
 if(state==='failed')throw new Error('Backend deployment failed; inspect sanitized Neon build logs');
 if(fn.invocation_url&&state==='completed'&&fn.active_deployment?.id===fn.current_deployment?.id) {
  service.RECEIPT_FUNCTION_URL=fn.invocation_url;await writeFile(servicePath,Object.entries(service).map(([key,value])=>`${key}=${value}`).join('\n')+'\n',{mode:0o600});
  console.log(JSON.stringify({slug,url:fn.invocation_url,status:state??'serving',deploymentId:fn.active_deployment.id,environmentNames:Object.keys(environment)}));break;
 }
 if(n===59)throw new Error('Deployment completion unconfirmed');await new Promise(resolve=>setTimeout(resolve,2000));
}
