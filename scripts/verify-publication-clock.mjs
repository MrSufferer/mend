// Controlled SQL lifecycle fixtures copy owned metadata, never a new payment or S3 expiry claim.
import {readFileSync} from 'node:fs';import {parseEnv} from 'node:util';import {randomUUID} from 'node:crypto';import assert from 'node:assert/strict';import {neon} from '@neondatabase/serverless';
const dir=process.env.PROVISIONING_ENV_DIR,source=process.env.PUBLICATION_FIXTURE_SOURCE_ORDER;
if(!dir||!source)throw new Error('Explicit credential inventory and owned source required');
const owner=neon(parseEnv(readFileSync(`${dir}/migration.env`,'utf8')).DATABASE_URL_UNPOOLED),conversion=neon(parseEnv(readFileSync(`${dir}/database-conversion.env`,'utf8')).DATABASE_URL_UNPOOLED);
async function run(expiring){
 const oid=randomUUID(),sid=randomUUID(),attempt=randomUUID();let held;
 try{
 const [original]=await owner.query('SELECT result FROM orders WHERE id=$1::uuid',[source]);assert.ok(original.result);
 const [clock]=await owner.query("SELECT clock_timestamp()+interval '2 seconds' AS boundary");const boundary=new Date(clock.boundary).toISOString();
 const candidate={...original.result,...(expiring?{createdAt:new Date(new Date(boundary).getTime()-7*86400000).toISOString(),expiresAt:boundary}: {})};
 await owner.transaction([
 owner.query(`INSERT INTO submissions(id,capability_hash,idempotency_key,size,sha256,terms,expires_at) SELECT $1::uuid,capability_hash,$1::text,size,sha256,terms,expires_at FROM submissions WHERE id=(SELECT submission_id FROM orders WHERE id=$2::uuid)`,[sid,source]),
 owner.query(`INSERT INTO orders(id,submission_id,capability_hash,owner_wallet,status,paid_at,payment_receipt,payer_wallet,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages) SELECT $1::uuid,$2::uuid,capability_hash,owner_wallet,'processing', $4::timestamptz-(terms->>'deliverySeconds')::int*interval '1 second',payment_receipt,payer_wallet,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages FROM orders WHERE id=$3::uuid`,[oid,sid,source,boundary]),
 owner.query(`INSERT INTO execution_attempts(id,order_id,generation,state,stopped_at,parser_exit_code,output_publication) SELECT $1::uuid,$2::uuid,0,'stopped',stopped_at,parser_exit_code,$4::jsonb FROM execution_attempts WHERE order_id=$3::uuid AND output_publication IS NOT NULL ORDER BY generation LIMIT 1`,[attempt,oid,source,JSON.stringify(candidate)]),
 ]);
 held=owner.query(`WITH held AS MATERIALIZED (SELECT id FROM execution_attempts WHERE id=$1::uuid FOR UPDATE) SELECT id,pg_sleep(3) FROM held`,[attempt]).then(x=>x);
 let locked=false;for(let i=0;i<20&&!locked;i++){try{await owner.query('SELECT id FROM execution_attempts WHERE id=$1::uuid FOR UPDATE NOWAIT',[attempt]);}catch(e){if(e.code==='55P03')locked=true;else throw e;}if(!locked)await new Promise(r=>setTimeout(r,50));}assert.ok(locked);
 const [before]=await owner.query('SELECT clock_timestamp() AS at');assert.ok(new Date(before.at)<new Date(boundary),'Call must begin before the boundary');
 const publish=conversion.query("SELECT mend_finish_execution($1::uuid,'valid',$2::jsonb) AS published",[attempt,JSON.stringify(candidate)]).then(x=>x);
 await held;const published=await publish;
 const [after]=await owner.query('SELECT o.delivered_at,o.result,a.publisher_finished_at,a.publication_fenced_at,a.final_output_check FROM orders o JOIN execution_attempts a ON a.order_id=o.id WHERE o.id=$1::uuid',[oid]);
 if(expiring){assert.equal(published[0].published,false);assert.equal(after.delivered_at,null);assert.equal(after.result,null);assert.equal(after.final_output_check,'unknown');}
 else{assert.equal(published[0].published,true);assert.ok(new Date(after.delivered_at)>new Date(boundary),'Availability must be recorded after the blocking lock and deadline');assert.equal(new Date(after.delivered_at).getTime(),new Date(after.publisher_finished_at).getTime());assert.equal(new Date(after.delivered_at).getTime(),new Date(after.publication_fenced_at).getTime());}
 console.log(JSON.stringify({controlled:true,copiedReceiptNotLivePayment:true,expiryMetadataFixtureOnly:expiring,lockHeldSeconds:3,boundary,startedAt:before.at,deliveredAt:after.delivered_at,expiredPublicationDenied:expiring?true:undefined,actualLatePublication:expiring?undefined:true}));
 }finally{if(held)await held.catch(()=>{});await owner.transaction([owner.query('DELETE FROM execution_attempts WHERE order_id=$1::uuid',[oid]),owner.query('DELETE FROM orders WHERE id=$1::uuid',[oid]),owner.query('DELETE FROM submissions WHERE id=$1::uuid',[sid])]);}
}
await run(false);if(process.env.PUBLICATION_TEST_LATE_ONLY!=='1')await run(true);
