import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {z} from 'zod';
import {database} from './db';
import {operatorAuthority,sameOrigin} from './auth';
import {ApiError,jsonBody} from './http';
import {validatePdf} from './pdf';
import {saveUpload,readUpload,verifiedResult} from './storage';
type Authority=Awaited<ReturnType<typeof operatorAuthority>>;
type Run={current:boolean;id:string;nonce:string;status:string;purpose:string;source_id:string|null;started_at:string;deadline:string;expires_at:string;finished_at:string|null;diagnostic:string|null;output_hash:string|null;output_size:number|null;validation_at:string|null;parser_at:string|null;storage_at:string|null;payment_at:string|null;capacity_at:string|null;retrieval_at:string|null};
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const id=z.string().uuid();
async function work(runId:string,authority:Authority,action='read',sha:string|null=null,size:number|null=null){
 if(!id.safeParse(runId).success)throw new ApiError(404,'health_not_found','Health check not found.');
 const result=await database().execute(sql`SELECT public.mend_health_web(${runId}::uuid,${authority.sessionHash},${authority.wallet},${action},${sha},${size}) AS work`);
 return result.rows[0].work as Run;
}
function projection(h:Run){
 const stale=Date.now()-new Date(h.started_at).getTime()>120000||(h.status==='passed'&&!h.current);
 const unknown=h.status==='running'&&new Date(h.deadline).getTime()<=Date.now();
 return {id:h.id,status:stale?'stale':unknown?'unknown':h.status,purpose:h.purpose,sourceId:h.source_id,startedAt:h.started_at,finishedAt:h.finished_at,expiresAt:h.expires_at,diagnostic:h.diagnostic,components:Object.fromEntries(['validation','parser','storage','payment','capacity','retrieval'].map(name=>{const at=h[`${name}_at` as keyof Run];return [name,{status:at?'passed':h.status==='failed'?'failed':unknown||h.status==='unknown'?'unknown':'pending',at}];}))};
}
// Byte offsets are calculated over ASCII, including the unique fixed-length nonce.
function document(nonce:string){
 const stream=`BT /F1 12 Tf 40 100 Td (Mend health ${nonce}) Tj ET`;
 const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 150] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
 let pdf='%PDF-1.4\n';const offsets=[0];for(const [index,object] of objects.entries()){offsets.push(pdf.length);pdf+=`${index+1} 0 obj\n${object}\nendobj\n`;}
 const xref=pdf.length;pdf+=`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(n=>`${String(n).padStart(10,'0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;return Buffer.from(pdf,'ascii');
}
async function remote(kind:'CONVERSION'|'REGISTRAR',runId:string,signal:AbortSignal){
 const url=process.env[`HEALTH_${kind}_URL`],secret=process.env[`HEALTH_${kind}_SECRET`];if(!url||!secret)throw Error('health_unconfigured');
 const response=await fetch(`${url.replace(/\/$/,'')}/health/${kind==='CONVERSION'?'execute':'check'}`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({runId}),signal,redirect:'error',cache:'no-store'});
 if(!response.ok)throw Error('health_peer_unavailable');
}
export async function startHealth(request:Request,sourceId?:string){
 sameOrigin(request);const authority=await operatorAuthority();
 if(sourceId===undefined&&!z.object({}).strict().safeParse(await jsonBody(request)).success)throw new ApiError(400,'invalid_request','Start a check without supplied evidence.');
 const runId=randomUUID(),nonce=randomBytes(16).toString('hex');
 try{await database().execute(sql`SELECT public.mend_health_begin(${runId}::uuid,${nonce},${authority.sessionHash},${authority.wallet},${sourceId??null}::uuid)`);}catch{throw new ApiError(409,'health_unavailable','The health check is stale or another check is running. Retry with a current session.');}
 // One bounded invocation. A timed out remote peer cannot later turn unknown work into a pass.
 const signal=AbortSignal.timeout(18000);
 try{
  const bytes=document(nonce);await validatePdf(bytes);
  await work(runId,authority,'validated',hash(bytes),bytes.length);
  await saveUpload(`health/${runId}/input.pdf`,bytes,signal);
  const stored=await readUpload(`health/${runId}/input.pdf`,signal);if(hash(stored.bytes)!==hash(bytes)||stored.bytes.length!==bytes.length)throw Error('health_input_invalid');
  await Promise.all([remote('CONVERSION',runId,signal),remote('REGISTRAR',runId,signal)]);
 }catch{await work(runId,authority,'unknown');}
 return projection(await work(runId,authority));
}
export async function healthStatus(runId:string){return projection(await work(runId,await operatorAuthority()));}
export async function healthResult(runId:string){
 const authority=await operatorAuthority(),h=await work(runId,authority);
 if(!h.output_hash||!h.output_size||!h.storage_at)throw new ApiError(409,'health_output_pending','Verified private health output is not available.');
 const bytes=await verifiedResult({key:`health/${runId}/result.txt`,sha256:h.output_hash,size:h.output_size,expiresAt:h.expires_at},AbortSignal.timeout(5000));
 if(!bytes.toString('utf8').includes(`Mend health ${h.nonce}`))throw new ApiError(409,'health_output_invalid','The health result could not be verified.');
 const current=await operatorAuthority();if(current.sessionHash!==authority.sessionHash)throw new ApiError(401,'session_expired','Sign in again.');
 try{await work(runId,current,'retrieved',hash(bytes),bytes.length);}catch{throw new ApiError(409,'health_stale','Health evidence changed or expired. Run another check.');}
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'private, no-store'}});
}

export async function resumeService(request:Request){
 sameOrigin(request);const authority=await operatorAuthority();
 const body=z.object({healthId:id,recheckId:id.optional()}).strict().safeParse(await jsonBody(request));
 if(!body.success)throw new ApiError(400,'invalid_request','Choose the current completed health check.');
 if(!body.data.recheckId)return startHealth(request,body.data.healthId);
 try{await database().execute(sql`SELECT public.mend_operator_resume(${body.data.healthId}::uuid,${body.data.recheckId}::uuid,${authority.sessionHash},${authority.wallet})`);}catch{throw new ApiError(409,'health_stale','The pause, session, failure or refund backlog changed. Run another health check.');}
 const {operatorAvailability}=await import('./availability');return operatorAvailability();
}
