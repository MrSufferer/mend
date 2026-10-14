import {test,expect} from '@playwright/test';
import {refundFixture,role} from './refund-fixture';
import {calldata,reserve,signerAddresses,verifyRefundOutcome,type ChainReader,type ChainReceipt} from '../backend/refund-chain';
for(const kind of ['registrar','refund'] as const)test(`independent canonical ${kind} revert releases nonce blocking and preserves immutable failed attempt`,async()=>{
 const first=await refundFixture(),second=await refundFixture(),registrar=role('database-registrar'),conversion=role('database-conversion'),signer=kind==='registrar'?registrar:role('database-refund-worker');
 const [initial]=await first.owner.query("SELECT next_nonce FROM refund_signers WHERE kind=$1",[kind]);
 try{
  const refunds=[];for(const f of [first,second]){await conversion.query("SELECT mend_refund_output_check($1,$2::jsonb,'absent')",[f.id,JSON.stringify([f.attempt])]);refunds.push((await registrar.query('SELECT mend_refund_fence($1,$2::jsonb) AS refund',[f.id,JSON.stringify(f.payment())]))[0].refund);}
  if(kind==='refund')for(const f of [first,second]){
   // Owned DB fixture registration; never genuine chain entitlement evidence.
   await f.owner.query("UPDATE refunds SET registered_at=clock_timestamp(),state='registered' WHERE order_id=$1",[f.id]);
   await f.owner.query("UPDATE orders SET disposition='refund_registered' WHERE id=$1",[f.id]);
  }
  const nonce=Math.max(0,initial.next_nonce),request={chainId:5042002,to:reserve,data:calldata(kind,refunds[0]),value:'0',gas:'100000',maxFeePerGas:'30000000000',maxPriorityFeePerGas:'1000000000'};
  const op=(await signer.query("SELECT mend_refund_operation($1,$2,$3,$4::jsonb) AS op",[first.id,kind,nonce,JSON.stringify(request)]))[0].op,hash=`0x${'bc'.repeat(32)}` as `0x${string}`,blockHash=`0x${'de'.repeat(32)}` as `0x${string}`;
  await signer.query('SELECT mend_refund_signed($1,$2,$3)',[op.id,'0x02dead',hash]);
  await signer.query("SELECT mend_refund_receipt($1,'unknown')",[op.id]);
  const receipt:ChainReceipt={transactionHash:hash,status:'reverted',blockNumber:BigInt(123),blockHash,from:signerAddresses[kind],to:reserve,logs:[]};
  const reader:ChainReader={async getChainId(){return 5042002;},async getTransactionReceipt(){return receipt;},async getBlock(){return {hash:blockHash,timestamp:BigInt(1)};}};
  await expect(verifyRefundOutcome({...reader,async getBlock(){return {hash:null,timestamp:BigInt(1)};}},kind,hash,refunds[0])).rejects.toThrow('receipt_not_canonical');
  await expect(verifyRefundOutcome({...reader,async getTransactionReceipt(){throw Error('fixture_missing_receipt');}},kind,hash,refunds[0])).rejects.toThrow('fixture_missing_receipt');
  expect((await signer.query("SELECT mend_refund_operation($1,$2) AS op",[second.id,kind]))[0].op.reason).toBe('signer_receipt_pending');
  const proof=await verifyRefundOutcome(reader,kind,hash,refunds[0]);expect(proof.status).toBe('reverted');
  await expect(role('database-refund-worker').query("SELECT mend_refund_receipt($1,'reverted',$2::jsonb)",[op.id,JSON.stringify(proof)])).rejects.toThrow();
  await expect(registrar.query("SELECT mend_refund_receipt($1,'reverted','{}'::jsonb)",[op.id])).rejects.toThrow('matching_canonical_revert_required');
  await registrar.query("SELECT mend_refund_receipt($1,'reverted',$2::jsonb)",[op.id,JSON.stringify(proof)]);
  expect((await signer.query("SELECT mend_refund_operation($1,$2) AS op",[second.id,kind]))[0].op.reason).toBe('not_reserved');
  await expect(signer.query("SELECT mend_refund_operation($1,$2,$3,$4::jsonb) AS op",[first.id,kind,nonce+1,JSON.stringify({...request,data:'0xdead'})])).rejects.toThrow('invalid_transaction_authority');
  const next=(await signer.query("SELECT mend_refund_operation($1,$2,$3,$4::jsonb) AS op",[first.id,kind,nonce+1,JSON.stringify(request)]))[0].op;expect(next).toMatchObject({nonce:nonce+1,calldata:request.data,state:'reserved'});expect(next.id).not.toBe(op.id);
  expect((await registrar.query("SELECT mend_refund_verify_operation($1,$2) AS op",[first.id,kind]))[0].op.id).toBe(next.id);
  await registrar.query("SELECT mend_refund_receipt($1,'unknown')",[op.id]);
  expect((await first.owner.query('SELECT receipt FROM refund_transactions WHERE id=$1',[op.id]))[0].receipt).toEqual(proof);
  expect((await signer.query("SELECT mend_refund_operation($1,$2) AS op",[second.id,kind]))[0].op.reason).toBe('signer_receipt_pending');
  const [state]=await first.owner.query('SELECT o.disposition,r.state,r.refunded_at,r.registered_at FROM orders o JOIN refunds r ON r.order_id=o.id WHERE o.id=$1',[first.id]);expect(state).toMatchObject({disposition:kind==='registrar'?'refund_fenced':'refund_registered',state:kind==='registrar'?'registration_pending':'registered',refunded_at:null});
  const [old]=await first.owner.query('SELECT nonce,state,hash,raw_transaction FROM refund_transactions WHERE id=$1',[op.id]);expect(old).toEqual({nonce,state:'reverted',hash,raw_transaction:'0x02dead'});
  await expect(signer.query('SELECT mend_refund_signed($1,$2,$3)',[op.id,'0x02beef',hash])).rejects.toThrow('signed_transaction_immutable');
 }finally{await first.cleanup();await second.cleanup();await first.owner.query("UPDATE refund_signers SET next_nonce=$1 WHERE kind=$2",[initial.next_nonce,kind]);}
});

test('canonical revert is terminal evidence only for the expected signer and reserve',async()=>{
 const hash=`0x${'ab'.repeat(32)}` as `0x${string}`,blockHash=`0x${'cd'.repeat(32)}` as `0x${string}`;
 const binding={chain_order_id:`0x${'ef'.repeat(32)}` as `0x${string}`,payer:signerAddresses.refund,amount_atomic:'1000000'};
 const receipt:ChainReceipt={transactionHash:hash,status:'reverted',blockNumber:BigInt(123),blockHash,from:signerAddresses.registrar,to:reserve,logs:[]};
 const reader:ChainReader={async getChainId(){return 5042002;},async getTransactionReceipt(){return receipt;},async getBlock(){return {hash:blockHash,timestamp:BigInt(1)};}};
 expect(await verifyRefundOutcome(reader,'registrar',hash,binding)).toMatchObject({status:'reverted',transaction:hash,blockHash,blockNumber:'123'});
 await expect(verifyRefundOutcome({...reader,async getBlock(){return {hash:null,timestamp:BigInt(1)};}},'registrar',hash,binding)).rejects.toThrow('receipt_not_canonical');
 await expect(verifyRefundOutcome({...reader,async getTransactionReceipt(){return {...receipt,from:signerAddresses.refund};}},'registrar',hash,binding)).rejects.toThrow('wrong_refund_sender_or_contract');
 await expect(verifyRefundOutcome({...reader,async getTransactionReceipt(){return {...receipt,status:'success'};}},'registrar',hash,binding)).rejects.toThrow('matching_refund_receipt_required');
});
