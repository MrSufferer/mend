import {timingSafeEqual} from 'node:crypto';
export function authorized(request:Request,name:string){const actual=Buffer.from(request.headers.get('Authorization')?.replace(/^Bearer /,'')||''),expected=Buffer.from(process.env[name]||'');return expected.length>=32&&actual.length===expected.length&&timingSafeEqual(actual,expected);}
export const uuid=(value:unknown):value is string=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value);
export async function callRegistrar(orderId:string){
 if(!process.env.REGISTRAR_SERVICE_URL||!process.env.REGISTRAR_SERVICE_SECRET)throw new Error('registrar_unavailable');
 const response=await fetch(`${process.env.REGISTRAR_SERVICE_URL.replace(/\/$/,'')}/register`,{method:'POST',headers:{Authorization:`Bearer ${process.env.REGISTRAR_SERVICE_SECRET}`,'Content-Type':'application/json'},body:JSON.stringify({orderId}),signal:AbortSignal.timeout(55000),redirect:'error'});
 if(!response.ok)throw new Error('registrar_unavailable');return response.json() as Promise<{status:string;reason?:string}>;
}
