import {test,expect} from '@playwright/test';
import {privateKeyToAccount} from 'viem/accounts';
import {refundFixture,role} from './refund-fixture';
const account=privateKeyToAccount(`0x${'11'.repeat(32)}`),origin='http://127.0.0.1:3041';
test('authenticated customer HTTP preserves receipt and registration stages during an aggregate capacity deficit',async({request})=>{
 const f=await refundFixture(),registrar=role('database-registrar');
 try{
  await f.owner.query('UPDATE orders SET owner_wallet=$2 WHERE id=$1',[f.id,account.address.toLowerCase()]);
  await role('database-conversion').query('SELECT mend_refund_output_check($1::uuid,$2::jsonb,\'absent\')',[f.id,JSON.stringify([f.attempt])]);
  await registrar.query('SELECT mend_refund_fence($1::uuid,$2::jsonb)',[f.id,JSON.stringify(f.payment())]);
  const issued=await(await request.post('/api/auth/challenge',{headers:{Origin:origin},data:{address:account.address,chainId:5042002}})).json();
  expect((await request.post('/api/auth/verify',{headers:{Origin:origin},data:{...issued,signature:await account.signMessage({message:issued.message})}})).status()).toBe(200);
  for(const state of ['registration_pending','submitted','receipt_unknown']){
   await f.owner.query('UPDATE refunds SET state=$2,registered_at=CASE WHEN $2=\'registration_pending\' THEN NULL ELSE clock_timestamp() END,blocker=\'allowance_exhausted\' WHERE order_id=$1',[f.id,state]);
   const response=await request.get(`/api/orders/${f.id}`);expect(response.status()).toBe(200);
   const view=await response.json();expect(view.refund.status).toBe(state);expect(view.nextStep).toContain('no additional payment');
   if(state==='registration_pending')expect(view.outcome).toContain('registration pending');else expect(view.nextStep).toContain('receipt');
   expect(view.refund.confirmedAt).toBeNull();expect(JSON.stringify(view)).not.toContain('outstandingOrderIds');
  }
 }finally{await f.cleanup();}
});
