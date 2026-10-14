import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {neon} from '@neondatabase/serverless';
const load=(name:string)=>parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/${name}.env`,'utf8'));
test('registrar cannot authorize an unknown execution from a request or model narrative',async()=>{
 const q=neon(load('database-registrar').DATABASE_URL_UNPOOLED);
 const [result]=await q.query("SELECT public.mend_refund_fence($1::uuid) AS result",['f38c2ea3-5fbf-4bd5-9418-043e9fd2661a']);
 expect(result.result.reason).toBe('execution_unknown');
});
test('missing canonical payment proof cannot fence a stopped paid obligation',async()=>{
 const q=neon(load('database-registrar').DATABASE_URL_UNPOOLED);
 const [result]=await q.query("SELECT public.mend_refund_fence($1::uuid,'{}'::jsonb) AS result",['70416aef-c250-46de-aa30-cd5be751f9f2']);
 expect(['output_check_required','canonical_payment_required']).toContain(result.result.reason);
});
test('worker cannot fabricate final output absence or reserve authority',async()=>{
 const q=neon(load('database-worker').DATABASE_URL_UNPOOLED);
 await expect(q.query("SELECT public.mend_refund_output_check($1::uuid,'[]'::jsonb,'absent')",['70416aef-c250-46de-aa30-cd5be751f9f2'])).rejects.toMatchObject({code:'42501'});
});
