import {createPublicClient,http,keccak256,parseTransaction,recoverTransactionAddress,TransactionReceiptNotFoundError,type Hex,type TransactionSerializedEIP1559} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {sql} from 'drizzle-orm';
import {database} from '../lib/server/db';
import {calldata,chainId,reserve,roleId,reserveAbi,signerAddresses,type RefundBinding,type ChainReader,type ChainReceipt} from './refund-chain';

export const refundRpc=()=>{if(!process.env.ARC_RPC_URL)throw new Error('rpc_required');return createPublicClient({transport:http(process.env.ARC_RPC_URL,{timeout:10000})});};
export const canonicalReader=():ChainReader=>{const rpc=refundRpc();return {getChainId:()=>rpc.getChainId(),getTransactionReceipt:async args=>await rpc.getTransactionReceipt(args) as unknown as ChainReceipt,getBlock:async args=>{const block=await rpc.getBlock(args);return {hash:block.hash as Hex|null,timestamp:block.timestamp as bigint};}};};
type RequestData={chainId:number;to:Hex;data:Hex;value:string;gas:string;maxFeePerGas:string;maxPriorityFeePerGas:string};
export type Operation={id:string;order_id:string;kind:'registrar'|'refund';nonce:number;request:RequestData;raw_transaction:Hex|null;hash:Hex|null;state:string};
export type Ledger={operation(order:string,kind:'registrar'|'refund',nonce?:number,request?:RequestData):Promise<Operation|{reason:string}>;signed(id:string,raw:Hex,hash:Hex):Promise<Operation>;state(id:string,state:'submitted'|'unknown'):Promise<void>};
export const ledger:Ledger={
 async operation(order,kind,nonce,request){const result=await database().execute(sql`SELECT public.mend_refund_operation(${order}::uuid,${kind},${nonce??null}::integer,${request?JSON.stringify(request):null}::jsonb) AS result`);return result.rows[0].result as Operation|{reason:string};},
 async signed(id,raw,hash){const result=await database().execute(sql`SELECT public.mend_refund_signed(${id}::uuid,${raw},${hash}) AS result`);return result.rows[0].result as Operation;},
 async state(id,state){await database().execute(sql`SELECT public.mend_refund_receipt(${id}::uuid,${state})`);},
};
export async function validateTransactionBinding(operation:Operation,expectedData:Hex,expectedSigner:Hex){
 if(!operation.raw_transaction||!operation.hash)throw new Error('signed_transaction_required');
 const parsed=parseTransaction(operation.raw_transaction),request=operation.request;
 if(keccak256(operation.raw_transaction)!==operation.hash||parsed.chainId!==chainId||parsed.to?.toLowerCase()!==reserve||parsed.data!==expectedData||parsed.nonce!==operation.nonce||(parsed.value??BigInt(0))!==BigInt(0)||parsed.gas!==BigInt(request.gas)||parsed.maxFeePerGas!==BigInt(request.maxFeePerGas)||parsed.maxPriorityFeePerGas!==BigInt(request.maxPriorityFeePerGas)||(await recoverTransactionAddress({serializedTransaction:operation.raw_transaction as TransactionSerializedEIP1559})).toLowerCase()!==expectedSigner.toLowerCase())throw new Error('signed_transaction_binding_invalid');
}
export const validateSigned=(operation:Operation,data:Hex)=>validateTransactionBinding(operation,data,signerAddresses[operation.kind]);
type TransactionIO={
 sign(operation:Operation):Promise<Hex>;
 persist(operation:Operation,raw:Hex):Promise<Operation>;
 validate(operation:Operation,data:Hex):Promise<void>;
 observe(hash:Hex):Promise<'included'|'missing'|'unknown'>;
 broadcast(raw:Hex):Promise<Hex>;
 state(id:string,state:'submitted'|'unknown'):Promise<void>;
};
export async function driveTransaction(operation:Operation,data:Hex,io:TransactionIO){
 if(operation.state==='confirmed')return {hash:operation.hash,state:'confirmed'};
 if(operation.state==='reverted')return {reason:'transaction_reverted'};
 let op=operation;
 if(!op.raw_transaction)op=await io.persist(op,await io.sign(op));
 await io.validate(op,data);
 const observation=await io.observe(op.hash!);
 // Inclusion is evidence for the independent registrar, never a worker assertion of repayment.
 if(observation==='included')return {hash:op.hash,reason:'receipt_awaiting_independent_verification'};
 if(observation==='unknown'){await io.state(op.id,'unknown');return {hash:op.hash,state:'unknown'};}
 try{
  const hash=await io.broadcast(op.raw_transaction!);
  if(hash!==op.hash)throw new Error('broadcast_hash_mismatch');
  await io.state(op.id,'submitted');return {hash,state:'submitted'};
 }catch{await io.state(op.id,'unknown');return {hash:op.hash,state:'unknown'};}
}
export async function submitRefund(order:string,kind:'registrar'|'refund',r:RefundBinding){
 const rpc=refundRpc(),secret=process.env[kind==='registrar'?'REGISTRAR_PRIVATE_KEY':'REFUND_PRIVATE_KEY'];
 if(!/^0x[0-9a-fA-F]{64}$/.test(secret||''))throw new Error('signer_required');
 const account=privateKeyToAccount(secret as Hex);
 if(account.address.toLowerCase()!==signerAddresses[kind]||await rpc.getChainId()!==chainId||!(await rpc.readContract({address:reserve,abi:reserveAbi,functionName:'hasRole',authorizationList:undefined,args:[roleId(kind),account.address]})))throw new Error('signer_authority_invalid');
 const data=calldata(kind,r);
 let op=await ledger.operation(order,kind);
 if('reason' in op){
  if(op.reason!=='not_reserved')return {reason:op.reason};
  const nonce=await rpc.getTransactionCount({address:account.address,blockTag:'pending'});
  const gas=await rpc.estimateGas({account:account.address,to:reserve,data,value:BigInt(0)});
  const fees=await rpc.estimateFeesPerGas();
  const request:RequestData={chainId,to:reserve,data,value:'0',gas:gas.toString(),maxFeePerGas:fees.maxFeePerGas.toString(),maxPriorityFeePerGas:fees.maxPriorityFeePerGas.toString()};
  op=await ledger.operation(order,kind,nonce,request);
  if('reason' in op)return {reason:op.reason};
 }
 return driveTransaction(op,data,{
  async sign(operation){const q=operation.request;
   if(q.data!==data||q.to!==reserve||q.chainId!==chainId||q.value!=='0')throw new Error('reserved_transaction_binding_invalid');
   return account.signTransaction({type:'eip1559',chainId,to:q.to,data:q.data,value:BigInt(0),nonce:operation.nonce,gas:BigInt(q.gas),maxFeePerGas:BigInt(q.maxFeePerGas),maxPriorityFeePerGas:BigInt(q.maxPriorityFeePerGas)});
  },
  persist:(operation,raw)=>ledger.signed(operation.id,raw,keccak256(raw)),
  validate:validateSigned,
  async observe(hash){try{const receipt=await rpc.getTransactionReceipt({hash});const block=await rpc.getBlock({blockNumber:receipt.blockNumber});return block.hash===receipt.blockHash?'included':'unknown';}catch(error){return error instanceof TransactionReceiptNotFoundError?'missing':'unknown';}},
  broadcast:raw=>rpc.sendRawTransaction({serializedTransaction:raw}),
  state:ledger.state,
 });
}
