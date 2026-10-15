import {test,expect} from '@playwright/test';
import {role,refundFixture} from './refund-fixture';
test('registrar capacity accounts for every authorized refund and never reopens purchases',async()=>{
 const f=await refundFixture(),g=await refundFixture();const registrar=role('database-registrar');
 try{
  for(const x of [f,g]){await role('database-conversion').query(`SELECT mend_refund_output_check($1::uuid,$2::jsonb,'absent')`,[x.id,JSON.stringify([x.attempt])]);await registrar.query(`SELECT mend_refund_fence($1::uuid,$2::jsonb)`,[x.id,JSON.stringify(x.payment())]);}
  const [backlog]=await registrar.query(`SELECT mend_refund_capacity_backlog() AS value`);
  expect(backlog.value.bindings.map((r:{order_id:string})=>r.order_id)).toEqual(expect.arrayContaining([f.id,g.id]));
  const evidence={chainId:5042002,contract:'0x76b29d6a6eab98b32415b8a6adf5d587d991e082',blockNumber:'100',blockHash:`0x${'ab'.repeat(32)}`,chainTimestamp:new Date().toISOString(),allowanceResetAt:new Date((Math.floor(Date.now()/86400000)+1)*86400000).toISOString(),balanceAtomic:'1000000',allowanceAtomic:'1000000',outstandingOrderIds:backlog.value.bindings.map((r:{order_id:string})=>r.order_id),repaidOrderIds:[]};
  const [saved]=await registrar.query(`SELECT mend_refund_capacity_commit($1::bigint,$2::jsonb) AS value`,[backlog.value.version,JSON.stringify(evidence)]);
  for(const name of ['database-web','database-worker','database-refund-worker']){await expect(role(name).query('SELECT mend_refund_capacity_commit($1::bigint,$2::jsonb)',[backlog.value.version,JSON.stringify(evidence)])).rejects.toThrow();await expect(role(name).query('SELECT mend_refund_capacity_backlog()')).rejects.toThrow();}
  for(const key of Object.keys(evidence)){await expect(registrar.query('SELECT mend_refund_capacity_commit($1::bigint,$2::jsonb)',[backlog.value.version,JSON.stringify({...evidence,[key]:null})])).rejects.toThrow();}
  expect(saved.value.status).toBe('deficit');expect(saved.value.debtAtomic).toBe('2000000');
  const [availability]=await f.owner.query(`SELECT paused FROM service_availability WHERE id='merchant'`);expect(availability.paused).toBe(true);
  const [stale]=await registrar.query(`SELECT mend_refund_capacity_commit($1::bigint,$2::jsonb) AS value`,[Number(backlog.value.version)-1,JSON.stringify(evidence)]);expect(stale.value.status).toBe('stale');
 }finally{await f.cleanup();await g.cleanup();}
});
