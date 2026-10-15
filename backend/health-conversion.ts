import {storageClient as client,readPrivateObject as read} from '../lib/server/storage-transport';
import {createHash} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {PutObjectCommand,DeleteObjectCommand} from '@aws-sdk/client-s3';
import {database} from '../lib/server/db';
import {authorized,uuid} from './refund-service-auth';
import {runPdfWorker} from './pdf-worker';
import type {Worker} from 'node:worker_threads';
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export async function healthConversion(request:Request){
 if(!authorized(request,'HEALTH_CONVERSION_SECRET'))return Response.json({error:'unauthorized'},{status:401});
 let id:string|undefined,phase='claim';
 try{
  const body=await request.json();if(request.method!=='POST'||!body||Object.keys(body).join()!=='runId'||!uuid(body.runId))return Response.json({error:'invalid_request'},{status:400});id=body.runId;
  const claim=await database().execute(sql`SELECT public.mend_health_conversion(${id}::uuid,'claim') AS work`);
  const h=claim.rows[0].work as {nonce:string;input_hash:string;input_size:number;deadline:string};
  const deadline=Math.min(new Date(h.deadline).getTime(),Date.now()+12000),signal=AbortSignal.timeout(Math.max(1,deadline-Date.now()));
  phase='input_read';const stored=await read(process.env.UPLOAD_BUCKET!,`health/${id}/input.pdf`,signal);
  if(stored.bytes.length!==h.input_size||hash(stored.bytes)!==h.input_hash)throw Error('health_input_invalid');
  const control:{worker?:Worker;stopReason?:string}={};
  phase='parser';const parsed=await runPdfWorker(stored.bytes,deadline,control,reason=>{control.stopReason=reason;void control.worker?.terminate();});
  if(!parsed.text?.includes(`Mend health ${h.nonce}`))throw Error('health_parser_invalid');
  await database().execute(sql`SELECT public.mend_health_conversion(${id}::uuid,'parsed')`);
  phase='output_write';const bytes=Buffer.from(parsed.text),key=`health/${id}/result.txt`;
  await client().send(new PutObjectCommand({Bucket:process.env.OUTPUT_BUCKET,Key:key,Body:bytes,ContentType:'text/plain'}),{abortSignal:signal});
  phase='output_read';const output=await read(process.env.OUTPUT_BUCKET!,key,signal);
  if(!output.createdAt||output.bytes.length!==bytes.length||hash(output.bytes)!==hash(bytes))throw Error('health_output_invalid');
  await database().execute(sql`SELECT public.mend_health_conversion(${id}::uuid,'complete',${hash(bytes)},${bytes.length},${output.createdAt.toISOString()}::timestamptz)`);
  return Response.json({status:'processed'});
 }catch(error){
  console.error('Health document failed',phase,error instanceof Error?error.name:'UnknownError');
  if(id)try{await database().execute(sql`SELECT public.mend_health_conversion(${id}::uuid,${phase==='parser'?'parser_failed':'storage_failed'})`);}catch{/* A stale/expired run cannot accept later proof. */}
  return Response.json({error:'document_unavailable'},{status:503});
 }
}

export async function cleanupHealth(){
 const result=await database().execute(sql`SELECT public.mend_health_cleanup() AS ids`),ids=result.rows[0].ids as string[];
 await Promise.all(ids.map(async id=>{try{
  const signal=AbortSignal.timeout(2500);
  await Promise.all([client().send(new DeleteObjectCommand({Bucket:process.env.UPLOAD_BUCKET,Key:`health/${id}/input.pdf`}),{abortSignal:signal}),client().send(new DeleteObjectCommand({Bucket:process.env.OUTPUT_BUCKET,Key:`health/${id}/result.txt`}),{abortSignal:signal})]);
  await database().execute(sql`SELECT public.mend_health_cleanup(${id}::uuid)`);
 }catch{/* Both deletes must succeed; retry the same deterministic private keys next sweep. */}}));
 return Response.json({status:'cleaned'});
}
export async function healthCleanup(request:Request){
 if(!authorized(request,'HEALTH_CONVERSION_SECRET'))return Response.json({error:'unauthorized'},{status:401});
 try{const body=await request.json();if(request.method!=='POST'||!body||Array.isArray(body)||typeof body!=='object'||Object.keys(body).length)return Response.json({error:'invalid_request'},{status:400});return await cleanupHealth();}catch{return Response.json({error:'cleanup_unavailable'},{status:503});}
}
