import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import {privateKeyToAccount} from 'viem/accounts';
import {neon} from '@neondatabase/serverless';
// Labeled copied-receipt fixtures exercise authority and failure handling, without payment.
export async function operatorFixture(failExecution=false,preparedOutput=false){
 const owner=neon(parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/migration.env`,'utf8')).DATABASE_URL_UNPOOLED);
 const id=randomUUID(),sid=randomUUID(),parent=randomUUID();
 const source='8e3851eb-47a0-4ef3-8017-474338706762';
 await owner.transaction([
  owner.query(`INSERT INTO submissions(id,capability_hash,idempotency_key,size,sha256,terms,expires_at) SELECT $1::uuid,capability_hash,$1::text,size,sha256,terms,expires_at FROM submissions WHERE id=(SELECT submission_id FROM orders WHERE id=$2)`,[sid,source]),
  owner.query(`INSERT INTO orders(id,submission_id,capability_hash,owner_wallet,status,paid_at,payment_receipt,payer_wallet,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages) SELECT $1::uuid,$2::uuid,capability_hash,$4,'processing_failed',clock_timestamp(),payment_receipt,payer_wallet,terms,upload_created_at,clock_timestamp()+interval '1 hour',upload_key,upload_size,upload_sha256,pages FROM orders WHERE id=$3`,[id,sid,source,privateKeyToAccount(`0x${'11'.repeat(32)}`).address.toLowerCase()]),
  owner.query(`INSERT INTO execution_attempts(id,order_id,generation,state,stopped_at,publisher_finished_at,publication_fenced_at,final_output_check,deadline,invocation_id,output_publication) SELECT $1::uuid,$2::uuid,0,'stopped',clock_timestamp(),clock_timestamp(),clock_timestamp(),CASE WHEN $4 THEN 'unknown' ELSE 'absent' END,paid_at+(terms->>'deliverySeconds')::int*interval '1 second',$3,CASE WHEN $4 THEN (SELECT output_publication FROM execution_attempts WHERE order_id='1e29d2bc-afd1-4f5f-a3af-d4dee236518b' AND generation=1) ELSE NULL END FROM orders WHERE id=$2::uuid`,[parent,id,randomUUID(),preparedOutput]),
  owner.query(`INSERT INTO recovery_cases(order_id,calls_used,escalation) VALUES($1::uuid,12,'fixture_budget_exhausted')`,[id]),
 ]);
 const suffix=id.replaceAll('-',''),trigger='ticket9_failure_'+suffix;
 if(failExecution){
  await owner.query(`CREATE FUNCTION public.${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'owned_fixture_execution_failure'; END; $$`);
  await owner.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON public.orders FOR EACH ROW WHEN (NEW.id='${id}'::uuid AND NEW.status IN ('processing','processing_failed')) EXECUTE FUNCTION public.${trigger}()`);
 }
 return {id,owner,async cleanup(){
  if(failExecution){await owner.query(`DROP TRIGGER IF EXISTS ${trigger} ON public.orders`);await owner.query(`DROP FUNCTION IF EXISTS public.${trigger}()`);}
  const keys=await owner.query("SELECT output_publication->>'key' AS key FROM execution_attempts WHERE order_id=$1 AND output_publication->>'key' LIKE $2",[id,`results/${id}/%`]);
  if(keys.length){const {S3Client,DeleteObjectCommand}=await import('@aws-sdk/client-s3');const env=parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/storage-default.env`,'utf8'));const config=JSON.parse(readFileSync('docs/provisioning-status.json','utf8')).public_configuration;const client=new S3Client({endpoint:env.AWS_ENDPOINT_URL_S3,region:env.AWS_REGION,forcePathStyle:true,credentials:{accessKeyId:env.AWS_ACCESS_KEY_ID,secretAccessKey:env.AWS_SECRET_ACCESS_KEY}});for(const {key}of keys)await client.send(new DeleteObjectCommand({Bucket:config.OUTPUT_BUCKET,Key:key}));}
  await owner.transaction(['operator_requests','agent_actions','agent_calls','agent_invocations','recovery_cases','execution_attempts','orders'].map(table=>owner.query(`DELETE FROM ${table} WHERE ${table==='orders'?'id':'order_id'}=$1`,[id])));await owner.query('DELETE FROM submissions WHERE id=$1',[sid]);
 }};
}
