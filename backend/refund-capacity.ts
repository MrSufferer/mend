import type {Address,Hex} from 'viem';
import {chainId,reserve,token,reserveAbi,tokenAbi,verifyRefundReceipt,type ChainReader,type RefundBinding} from './refund-chain';
export type CapacityBinding=RefundBinding&{order_id:string;refund_hash:Hex|null};
export type CapacityReader=ChainReader&{
 getBlock(args:{blockNumber:bigint}|{blockTag:'latest'}):Promise<{number?:bigint;hash:Hex|null;timestamp:bigint}>;
 readContract(args:{address:Address;abi:typeof reserveAbi;functionName:string;args?:readonly unknown[];blockNumber:bigint;authorizationList?:undefined}):Promise<unknown>;
};
/** All amounts are ERC-20 atomic units. Included repayment already reduced both observations. */
export async function observeCapacity(rpc:CapacityReader,bindings:CapacityBinding[],now=new Date()){
 if(await rpc.getChainId()!==chainId)throw Error('wrong_chain');
 const block=await rpc.getBlock({blockTag:'latest'}),seconds=BigInt(Math.floor(now.getTime()/1000));
 if(!block.hash||block.number===undefined||block.timestamp>seconds+BigInt(15)||block.timestamp<seconds-BigInt(120))throw Error('capacity_chain_time_unknown');
 const at={blockNumber:block.number,authorizationList:undefined};
 const balance=await rpc.readContract({address:token,abi:tokenAbi,functionName:'balanceOf',args:[reserve],...at});
 const allowance=await rpc.readContract({address:reserve,abi:reserveAbi,functionName:'remainingDailyAllowance',...at});
 if(typeof balance!=='bigint'||typeof allowance!=='bigint'||balance<BigInt(0)||allowance<BigInt(0)||allowance>BigInt(10000000))throw Error('capacity_amount_unknown');
 const outstandingOrderIds:string[]=[],repaidOrderIds:string[]=[];
 for(const r of bindings){
  const entitlement=await rpc.readContract({address:reserve,abi:reserveAbi,functionName:'entitlements',args:[r.chain_order_id],...at}) as [Address,bigint,boolean];
  if(!Array.isArray(entitlement)||typeof entitlement[2]!=='boolean')throw Error('capacity_entitlement_unknown');
  const [payer,amount,repaid]=entitlement;
  if(payer.toLowerCase()!=='0x0000000000000000000000000000000000000000'&&(payer.toLowerCase()!==r.payer||amount!==BigInt(r.amount_atomic)))throw Error('capacity_binding_invalid');
  if(repaid){
   if(!r.refund_hash)throw Error('capacity_repayment_unknown');
   const proof=await verifyRefundReceipt(rpc,'refund',r.refund_hash,r);
   if(BigInt(proof.blockNumber)>block.number)throw Error('capacity_receipt_after_snapshot');
   repaidOrderIds.push(r.order_id);
  }else outstandingOrderIds.push(r.order_id);
 }
 if((await rpc.getBlock({blockNumber:block.number})).hash!==block.hash)throw Error('capacity_reorg');
 return {chainId,contract:reserve,blockNumber:block.number.toString(),blockHash:block.hash,chainTimestamp:new Date(Number(block.timestamp)*1000).toISOString(),allowanceResetAt:new Date(Number((block.timestamp/BigInt(86400)+BigInt(1))*BigInt(86400))*1000).toISOString(),balanceAtomic:balance.toString(),allowanceAtomic:allowance.toString(),outstandingOrderIds,repaidOrderIds};
}
