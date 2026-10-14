import {test,expect} from '@playwright/test';
import {refundFixture,role} from './refund-fixture';
test('registrar cannot authorize an unknown execution from a request or model narrative',async()=>{
 const f=await refundFixture({unknown:true});try{
  const [result]=await role('database-registrar').query("SELECT public.mend_refund_fence($1::uuid) AS result",[f.id]);
  expect(result.result.reason).toBe('execution_unknown');
 }finally{await f.cleanup();}
});
test('missing canonical payment proof cannot fence a stopped paid obligation',async()=>{
 const f=await refundFixture();try{
  await role('database-conversion').query("SELECT mend_refund_output_check($1,$2::jsonb,'absent')",[f.id,JSON.stringify([f.attempt])]);
  const [result]=await role('database-registrar').query("SELECT public.mend_refund_fence($1::uuid,'{}'::jsonb) AS result",[f.id]);
  expect(result.result.reason).toBe('canonical_payment_required');
  expect((await f.owner.query('SELECT disposition FROM orders WHERE id=$1',[f.id]))[0].disposition).toBe('unresolved');
 }finally{await f.cleanup();}
});
test('worker cannot fabricate final output absence or reserve authority',async()=>{
 const f=await refundFixture();try{
  await expect(role('database-worker').query("SELECT public.mend_refund_output_check($1::uuid,'[]'::jsonb,'absent')",[f.id])).rejects.toMatchObject({code:'42501'});
 }finally{await f.cleanup();}
});
