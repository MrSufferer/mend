import {test,expect} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {role,refundFixture} from './refund-fixture';
test('model refund dispatch binds a live invocation; audit evidence rejects JSON null and scalar shapes',async()=>{
 const f=await refundFixture(),worker=role('database-worker'),registrar=role('database-registrar'),inv=randomUUID();
 try{
  await f.owner.query('UPDATE recovery_cases SET calls_used=0 WHERE order_id=$1',[f.id]);
  await worker.query('SELECT mend_agent_begin($1::uuid,$2::uuid)',[f.id,inv]);
  const [derived]=await registrar.query('SELECT mend_refund_agent_dispatch($1::uuid) AS id',[inv]);expect(derived.id).toBe(f.id);
  for(const evidence of ['null','[]','"untrusted"'])await expect(worker.query('SELECT mend_agent_record($1::uuid,$2::uuid,\'request_refund\',\'observed\',$3::jsonb)',[inv,randomUUID(),evidence])).rejects.toThrow();
  await worker.query('SELECT mend_agent_record($1::uuid,$2::uuid,\'request_refund\',\'observed\',\'{"status":"unresolved"}\'::jsonb)',[inv,randomUUID()]);
  await f.owner.query('UPDATE agent_invocations SET deadline=clock_timestamp()-interval \'1 second\' WHERE id=$1',[inv]);
  await expect(registrar.query('SELECT mend_refund_agent_dispatch($1::uuid)',[inv])).rejects.toThrow();
  expect((await f.owner.query('SELECT count(*)::int AS n FROM refunds WHERE order_id=$1',[f.id]))[0].n).toBe(0);
 }finally{await f.cleanup();}
});
