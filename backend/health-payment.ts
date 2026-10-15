import {HTTPFacilitatorClient} from '@x402/core/server';
import {createPublicClient,http,isAddress,parseAbi} from 'viem';
/** Independent short budget: ordinary refund transaction transport remains unchanged. */
export function healthRpc(){if(!process.env.ARC_RPC_URL)throw Error('rpc_required');return createPublicClient({transport:http(process.env.ARC_RPC_URL,{timeout:2000,retryCount:0,fetchOptions:{signal:AbortSignal.timeout(12000)}})});}
/** Discovery and canonical token reads only: never verify, settle, sign or register. */
export async function paymentAvailable(rpc=healthRpc()){
 if(!isAddress(process.env.MERCHANT_ADDRESS??'')||!process.env.X402_FACILITATOR_URL)throw Error('payment_unconfigured');
 const supported=await new HTTPFacilitatorClient({url:process.env.X402_FACILITATOR_URL,timeoutMs:3000}).getSupported();
 if(!supported.kinds.some(k=>k.x402Version===2&&k.scheme==='exact'&&k.network==='eip155:5042002')||!Object.entries(supported.signers??{}).some(([network,addresses])=>['eip155:*','eip155:5042002'].includes(network)&&addresses.some(a=>isAddress(a))))throw Error('payment_unsupported');
 if(await rpc.getChainId()!==5042002)throw Error('payment_wrong_chain');
 const block=await rpc.getBlock({blockTag:'latest'}),now=BigInt(Math.floor(Date.now()/1000));
 if(!block.hash||block.timestamp<now-BigInt(120)||block.timestamp>now+BigInt(15))throw Error('payment_chain_stale');
 const decimals=await rpc.readContract({address:'0x3600000000000000000000000000000000000000',abi:parseAbi(['function decimals() view returns (uint8)']),functionName:'decimals',blockNumber:block.number,authorizationList:undefined});
 if(decimals!==6||(await rpc.getBlock({blockNumber:block.number})).hash!==block.hash)throw Error('payment_token_unknown');
}
