import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
export const maxObjectBytes=10*1024*1024;
export function storageClient(){return new S3Client({endpoint:process.env.AWS_ENDPOINT_URL_S3,region:process.env.AWS_REGION,forcePathStyle:true,requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});}
/** Bounded private transport; callers retain their own proof and publication rules. */
export async function readPrivateObject(bucket:string,key:string,signal:AbortSignal){
 const response=await storageClient().send(new GetObjectCommand({Bucket:bucket,Key:key}),{abortSignal:signal});
 const body=response.Body as (AsyncIterable<Uint8Array>&{destroy?:()=>void})|undefined;
 const chunks:Uint8Array[]=[];let size=0;
 try{
  if(!body||!response.ContentLength||response.ContentLength>maxObjectBytes)throw Error('object_invalid');
  for await(const chunk of body){size+=chunk.length;if(size>maxObjectBytes)throw Error('object_limit');chunks.push(chunk);}
 }catch(error){body?.destroy?.();throw error;}
 return {bytes:Buffer.concat(chunks),createdAt:response.LastModified};
}

/** DELETE success is not absence evidence. HEAD must independently return 404. */
export async function deletePrivateObject(bucket:string,key:string){
 const {DeleteObjectCommand,HeadObjectCommand}=await import('@aws-sdk/client-s3');
 const client=storageClient(),signal=AbortSignal.timeout(4000);
 await client.send(new DeleteObjectCommand({Bucket:bucket,Key:key}),{abortSignal:signal});
 try{await client.send(new HeadObjectCommand({Bucket:bucket,Key:key}),{abortSignal:signal});return false;}
 catch(error){if((error as {$metadata?:{httpStatusCode?:number}}).$metadata?.httpStatusCode===404)return true;throw error;}
}
