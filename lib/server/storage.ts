import {storageClient as client,maxObjectBytes} from './storage-transport';
import {createHash} from 'node:crypto';
import {  PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ApiError } from './http';
export const maxUploadBytes = maxObjectBytes;
function bucket() {if (!process.env.UPLOAD_BUCKET) throw new Error('UPLOAD_BUCKET is required'); return process.env.UPLOAD_BUCKET;}
export async function presignUpload(key:string,size:number,expiresIn:number) {
  const url = await getSignedUrl(client(), new PutObjectCommand({Bucket:bucket(),Key:key,ContentLength:size,ContentType:'application/pdf'}),{expiresIn});
  return {url, method:'PUT',headers:{'content-type':'application/pdf'}};
}
export async function readUpload(key:string,signal?:AbortSignal) {
  const head = await client().send(new HeadObjectCommand({Bucket:bucket(),Key:key}),{abortSignal:signal});
  if (!head.ContentLength || head.ContentLength > maxUploadBytes) throw new ApiError(422,'oversized_pdf','PDF must contain between 1 byte and 10 MB.');
  const data = await client().send(new GetObjectCommand({Bucket:bucket(),Key:key}),{abortSignal:signal});
  if (!data.Body) throw new ApiError(409,'upload_missing','Complete the private upload before finalizing.');
  const body=data.Body as AsyncIterable<Uint8Array> & {destroy?:()=>void};
  const chunks:Uint8Array[]=[]; let size=0;
  try {
    if (!data.ContentLength || data.ContentLength>maxUploadBytes) throw new ApiError(422,'oversized_pdf','PDF exceeds 10 MB.');
    for await (const chunk of body) {
      size+=chunk.length;
      if (size>maxUploadBytes) throw new ApiError(422,'oversized_pdf','PDF exceeds 10 MB.');
      chunks.push(chunk);
    }
  } catch(error) {body.destroy?.(); throw error;}
  return {bytes:Buffer.concat(chunks), uploadedAt:data.LastModified ?? head.LastModified ?? new Date()};
}
export async function saveUpload(key:string,bytes:Uint8Array,signal?:AbortSignal) {
  await client().send(new PutObjectCommand({Bucket:bucket(),Key:key,Body:bytes,ContentType:'application/pdf'}),{abortSignal:signal});
}
export async function deleteUpload(key:string) {await client().send(new DeleteObjectCommand({Bucket:bucket(),Key:key}));}

export async function presignRead(key:string,expiresIn:number) {return getSignedUrl(client(),new GetObjectCommand({Bucket:bucket(),Key:key,ResponseContentDisposition:'attachment; filename="upload.pdf"'}),{expiresIn});}
export async function readResult(key:string,signal?:AbortSignal) {
 const response=await client().send(new GetObjectCommand({Bucket:process.env.OUTPUT_BUCKET,Key:key}),{abortSignal:signal});if(!response.Body||!response.ContentLength||response.ContentLength>maxUploadBytes)throw new ApiError(409,'result_unavailable','The private result is unavailable for verification.');
 const chunks:Uint8Array[]=[];let size=0;for await(const chunk of response.Body as AsyncIterable<Uint8Array>){size+=chunk.length;if(size>maxUploadBytes)throw new ApiError(409,'result_unavailable','The private result could not be verified.');chunks.push(chunk);}return Buffer.concat(chunks);
}

export async function verifiedResult(expected:{key:string;size:number;sha256:string;expiresAt:string},signal?:AbortSignal) {
 const fresh=()=>{if(new Date(expected.expiresAt).getTime()<=Date.now())throw new ApiError(410,'result_expired','The result retention period has ended.');};
 fresh();const bytes=await readResult(expected.key,signal);
 if(bytes.length!==expected.size||createHash('sha256').update(bytes).digest('hex')!==expected.sha256)throw new ApiError(409,'result_unavailable','The private result could not be verified.');
 fresh();return bytes;
}
