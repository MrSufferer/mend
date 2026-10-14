// Remove only owner-created controlled clones; never delete genuine payment acceptance history.
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {neon} from '@neondatabase/serverless';
const inventory=process.env.PROVISIONING_ENV_DIR,source=process.env.AGENT_FIXTURE_SOURCE_ORDER;
if(!inventory||!source)throw new Error('Explicit private inventory and controlled fixture source required');
const query=neon(parseEnv(readFileSync(`${inventory}/migration.env`,'utf8')).DATABASE_URL_UNPOOLED);
const rows=await query.query(`SELECT o.id,o.submission_id FROM orders o JOIN submissions s ON s.id=o.submission_id JOIN orders source ON source.id=$1::uuid WHERE o.id<>source.id AND s.idempotency_key IN(o.id::text,s.id::text) AND o.upload_key=source.upload_key AND o.payment_receipt=source.payment_receipt LIMIT 100`,[source]);
const ids=rows.map(r=>r.id),submissions=rows.map(r=>r.submission_id);
if(ids.length)await query.transaction([
 query.query('DELETE FROM agent_actions WHERE order_id=ANY($1::uuid[])',[ids]),
 query.query('DELETE FROM agent_calls WHERE order_id=ANY($1::uuid[])',[ids]),
 query.query('DELETE FROM agent_invocations WHERE order_id=ANY($1::uuid[])',[ids]),
 query.query('DELETE FROM recovery_cases WHERE order_id=ANY($1::uuid[])',[ids]),
 query.query('DELETE FROM orders WHERE id=ANY($1::uuid[])',[ids]),
 query.query('DELETE FROM submissions WHERE id=ANY($1::uuid[])',[submissions]),
]);
console.log(JSON.stringify({controlledClonesRemoved:ids.length,genuineSourcePreserved:true}));
