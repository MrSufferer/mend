import {decodeEventLog,encodeFunctionData,keccak256,parseAbi,stringToHex,type Abi,type Address,type Hex} from 'viem';
import manifest from '../contracts/deployment/arc-testnet.json';
import artifact from '../contracts/deployment/RefundReserve.abi.json';
import type {Order,PaymentAttempt} from '../lib/server/schema';

export const reserve=manifest.address.toLowerCase() as Address;
export const token=manifest.token.toLowerCase() as Address;
export const chainId=manifest.chainId;
export const signerAddresses={registrar:manifest.roles.registrar.toLowerCase() as Address,refund:manifest.roles.worker.toLowerCase() as Address} as const;
export const reserveAbi=artifact as Abi;
export const tokenAbi=parseAbi(['event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)','event Transfer(address indexed from,address indexed to,uint256 value)','function balanceOf(address) view returns(uint256)']);
type TokenEvent={eventName:'AuthorizationUsed';args:{authorizer:Address;nonce:Hex}}|{eventName:'Transfer';args:{from:Address;to:Address;value:bigint}};
type ReserveEvent={eventName:'EntitlementRegistered'|'Refunded';args:{orderId:Hex;payer:Address;amount:bigint}};
export type ChainReceipt={transactionHash:Hex;status:'success'|'reverted';blockNumber:bigint;blockHash:Hex;from:Address;to:Address|null;logs:{address:Address;data:Hex;topics:[Hex,...Hex[]]}[]};
export type ChainReader={getChainId():Promise<number>;getTransactionReceipt(args:{hash:Hex}):Promise<ChainReceipt>;getBlock(args:{blockNumber:bigint}):Promise<{hash:Hex|null;timestamp:bigint}>};
export type RefundBinding={chain_order_id:Hex;payer:Address;amount_atomic:string};
export const roleId=(kind:'registrar'|'refund')=>keccak256(stringToHex(kind==='registrar'?'REGISTRAR_ROLE':'WORKER_ROLE'));
export const calldata=(kind:'registrar'|'refund',r:RefundBinding)=>encodeFunctionData({abi:reserveAbi,functionName:kind==='registrar'?'registerEntitlement':'refund',args:[r.chain_order_id,r.payer,BigInt(r.amount_atomic)]});
async function canonical(rpc:ChainReader,hash:Hex){
 if(await rpc.getChainId()!==chainId)throw new Error('wrong_chain');
 const receipt=await rpc.getTransactionReceipt({hash});
 if(receipt.transactionHash.toLowerCase()!==hash.toLowerCase()||receipt.status!=='success'||receipt.blockNumber===null)throw new Error('successful_receipt_required');
 const block=await rpc.getBlock({blockNumber:receipt.blockNumber});
 if(block.hash?.toLowerCase()!==receipt.blockHash.toLowerCase())throw new Error('receipt_not_canonical');
 return {receipt,block};
}
export async function verifyPayment(rpc:ChainReader,o:Order,a:PaymentAttempt){
 const authorization=a.payload.payload.authorization as {from?:string;to?:string;value?:string;nonce?:string}|undefined;
 const expected=a.requirements;
 if(!o.paymentTransaction||a.transaction!==o.paymentTransaction||a.payer!==o.payerWallet||o.terms.price.amount!=='1'||o.terms.price.currency!=='test USDC'||o.terms.price.network!=='Arc testnet'||expected.amount!=='1000000'||expected.network!==`eip155:${chainId}`||expected.asset.toLowerCase()!==token||authorization?.from?.toLowerCase()!==a.payer||authorization?.nonce?.toLowerCase()!==a.nonce||authorization?.to?.toLowerCase()!==expected.payTo.toLowerCase()||authorization?.value!==expected.amount)throw new Error('payment_binding_invalid');
 const {receipt,block}=await canonical(rpc,o.paymentTransaction as Hex);
 let used=false,transfer=false;
 for(const log of receipt.logs){if(log.address.toLowerCase()!==token)continue;try{
  const event=decodeEventLog({abi:tokenAbi,data:log.data,topics:log.topics}) as TokenEvent;
  if(event.eventName==='AuthorizationUsed')used ||= event.args.authorizer.toLowerCase()===a.payer&&event.args.nonce.toLowerCase()===a.nonce;
  if(event.eventName==='Transfer')transfer ||= event.args.from.toLowerCase()===a.payer&&event.args.to.toLowerCase()===expected.payTo.toLowerCase()&&event.args.value===BigInt(expected.amount);
 }catch{/* Unrelated events cannot establish payment. */}}
 if(!used||!transfer||!o.paidAt||BigInt(Math.floor(o.paidAt.getTime()/1000))!==block.timestamp)throw new Error('canonical_payment_required');
 return {transaction:o.paymentTransaction,payer:a.payer,amountAtomic:expected.amount,chainId:String(chainId),blockHash:receipt.blockHash,blockNumber:receipt.blockNumber.toString(),checkedAt:new Date().toISOString()};
}
export async function verifyRefundReceipt(rpc:ChainReader,kind:'registrar'|'refund',hash:Hex,r:RefundBinding){
 const {receipt}=await canonical(rpc,hash);let eventFound=false,transfer=kind==='registrar';
 if(receipt.to?.toLowerCase()!==reserve||receipt.from.toLowerCase()!==signerAddresses[kind])throw new Error('wrong_refund_sender_or_contract');
 for(const log of receipt.logs){try{
  if(log.address.toLowerCase()===reserve){const event=decodeEventLog({abi:reserveAbi,data:log.data,topics:log.topics}) as unknown as ReserveEvent;
   if(event.eventName===(kind==='registrar'?'EntitlementRegistered':'Refunded'))eventFound ||= event.args.orderId.toLowerCase()===r.chain_order_id&&event.args.payer.toLowerCase()===r.payer&&event.args.amount===BigInt(r.amount_atomic);
  }
  if(kind==='refund'&&log.address.toLowerCase()===token){const event=decodeEventLog({abi:tokenAbi,data:log.data,topics:log.topics}) as TokenEvent;if(event.eventName==='Transfer')transfer ||= event.args.from.toLowerCase()===reserve&&event.args.to.toLowerCase()===r.payer&&event.args.value===BigInt(r.amount_atomic);}
 }catch{/* A matching event and transfer are both required. */}}
 if(!eventFound||!transfer)throw new Error('matching_refund_receipt_required');
 return {transaction:hash,payer:r.payer,amountAtomic:r.amount_atomic,chainOrderId:r.chain_order_id,chainId:String(chainId),contract:reserve,status:'success',blockHash:receipt.blockHash,blockNumber:receipt.blockNumber.toString()};
}
