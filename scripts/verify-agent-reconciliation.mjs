// Controlled lifecycle proof only; owner credentials prepare fixtures, worker credentials exercise the production RPC.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {neon} from '@neondatabase/serverless';
const inventory=process.env.PROVISIONING_ENV_DIR,source=process.env.AGENT_FIXTURE_SOURCE_ORDER;
if(!inventory||!source)throw new Error('Explicit private inventory and controlled fixture source required');
const owner=neon(parseEnv(readFileSync(`${inventory}/migration.env`,'utf8')).DATABASE_URL_UNPOOLED);
const worker=neon(parseEnv(readFileSync(`${inventory}/database-worker.env`,'utf8')).DATABASE_URL_UNPOOLED);
const fixtures=Array.from({length:12},()=>({order:randomUUID(),submission:randomUUID()}));
const invocation=randomUUID();
try{
 for(const [index,f] of fixtures.entries())await owner.transaction([
  owner.query(`INSERT INTO submissions(id,capability_hash,idempotency_key,size,sha256,terms,expires_at) SELECT $1::uuid,capability_hash,$1::text,size,sha256,terms,expires_at FROM submissions WHERE id=(SELECT submission_id FROM orders WHERE id=$2::uuid)`,[f.submission,source]),
  owner.query(`INSERT INTO orders(id,submission_id,capability_hash,owner_wallet,status,paid_at,payment_receipt,payer_wallet,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages) SELECT $1::uuid,$2::uuid,capability_hash,owner_wallet,'processing_failed',CASE WHEN $4::integer<11 THEN timestamp with time zone '2020-01-01' ELSE paid_at END,payment_receipt,payer_wallet,terms,upload_created_at,upload_expires_at,upload_key,upload_size,upload_sha256,pages FROM orders WHERE id=$3::uuid`,[f.order,f.submission,source,index]),
  owner.query(`INSERT INTO recovery_cases(order_id,calls_used,escalation) VALUES($1::uuid,12,$2)`,[f.order,index<11?'budget_exhausted':null]),
 ]);
 const target=fixtures.at(-1).order;
 await owner.query(`INSERT INTO agent_invocations(id,order_id,deadline) VALUES($1::uuid,$2::uuid,clock_timestamp()-interval '1 second')`,[invocation,target]);
 const before=await worker.query(`SELECT calls_used,escalation FROM recovery_cases WHERE order_id=$1::uuid`,[target]);assert.equal(before[0].calls_used,12);
 await worker.query('SELECT public.mend_agent_reconcile()');
 const after=await worker.query(`SELECT c.calls_used,c.escalation,i.outcome,i.finished_at FROM recovery_cases c JOIN agent_invocations i ON i.order_id=c.order_id WHERE c.order_id=$1::uuid`,[target]);
 assert.equal(after[0].calls_used,12);assert.equal(after[0].escalation,'budget_exhausted');assert.equal(after[0].outcome,'invocation_timeout');assert.ok(after[0].finished_at);
 let expiredDenied=false;try{await worker.query('SELECT public.mend_agent_claim($1::uuid,$2::uuid)',[invocation,randomUUID()]);}catch{expiredDenied=true;}assert.ok(expiredDenied);
 console.log(JSON.stringify({controlled:true,olderAlreadyExhausted:11,expiredInvocationReconciled:true,budgetPreserved:12,postExpiryClaimDenied:true}));
}finally{
 const ids=fixtures.map(f=>f.order),sids=fixtures.map(f=>f.submission);
 await owner.transaction([
  owner.query('DELETE FROM agent_invocations WHERE order_id=ANY($1::uuid[])',[ids]),
  owner.query('DELETE FROM recovery_cases WHERE order_id=ANY($1::uuid[])',[ids]),
  owner.query('DELETE FROM orders WHERE id=ANY($1::uuid[])',[ids]),
  owner.query('DELETE FROM submissions WHERE id=ANY($1::uuid[])',[sids]),
 ]);
}
