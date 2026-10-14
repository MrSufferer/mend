import {test,expect} from '@playwright/test';
import {driveTransaction,validateTransactionBinding,type Operation} from '../backend/refund-transactions';
import type {Hex} from 'viem';
const data='0xdead' as Hex,raw='0x02dead' as Hex,hash=`0x${'ab'.repeat(32)}` as Hex;
const operation=():Operation=>({id:'fixture',order_id:'fixture',kind:'refund',nonce:7,request:{chainId:5042002,to:'0x76b29d6a6eab98b32415b8a6adf5d587d991e082',data,value:'0',gas:'100000',maxFeePerGas:'30000000000',maxPriorityFeePerGas:'1000000000'},raw_transaction:null,hash:null,state:'reserved'});
test('a crash after durable signing reuses exact bytes and nonce on restart',async()=>{
 let durable=operation(),signs=0,broadcasts=0,interrupt=true;
 const io={async sign(){signs++;return raw;},async persist(op:Operation,bytes:Hex){durable={...op,raw_transaction:bytes,hash,state:'signed'};if(interrupt)throw Error('fixture_process_interrupted');return durable;},async validate(op:Operation){expect(op).toEqual(durable);},async observe(){return 'missing' as const;},async broadcast(bytes:Hex){expect(bytes).toBe(durable.raw_transaction);broadcasts++;return hash;},async state(){}};
 await expect(driveTransaction(durable,data,io)).rejects.toThrow('fixture_process_interrupted');expect(broadcasts).toBe(0);
 interrupt=false;await driveTransaction(durable,data,io);expect(signs).toBe(1);expect(broadcasts).toBe(1);expect(durable.nonce).toBe(7);
});
test('inclusion before DB update failure is independently reconciled without rebroadcast',async()=>{
 let durable=operation(),included=false,broadcasts=0;
 const io={async sign(){return raw;},async persist(op:Operation,bytes:Hex){durable={...op,raw_transaction:bytes,hash,state:'signed'};return durable;},async validate(){},async observe(){return included?'included' as const:'missing' as const;},async broadcast(){included=true;broadcasts++;return hash;},async state(){throw Error('fixture_database_unavailable');}};
 await expect(driveTransaction(durable,data,io)).rejects.toThrow('fixture_database_unavailable');
 await expect(driveTransaction(durable,data,io)).resolves.toMatchObject({reason:'receipt_awaiting_independent_verification'});expect(broadcasts).toBe(1);
});
test('unknown RPC receipt observation never broadcasts or creates another signed operation',async()=>{
 const op={...operation(),raw_transaction:raw,hash,state:'unknown'};let broadcasts=0,signs=0;
 const result=await driveTransaction(op,data,{async sign(){signs++;return raw;},async persist(){return op;},async validate(){},async observe(){return 'unknown';},async broadcast(){broadcasts++;return hash;},async state(){}});
 expect(result).toMatchObject({state:'unknown'});expect(broadcasts).toBe(0);expect(signs).toBe(0);
});

test('serialized zero-value transactions retain all exact bindings',async()=>{
 const {privateKeyToAccount}=await import('viem/accounts');const {keccak256}=await import('viem');
 const signer=privateKeyToAccount(`0x${'11'.repeat(32)}`);
 const make=async(value:bigint)=>{const op=operation();const signed=await signer.signTransaction({type:'eip1559',chainId:5042002,to:op.request.to,data,value,nonce:op.nonce,gas:BigInt(op.request.gas),maxFeePerGas:BigInt(op.request.maxFeePerGas),maxPriorityFeePerGas:BigInt(op.request.maxPriorityFeePerGas)});return {...op,raw_transaction:signed,hash:keccak256(signed)};};
 await expect(validateTransactionBinding(await make(BigInt(0)),data,signer.address)).resolves.toBeUndefined();
 await expect(validateTransactionBinding(await make(BigInt(1)),data,signer.address)).rejects.toThrow('signed_transaction_binding_invalid');
 await expect(validateTransactionBinding(await make(BigInt(0)),data,'0x0000000000000000000000000000000000000001')).rejects.toThrow('signed_transaction_binding_invalid');
});
