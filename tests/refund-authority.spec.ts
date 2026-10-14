import {test,expect} from '@playwright/test';
import {refundFixture,role} from './refund-fixture';
import {calldata,type RefundBinding} from '../backend/refund-chain';
import {randomUUID} from 'node:crypto';
test.describe.configure({mode:'serial'});
test('refund admission rechecks session and request expiry after a held session lock',async()=>{
 const f=await refundFixture(),web=role('database-web'),registrar=role('database-registrar'),conversion=role('database-conversion'),session=randomUUID(),requestId=randomUUID(),actor=f.payment().payer;
 try{
  await f.owner.query("INSERT INTO auth_sessions(token_hash,wallet,chain_id,expires_at) VALUES($1,$2,5042002,clock_timestamp()+interval '1 hour')",[session,actor]);
  await web.query("SELECT mend_operator_begin($1,$2,$3,'refund',$4)",[requestId,f.id,session,actor]);
  await f.owner.query("UPDATE operator_requests SET deadline=clock_timestamp()+interval '1 second' WHERE id=$1",[requestId]);
  await conversion.query("SELECT mend_refund_output_check($1,$2::jsonb,'absent')",[f.id,JSON.stringify([f.attempt])]);
  const held=f.owner.transaction([f.owner.query('SELECT token_hash FROM auth_sessions WHERE token_hash=$1 FOR UPDATE',[session]),f.owner.query('SELECT pg_sleep(2)')]);
  await new Promise(resolve=>setTimeout(resolve,250));
  const [result]=await registrar.query('SELECT mend_refund_fence($1,$2::jsonb,$3) AS refund',[f.id,JSON.stringify(f.payment()),requestId]);
  await held;expect(result.refund.reason).toBe('operator_request_stale');
 }finally{await f.cleanup();await f.owner.query('DELETE FROM auth_sessions WHERE token_hash=$1',[session]);}
});
test('fence is monotonic against late result, concurrent requests and exhausted model budget',async()=>{
 const f=await refundFixture(),registrar=role('database-registrar'),conversion=role('database-conversion');
 try{
  await conversion.query('SELECT mend_refund_output_check($1,$2::jsonb,\'absent\')',[f.id,JSON.stringify([f.attempt])]);
  const results=await Promise.all([1,2].map(()=>registrar.query('SELECT mend_refund_fence($1,$2::jsonb) AS refund',[f.id,JSON.stringify(f.payment())])));
  expect(results.every(r=>r[0].refund.order_id===f.id)).toBe(true);
  const [state]=await f.owner.query('SELECT disposition,(SELECT count(*) FROM refunds WHERE order_id=$1)::int AS refunds,(SELECT calls_used FROM recovery_cases WHERE order_id=$1) AS calls FROM orders WHERE id=$1',[f.id]);
  expect(state).toEqual({disposition:'refund_fenced',refunds:1,calls:12});
  await expect(f.owner.query("UPDATE orders SET result='{}'::jsonb,delivered_at=clock_timestamp(),status='delivered' WHERE id=$1",[f.id])).rejects.toThrow('refund_disposition_fenced');
 }finally{await f.cleanup();}
});
test('missing policy, publisher uncertainty, and prepared output cannot authorize refunds',async()=>{
 const registrar=role('database-registrar'),conversion=role('database-conversion');
 for(const options of [{missingPolicy:true},{unknown:true},{prepared:true}]){
  const f=await refundFixture(options);try{
   await conversion.query('SELECT mend_refund_output_check($1,$2::jsonb,\'absent\')',[f.id,JSON.stringify([f.attempt])]);
   const [result]=await registrar.query('SELECT mend_refund_fence($1,$2::jsonb) AS refund',[f.id,JSON.stringify(f.payment())]);
   expect(result.refund.reason).toBe(options.missingPolicy?'policy_unknown':options.unknown?'execution_unknown':'output_unknown');
   const [state]=await f.owner.query('SELECT disposition FROM orders WHERE id=$1',[f.id]);expect(state.disposition).toBe('unresolved');
  }finally{await f.cleanup();}
 }
});
test('signer reservation survives restart, serializes all orders, and preserves exact immutable bytes',async()=>{
 const first=await refundFixture(),second=await refundFixture(),registrar=role('database-registrar'),conversion=role('database-conversion');
 const [initial]=await first.owner.query("SELECT next_nonce FROM refund_signers WHERE kind='registrar'");
 try{
  const refunds:RefundBinding[]=[];
  for(const f of [first,second]){await conversion.query('SELECT mend_refund_output_check($1,$2::jsonb,\'absent\')',[f.id,JSON.stringify([f.attempt])]);const [r]=await registrar.query('SELECT mend_refund_fence($1,$2::jsonb) AS refund',[f.id,JSON.stringify(f.payment())]);refunds.push(r.refund);}
  const request={chainId:5042002,to:'0x76b29d6a6eab98b32415b8a6adf5d587d991e082',data:calldata('registrar',refunds[0]),value:'0',gas:'100000',maxFeePerGas:'30000000000',maxPriorityFeePerGas:'1000000000'},nonce=Math.max(initial.next_nonce,0);
  const rows=await Promise.all([1,2].map(()=>registrar.query("SELECT mend_refund_operation($1,'registrar',$2,$3::jsonb) AS operation",[first.id,nonce,JSON.stringify(request)])));
  expect(rows[0][0].operation.id).toBe(rows[1][0].operation.id);
  const [blocked]=await registrar.query("SELECT mend_refund_operation($1,'registrar') AS operation",[second.id]);expect(blocked.operation.reason).toBe('signer_receipt_pending');
  const op=rows[0][0].operation,raw='0x02dead',hash=`0x${'aa'.repeat(32)}`;
  await registrar.query('SELECT mend_refund_signed($1,$2,$3)',[op.id,raw,hash]);
  const [restarted]=await registrar.query("SELECT mend_refund_operation($1,'registrar') AS operation",[first.id]);
  expect(restarted.operation).toMatchObject({nonce,raw_transaction:raw,hash,request,state:'signed'});
  await expect(registrar.query('SELECT mend_refund_signed($1,$2,$3)',[op.id,'0x02beef',hash])).rejects.toThrow('signed_transaction_immutable');
  await expect(registrar.query("SELECT mend_refund_receipt($1,'confirmed','{}'::jsonb)",[op.id])).rejects.toThrow('matching_successful_receipt_required');
 }finally{await first.cleanup();await second.cleanup();await first.owner.query("UPDATE refund_signers SET next_nonce=$1 WHERE kind='registrar'",[initial.next_nonce]);}
});
test('a deterministic sweep invocation retains its selected order across replay',async()=>{
 const f=await refundFixture(),invocation=randomUUID();
 try{
  const [first]=await f.owner.query('SELECT mend_refund_sweep($1,clock_timestamp()) AS selected',[invocation]);
  const [replay]=await f.owner.query('SELECT mend_refund_sweep($1,clock_timestamp()) AS selected',[invocation]);
  expect(replay.selected).toBe(first.selected);
  await expect(role('database-registrar').query('SELECT mend_refund_sweep($1,clock_timestamp())',[randomUUID()])).rejects.toMatchObject({code:'42501'});
 }finally{await f.owner.query('DELETE FROM refund_sweeps WHERE invocation_id=$1',[invocation]).catch(()=>{});await f.cleanup();}
});
