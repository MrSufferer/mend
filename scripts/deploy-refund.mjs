// Local deployment process. Credential values never become command arguments or output.
import {build} from 'esbuild';
import {agentRegistrarBinding,saveAgentRegistrarBinding} from './agent-registrar-binding.mjs';
import {deploymentId,waitForDeployment} from './deployment-completion.mjs';
import {readFile,writeFile,mkdir,rm} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
const kind=process.argv[2];if(!['registrar','refund'].includes(kind))throw Error('Expected registrar or refund');
const slug=kind==='registrar'?'mendregistrar11':'mendrefund11';
const inventory=process.env.MEND_CREDENTIAL_DIRECTORY;if(!inventory)throw Error('Credential directory required');
const load=async name=>parseEnv(await readFile(`${inventory}/${name}.env`,'utf8'));
const cfg=JSON.parse(await readFile('docs/provisioning-status.json','utf8'));
const {project_id:project,branch_id:branch}=cfg.neon;
if(project!=='morning-bar-76751353'||branch!=='br-patient-wave-azrhhl2v')throw Error('Unreviewed destination');
const servicePath=`/private/tmp/mend-${kind==='registrar'?'registrar11':'refund11'}-service.env`;
const service=parseEnv(await readFile(servicePath,'utf8'));
const db=await load(kind==='registrar'?'database-registrar':'database-refund-worker'),rpc=await load('rpc');
const excluded=['AWS_ACCESS_KEY_ID','AWS_SECRET_ACCESS_KEY','AWS_SESSION_TOKEN','ADMINISTRATOR_PRIVATE_KEY','MERCHANT_PRIVATE_KEY','PURCHASER_PRIVATE_KEY','RECOVERY_WORKER_PRIVATE_KEY','RECOVERY_REGISTRAR_PRIVATE_KEY','OPENROUTER_API_KEY','SESSION_SECRET'];
const agentBinding=kind==='registrar'?await agentRegistrarBinding():null;
const environment={...Object.fromEntries(excluded.map(name=>[name,'disabled'])),DATABASE_URL:db.DATABASE_URL,DATABASE_URL_UNPOOLED:db.DATABASE_URL_UNPOOLED,ARC_RPC_URL:rpc.ARC_RPC_URL};
if(kind==='registrar'){
 const signer=await load('registrar'),conversion=parseEnv(await readFile('/private/tmp/mend-conversion6-service.env','utf8')),operator=await load('operator');
 Object.assign(environment,{AGENT_REGISTRAR_SECRET:agentBinding.AGENT_REGISTRAR_SECRET,REGISTRAR_PRIVATE_KEY:signer.REGISTRAR_PRIVATE_KEY,REFUND_PRIVATE_KEY:'disabled',REGISTRAR_SERVICE_SECRET:service.REGISTRAR_SERVICE_SECRET,CONVERSION_FUNCTION_URL:conversion.CONVERSION_FUNCTION_URL,REGISTRAR_CONVERSION_SECRET:service.REGISTRAR_CONVERSION_SECRET,OPERATOR_REGISTRAR_SECRET:service.OPERATOR_REGISTRAR_SECRET,OPERATOR_WALLET_ADDRESS:operator.OPERATOR_WALLET_ADDRESS});
}else{
 const signer=await load('worker'),registrar=parseEnv(await readFile('/private/tmp/mend-registrar11-service.env','utf8'));
 Object.assign(environment,{REFUND_PRIVATE_KEY:signer.RECOVERY_WORKER_PRIVATE_KEY,REGISTRAR_PRIVATE_KEY:'disabled',REFUND_SERVICE_SECRET:service.REFUND_SERVICE_SECRET,REGISTRAR_SERVICE_URL:registrar.REGISTRAR_SERVICE_URL,REGISTRAR_SERVICE_SECRET:registrar.REGISTRAR_SERVICE_SECRET,REFUND_TRIGGER_ID:service.REFUND_TRIGGER_ID||'disabled'});
}
if(Object.values(environment).some(value=>!value))throw Error('Incomplete isolated environment');
const directory=`.${kind}-build`;await rm(directory,{recursive:true,force:true});await mkdir(directory);
await build({bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import{createRequire as ___cr}from'node:module';const require=___cr(import.meta.url);"},entryPoints:[`backend/${kind==='registrar'?'registrar':'refund'}.ts`],outfile:`${directory}/index.mjs`});
execFileSync('zip',['-j','function.zip','index.mjs'],{cwd:directory,stdio:'pipe'});
console.log(JSON.stringify({kind,slug,project,branch,environmentNames:Object.keys(environment),artifact:directory+'/function.zip'}));
if(!process.argv.includes('--deploy'))process.exit(0);
const credentials=JSON.parse(await readFile(`${homedir()}/.config/neon/credentials.json`,'utf8')),headers={Authorization:`Bearer ${credentials.access_token}`};
const api=`https://console.neon.tech/api/v2/projects/${project}/branches/${branch}/functions/${slug}`;
const readStatus=async()=>{const response=await fetch(api,{headers});if(!response.ok)throw Error(`Status HTTP ${response.status}`);return response.json();};
const beforeBody=await readStatus(),before=(beforeBody.function??beforeBody).current_deployment?.id;
if(!Number.isSafeInteger(before)||before<0)throw Error('Previous deployment identifier missing');
const form=new FormData();form.set('zip',new Blob([await readFile(`${directory}/function.zip`)],{type:'application/zip'}),'function.zip');form.set('runtime','nodejs24');form.set('environment',JSON.stringify(environment));
const deployed=await fetch(`${api}/deployments`,{method:'POST',headers,body:form});if(!deployed.ok)throw Error(`Deployment HTTP ${deployed.status}`);
// Some API versions return no body. Pin the next ID from the pre-POST read in that case.
const responseText=await deployed.text();let responseBody;
if(responseText.trim()){try{responseBody=JSON.parse(responseText);}catch{throw Error('Invalid deployment response');}}
const target=deploymentId(responseBody,before);
const fn=await waitForDeployment(target,readStatus,()=>new Promise(resolve=>setTimeout(resolve,2000)));
if(agentBinding){agentBinding.AGENT_REGISTRAR_URL=fn.invocation_url;await saveAgentRegistrarBinding(agentBinding);}
service[kind==='registrar'?'REGISTRAR_SERVICE_URL':'REFUND_SERVICE_URL']=fn.invocation_url;
await writeFile(servicePath,Object.entries(service).map(([name,value])=>`${name}=${value}`).join('\n')+'\n',{mode:0o600});
console.log(JSON.stringify({slug,url:fn.invocation_url,deployment:target,status:'completed'}));
