import {timingSafeEqual} from 'node:crypto';
export function authorized(request:Request,name:string){const actual=Buffer.from(request.headers.get('Authorization')?.replace(/^Bearer /,'')||''),expected=Buffer.from(process.env[name]||'');return expected.length>=32&&actual.length===expected.length&&timingSafeEqual(actual,expected);}
export const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
async function registrarPost(path:string,body:Record<string,string>,failure:string){
 if(!process.env.REGISTRAR_SERVICE_URL||!process.env.REGISTRAR_SERVICE_SECRET)throw Error('registrar_unavailable');
 const response=await fetch(`${process.env.REGISTRAR_SERVICE_URL.replace(/\/$/,'')}${path}`,{method:'POST',headers:{Authorization:`Bearer ${process.env.REGISTRAR_SERVICE_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(55000),redirect:'error'});
 if(!response.ok)throw Error(failure);return response.json();
}
export async function callRegistrar(orderId:string){return registrarPost('/register',{orderId},'registrar_unavailable') as Promise<{status:string;reason?:string}>;}
export async function callCapacity(){return registrarPost('/capacity',{},'capacity_unknown');}
