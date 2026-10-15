import {test,expect} from '@playwright/test';
import {observeCapacity,type CapacityReader} from '../backend/refund-capacity';
import {chainId,type RefundBinding} from '../backend/refund-chain';
import {encodeAbiParameters,encodeEventTopics,type Hex} from 'viem';
import {reserve,token,reserveAbi,tokenAbi,signerAddresses} from '../backend/refund-chain';
const hash=`0x${'ab'.repeat(32)}` as Hex;
const binding={order_id:'owned',chain_order_id:`0x${'cd'.repeat(32)}`,payer:`0x${'ef'.repeat(20)}`,amount_atomic:'1000000',refund_hash:null} as RefundBinding&{order_id:string;refund_hash:Hex|null};
function chain(overrides:Partial<CapacityReader>={}):CapacityReader{return {getChainId:async()=>chainId,getBlock:async()=>({number:BigInt(100),hash,timestamp:BigInt(1792022400)}),readContract:async args=>args.functionName==='balanceOf'?BigInt(2000000):args.functionName==='remainingDailyAllowance'?BigInt(1000000):[binding.payer,BigInt(1000000),false],getTransactionReceipt:async()=>{throw Error('missing');},...overrides};}
test('pins balance, allowance and liabilities to one canonical chain block and observed UTC day',async()=>{
 const pins:bigint[]=[];const rpc=chain();const read=rpc.readContract;rpc.readContract=async args=>{pins.push(args.blockNumber);return read(args);};
 const view=await observeCapacity(rpc,[binding],new Date('2026-10-15T00:00:00Z'));
 expect(view.balanceAtomic).toBe('2000000');expect(view.allowanceAtomic).toBe('1000000');expect(view.outstandingOrderIds).toEqual(['owned']);expect(view.allowanceResetAt).toBe('2026-10-16T00:00:00.000Z');expect(pins).toEqual([BigInt(100),BigInt(100),BigInt(100)]);
});
test('unknown or stale chain facts never establish sufficient capacity',async()=>{
 await expect(observeCapacity(chain({getBlock:async()=>({number:BigInt(100),hash,timestamp:BigInt(1)})}),[binding],new Date('2026-10-15'))).rejects.toThrow();
 await expect(observeCapacity(chain({getChainId:async()=>1}),[binding],new Date('2026-10-15'))).rejects.toThrow();
});
test('UTC midnight uses observed chain time to expose the new contract allowance without claiming automatic reopening',async()=>{
 let time=BigInt(1792108799),remaining=BigInt(0);
 const rpc=chain({getBlock:async()=>({number:BigInt(100),hash,timestamp:time}),readContract:async args=>args.functionName==='balanceOf'?BigInt(1000000):args.functionName==='remainingDailyAllowance'?remaining:[binding.payer,BigInt(1000000),false]});
 const before=await observeCapacity(rpc,[binding],new Date('2026-10-15T23:59:59Z'));
 expect(before.allowanceAtomic).toBe('0');expect(before.allowanceResetAt).toBe('2026-10-16T00:00:00.000Z');
 time=BigInt(1792108800);remaining=BigInt(10000000);
 const after=await observeCapacity(rpc,[binding],new Date('2026-10-16T00:00:00Z'));
 expect(after.allowanceAtomic).toBe('10000000');expect(after.allowanceResetAt).toBe('2026-10-17T00:00:00.000Z');expect(after.outstandingOrderIds).toEqual(['owned']);
});

test('canonical repayment excludes receipt-lag debt once; missing receipts and reorgs remain unknown',async()=>{
 const paid={...binding,refund_hash:`0x${'99'.repeat(32)}` as Hex};
 const data=encodeAbiParameters([{type:'uint256'}],[BigInt(1000000)]);
 const rpc=chain({readContract:async args=>args.functionName==='balanceOf'||args.functionName==='remainingDailyAllowance'?BigInt(1000000):[binding.payer,BigInt(1000000),true],getTransactionReceipt:async()=>({transactionHash:paid.refund_hash,status:'success',blockNumber:BigInt(90),blockHash:hash,from:signerAddresses.refund,to:reserve,logs:[{address:reserve,data:encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[BigInt(1000000),BigInt(0)]),topics:encodeEventTopics({abi:reserveAbi,eventName:'Refunded',args:{orderId:binding.chain_order_id,payer:binding.payer}}) as [Hex,...Hex[]]},{address:token,data,topics:encodeEventTopics({abi:tokenAbi,eventName:'Transfer',args:{from:reserve,to:binding.payer}}) as [Hex,...Hex[]]}]})});
 const evidence=await observeCapacity(rpc,[paid],new Date('2026-10-15'));expect(evidence.outstandingOrderIds).toEqual([]);expect(evidence.repaidOrderIds).toEqual(['owned']);expect(evidence.balanceAtomic).toBe('1000000');
 await expect(observeCapacity({...rpc,getTransactionReceipt:async()=>{throw Error('receipt lag');}},[paid],new Date('2026-10-15'))).rejects.toThrow('receipt lag');
 let reads=0;await expect(observeCapacity(chain({getBlock:async()=>({number:BigInt(100),hash:(++reads===1?hash:`0x${'00'.repeat(32)}`) as Hex,timestamp:BigInt(1792022400)})}),[binding],new Date('2026-10-15'))).rejects.toThrow('capacity_reorg');
});
