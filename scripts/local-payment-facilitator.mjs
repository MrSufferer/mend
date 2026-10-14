// Acceptance fallback only. Signer stays in this local process, never the web/function.
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createPublicClient,createWalletClient,http,defineChain} from 'viem';
import {privateKeyToAccount} from 'viem/accounts';
import {x402Facilitator} from '@x402/core/facilitator';
import {ExactEvmScheme} from '@x402/evm/exact/facilitator';
import {toFacilitatorEvmSigner} from '@x402/evm';
const config=parseEnv(readFileSync(process.env.FACILITATOR_WEB_CONFIG,'utf8'));
const key=parseEnv(readFileSync(process.env.FACILITATOR_PURCHASER_ENV,'utf8')).TEST_PURCHASER_PRIVATE_KEY;
const account=privateKeyToAccount(key),chain=defineChain({id:5042002,name:'Arc testnet',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:{default:{http:[config.ARC_RPC_URL]}}});
const publicClient=createPublicClient({chain,transport:http(config.ARC_RPC_URL,{timeout:10000})}),walletClient=createWalletClient({chain,account,transport:http(config.ARC_RPC_URL,{timeout:10000})});
const signer=toFacilitatorEvmSigner({address:account.address,readContract:a=>publicClient.readContract(a),verifyTypedData:a=>publicClient.verifyTypedData(a),getCode:a=>publicClient.getCode(a),writeContract:a=>walletClient.writeContract(a),sendTransaction:a=>walletClient.sendTransaction(a),waitForTransactionReceipt:a=>publicClient.waitForTransactionReceipt(a)},{confirmationTimeoutMs:20000});
const facilitator=new x402Facilitator().register('eip155:5042002',new ExactEvmScheme(signer,{simulateInSettle:true}));
const server=createServer(async(request,response)=>{
 response.setHeader('Content-Type','application/json');
 try {
  if(request.method==='GET'&&request.url==='/supported'){response.end(JSON.stringify(facilitator.getSupported()));return;}
  if(request.method!=='POST'||!['/verify','/settle'].includes(request.url)){response.writeHead(404).end('{}');return;}
  let body='';for await(const chunk of request){body+=chunk;if(body.length>20000)throw new Error('request_limit');}
  const {paymentPayload:p,paymentRequirements:r}=JSON.parse(body);
  if(r?.scheme!=='exact'||r.network!=='eip155:5042002'||r.asset?.toLowerCase()!=='0x3600000000000000000000000000000000000000'||r.amount!=='1000000'||r.payTo?.toLowerCase()!==config.MERCHANT_ADDRESS.toLowerCase()||r.extra?.name!=='USDC'||r.extra?.version!=='2'||p?.payload?.authorization?.from?.toLowerCase()!==account.address.toLowerCase())throw new Error('requirements_rejected');
  const result=request.url==='/verify'?await facilitator.verify(p,r):await facilitator.settle(p,r);response.end(JSON.stringify(result));
  console.log(JSON.stringify({operation:request.url,isValid:result.isValid,success:result.success,transaction:result.transaction,reason:result.invalidReason??result.errorReason}));
 }catch{response.writeHead(400).end(JSON.stringify({error:'local_facilitator_failed'}));}
});
server.listen(3039,'127.0.0.1',()=>console.log('Official x402 acceptance fallback listening on localhost:3039'));
