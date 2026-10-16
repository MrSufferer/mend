// Local deployment boundary: enrollment is an operator review, never secret generation.
import {readFile,realpath,stat,writeFile,chmod} from 'node:fs/promises';
import {isAbsolute,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';

export function required(name){
 const value=process.env[name];if(!value)throw Error(`${name} required`);return value;
}
export async function deploymentIdentity(prefix,role,destination,pathVariable=`${prefix}_SERVICE_ENV`){
 const slug=required(`${prefix}_FUNCTION_SLUG`);
 if(!/^[a-z0-9]{1,20}$/.test(slug))throw Error(`Invalid ${prefix}_FUNCTION_SLUG`);
 const path=required(pathVariable);
 if(!isAbsolute(path))throw Error(`${pathVariable} must be an absolute durable path`);
 const actual=await realpath(path),temporary=await realpath(tmpdir());
 if([temporary,'/tmp','/private/tmp','/var/tmp','/private/var/tmp'].some(root=>actual===root||actual.startsWith(root+'/')))throw Error(`${pathVariable} must be outside temporary directories`);
 const metadata=await stat(actual);
 if(!metadata.isFile()||(metadata.mode&0o077)!==0||metadata.uid!==process.getuid())throw Error(`${pathVariable} must be an owner-only regular file`);
 const identity=JSON.parse(await readFile(`${path}.identity.json`,'utf8'));
 if(identity.project!==destination.project||identity.branch!==destination.branch||identity.slug!==slug||identity.role!==role)throw Error(`${pathVariable} identity does not match reviewed destination and role`);
 const service=parseEnv(await readFile(actual,'utf8'));
 return {slug,path:actual,service};
}
export function requireService(service,...names){
 for(const name of names)if(!service[name]||service[name]==='disabled')throw Error(`Missing enrolled service setting: ${name}`);
}
export function serviceUrl(value,slug,{branch,region}){
 const url=new URL(value);
 const prefix=`${branch}-${slug}.compute.`,suffix=`.${region.replace(/^aws-/, '')}.aws.neon.tech`;
 if(url.protocol!=='https:'||url.username||url.password||url.port||url.pathname!=='/'||url.search||url.hash||!url.hostname.startsWith(prefix)||!url.hostname.endsWith(suffix)||!/^c-[0-9]+$/.test(url.hostname.slice(prefix.length,-suffix.length)))throw Error('Service URL does not match reviewed function slug');
 return value;
}
export async function saveService(path,service){
 // Preserve existing secrets; a deployment never creates or rotates them.
 await chmod(path,0o600);
 await writeFile(path,Object.entries(service).map(([key,value])=>{
  if(!/^[A-Z][A-Z0-9_]*$/.test(key)||/[\r\n\x00]/.test(value))throw Error('Invalid service environment entry');
  return `${key}=${JSON.stringify(value)}`;
 }).join('\n')+'\n',{mode:0o600});
}
export async function artifactSha256(path){return createHash('sha256').update(await readFile(resolve(path))).digest('hex');}
