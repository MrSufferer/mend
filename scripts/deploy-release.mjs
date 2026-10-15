// Roll out reviewed code while preserving write-only runtime credentials by omission.
// This path can add only the narrow web credentials; use role deployment scripts
// for initial provisioning with a complete, explicitly enrolled credential set.
import {build} from 'esbuild';
import {readFile,mkdir,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {homedir,tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {deploymentIdentity,required,artifactSha256,requireService,serviceUrl} from './deployment-identity.mjs';
import {prepareDeployment} from './deployment-completion.mjs';
const [role,...flags]=process.argv.slice(2);
const allowed={conversion:['WEB_CONVERSION_SECRET','WEB_OPERATOR_CONVERSION_SECRET'],agent:['WEB_OPERATOR_AGENT_SECRET'],registrar:['WEB_OPERATOR_REGISTRAR_SECRET'],refund:[],receipts:[]};
if(!Object.hasOwn(allowed,role)||flags.some(flag=>flag!=='--deploy'))throw Error('Expected conversion|agent|registrar|refund|receipts [--deploy]');
const sha=required('MEND_REVIEWED_SHA');
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).trim();
function clean(){if(!/^[a-f0-9]{40}$/.test(sha)||git('rev-parse','HEAD')!==sha||git('status','--porcelain'))throw Error('Exact clean reviewed source required');}
clean();
const cfg=JSON.parse(await readFile('docs/provisioning-status.json','utf8'));
const destination={project:cfg.neon.project_id,branch:cfg.neon.branch_id,region:cfg.neon.region};
const identity=await deploymentIdentity(role.toUpperCase(),`${role}-service`,destination);
requireService(identity.service,...allowed[role]);
const environment=Object.fromEntries(allowed[role].map(name=>[name,identity.service[name]]));
if(new Set(Object.values(environment)).size!==Object.values(environment).length)throw Error('Independent web credentials required');
const journal=JSON.parse(await readFile('drizzle/meta/_journal.json','utf8')).entries;
const hashes=await Promise.all(journal.map(async entry=>({hash:createHash('sha256').update(await readFile(`drizzle/${entry.tag}.sql`)).digest('hex'),when:entry.when})));
if(flags.includes('--deploy')){
 const receipt=JSON.parse(await readFile(required('MEND_SCHEMA_RECEIPT'),'utf8'));
 if(receipt.sha!==sha||receipt.project!==destination.project||receipt.branch!==destination.branch||JSON.stringify(receipt.journal)!==JSON.stringify(hashes))throw Error('Exact applied schema receipt required');
}
const directory=resolve(`.${role}-build`);
await rm(directory,{recursive:true,force:true});await mkdir(directory);
const files=['index.mjs'];
const options={absWorkingDir:tmpdir(),bundle:true,platform:'node',target:'node24',format:'esm',banner:{js:"import{createRequire as ___cr}from'node:module';const require=___cr(import.meta.url);"}};
await build({...options,entryPoints:[resolve(`backend/${role}.ts`)],outfile:directory+'/index.mjs'});
if(role==='conversion'){await build({...options,entryPoints:[resolve('backend/parser.ts')],outfile:directory+'/parser.mjs'});files.push('parser.mjs');}
execFileSync('zip',['-j','function.zip',...files],{cwd:directory,stdio:'pipe'});
const zipSha256=await artifactSha256(directory+'/function.zip');
const sourceTarSha256=createHash('sha256').update(execFileSync('git',['archive','--format=tar',sha],{maxBuffer:100*1024*1024})).digest('hex');
const record={sha,sourceTarSha256,role,slug:identity.slug,project:destination.project,branch:destination.branch,zipSha256,environmentNames:Object.keys(environment),preserveExistingEnvironment:true};
if(!flags.includes('--deploy')){console.log(JSON.stringify({...record,mode:'build-only'}));process.exit(0);}
const previous=Number(required('MEND_PREVIOUS_DEPLOYMENT_ID'));
if(!Number.isSafeInteger(previous)||previous<0)throw Error('Expected previous deployment ID');
const credentials=JSON.parse(await readFile(`${homedir()}/.config/neon/credentials.json`,'utf8'));
const headers={Authorization:`Bearer ${credentials.access_token}`};
const api=`https://console.neon.tech/api/v2/projects/${destination.project}/branches/${destination.branch}/functions/${identity.slug}`;
const fetchBound=async(url,options)=>{
 const response=await fetch(url,options);
 if(!options?.method&&response.ok){const body=await response.clone().json(),fn=body.function??body;
  if(fn.current_deployment?.id!==previous||fn.active_deployment?.id!==previous||fn.active_deployment?.status!=='completed')throw Error('Deployment changed since reviewed readback');
 }
 return response;
};
// Guard the pre-POST read; subsequent polling must allow the newly created ID.
let initial=true;
const complete=await prepareDeployment(api,headers,async(url,options)=>{if(initial){initial=false;return fetchBound(url,options);}return fetch(url,options);});
clean();
const form=new FormData();form.set('zip',new Blob([await readFile(directory+'/function.zip')],{type:'application/zip'}),'function.zip');form.set('runtime','nodejs24');form.set('environment',JSON.stringify(environment));
const response=await fetch(api+'/deployments',{method:'POST',headers,body:form});
if(!response.ok)throw Error(`Deployment HTTP ${response.status}`);
const {id,fn}=await complete(response);
serviceUrl(fn.invocation_url,identity.slug,destination);
console.log(JSON.stringify({...record,deploymentId:id,status:'completed',url:fn.invocation_url,at:new Date().toISOString(),remoteByteDigestVerified:false}));
