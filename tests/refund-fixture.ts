import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID,randomBytes} from 'node:crypto';
import {neon} from '@neondatabase/serverless';
export const role=(name:string)=>neon(parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/${name}.env`,'utf8')).DATABASE_URL_UNPOOLED);
// Copied purchase metadata and artificial hashes are DB authority fixtures, never chain evidence.
export async function refundFixture(options:{unknown?:boolean;missingPolicy?:boolean;prepared?:boolean}={}){
 const owner=role('migration'),id=randomUUID(),sid=randomUUID(),attempt=randomUUID(),hash=`0x${randomBytes(32).toString('hex')}`;
 await owner.transaction([
  owner.query(`INSERT INTO submissions(id,capability_hash,idempotency_key,size,sha256,terms,expires_at) SELECT $1::uuid,capability_hash,$1::text,size,sha256,terms,expires_at FROM submissions WHERE id=(SELECT submission_id FROM orders WHERE id=$2)`,[sid,'70416aef-c250-46de-aa30-cd5be751f9f2']),
  owner.query(`INSERT INTO orders(id,submission_id,capability_hash,owner_wallet,status,paid_at,payment_transaction,payment_receipt,payer_wallet,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages) SELECT $1::uuid,$2::uuid,capability_hash,payer_wallet,'processing_failed',clock_timestamp()-interval '1 day',$3,payment_receipt,payer_wallet,CASE WHEN $4 THEN terms-'maxRetries' ELSE terms END,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages FROM orders WHERE id=$5`,[id,sid,hash,!!options.missingPolicy,'70416aef-c250-46de-aa30-cd5be751f9f2']),
  owner.query(`INSERT INTO execution_attempts(id,order_id,generation,state,stopped_at,publisher_finished_at,publication_fenced_at,final_output_check,output_publication) VALUES($1,$2,0,'stopped',clock_timestamp(),CASE WHEN $3 THEN NULL ELSE clock_timestamp() END,clock_timestamp(),CASE WHEN $4 THEN 'unknown' ELSE 'absent' END,CASE WHEN $4 THEN '{"state":"prepared","key":"owned-db-fixture","sha256":"unknown","size":1,"preparedAt":"2026-10-14T00:00:00Z"}'::jsonb ELSE NULL END)`,[attempt,id,!!options.unknown,!!options.prepared]),
  owner.query(`INSERT INTO recovery_cases(order_id,calls_used) VALUES($1,12)`,[id]),
 ]);
 const [o]=await owner.query('SELECT payer_wallet FROM orders WHERE id=$1',[id]);
 return {id,attempt,owner,payment:()=>({transaction:hash,payer:o.payer_wallet,amountAtomic:'1000000',chainId:'5042002',checkedAt:new Date().toISOString()}),async cleanup(){await owner.transaction(['refund_transactions','refund_checks','refunds','operator_requests','agent_actions','agent_calls','agent_invocations','recovery_cases','execution_attempts','orders'].map(table=>owner.query(`DELETE FROM ${table} WHERE ${table==='orders'?'id':'order_id'}=$1`,[id])));await owner.query('DELETE FROM submissions WHERE id=$1',[sid]);}};
}
