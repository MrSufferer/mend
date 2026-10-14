import {and,eq,isNull,sql} from 'drizzle-orm';
import {createPublicClient,http,parseAbi,decodeEventLog,type Address,type Hex} from 'viem';
import {database} from './db';
import {orders,paymentAttempts,type PaymentAttempt} from './schema';
const arcUsdc='0x3600000000000000000000000000000000000000';
const abi=parseAbi(['event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)','event Transfer(address indexed from, address indexed to, uint256 value)']);
function rpcClient() {if(!process.env.ARC_RPC_URL) throw new Error('Server RPC required');return createPublicClient({transport:http(process.env.ARC_RPC_URL,{timeout:10000})});}
export async function confirmReceipt(attempt:PaymentAttempt) {
 const rpc=rpcClient(); if(await rpc.getChainId()!==5042002) throw new Error('Wrong network');
 let transaction=attempt.transaction as Hex|null;
 if(!transaction) {
  const latest=await rpc.getBlockNumber(),from=BigInt(attempt.scanBlock),to=latest<from+BigInt(1999)?latest:from+BigInt(1999);
  if(to<from)return;
  const logs=await rpc.getLogs({address:arcUsdc,event:abi[0],args:{authorizer:attempt.payer as Address,nonce:attempt.nonce as Hex},fromBlock:from,toBlock:to,strict:true});
  transaction=logs[0]?.transactionHash??null;
  if(!transaction) {await database().update(paymentAttempts).set({scanBlock:sql`GREATEST(${paymentAttempts.scanBlock}::numeric,${(to+BigInt(1)).toString()}::numeric)::text`}).where(eq(paymentAttempts.orderId,attempt.orderId));return;}
 }
 const receipt=await rpc.getTransactionReceipt({hash:transaction});if(receipt.status!=='success')return;
 let used=false,paid=false;
 for(const log of receipt.logs) {
  if(log.address.toLowerCase()!==arcUsdc)continue;
  try {const event=decodeEventLog({abi,data:log.data,topics:log.topics}) as {eventName:'AuthorizationUsed',args:{authorizer:Address,nonce:Hex}}|{eventName:'Transfer',args:{from:Address,to:Address,value:bigint}};
   if(event.eventName==='AuthorizationUsed')used ||= event.args.authorizer.toLowerCase()===attempt.payer&&event.args.nonce.toLowerCase()===attempt.nonce;
   if(event.eventName==='Transfer')paid ||= event.args.from.toLowerCase()===attempt.payer&&event.args.to.toLowerCase()===attempt.requirements.payTo.toLowerCase()&&event.args.value===BigInt(1000000);
  }catch {/* unrelated token log */}
 }
 if(!used||!paid)throw new Error('Receipt does not prove this authorization and transfer');
 const block=await rpc.getBlock({blockHash:receipt.blockHash});const paidAt=new Date(Number(block.timestamp)*1000);
 const paymentReceipt={status:'success' as const,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash,amountAtomic:'1000000',decimals:6 as const,gasUsed:receipt.gasUsed.toString(),effectiveGasPrice:receipt.effectiveGasPrice.toString()};
 await database().batch([
  database().update(paymentAttempts).set({transaction}).where(eq(paymentAttempts.orderId,attempt.orderId)),
  database().update(orders).set({paymentReceipt}).where(eq(orders.id,attempt.orderId)),
  database().update(orders).set({status:'paid',payerWallet:attempt.payer,ownerWallet:attempt.payer,paymentTransaction:transaction,paidAt}).where(and(eq(orders.id,attempt.orderId),isNull(orders.paidAt))),
 ]);
}
