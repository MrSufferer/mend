import {readFile,writeFile} from 'node:fs/promises';
import {x402Client} from '@x402/core/client';
import {ExactEvmScheme} from '@x402/evm/exact/client';
import {decodePaymentRequiredHeader,encodePaymentSignatureHeader} from '@x402/core/http';
import {privateKeyToAccount} from 'viem/accounts';
type State={capability:string,orderId:string,paymentSignature?:string,paymentOrigin?:string};
async function main() {
 const [origin,stateFile='.mend-submission.json']=process.argv.slice(2);if(!origin)throw new Error('Usage: npm run purchase -- https://app.example private-state.json');
 const base=new URL(origin);if(base.protocol!=='https:'&&!['localhost','127.0.0.1'].includes(base.hostname))throw new Error('HTTPS required outside localhost.');
 const state:State=JSON.parse(await readFile(stateFile,'utf8'));if(!state.orderId||!state.capability)throw new Error('Run submit first using this private state file.');
 if(state.paymentOrigin&&state.paymentOrigin!==base.origin)throw new Error('Payment state belongs to another origin.');
 const url=new URL(`/api/orders/${state.orderId}/payment`,base);
 const send=()=>fetch(url,{method:'POST',headers:{Authorization:`Bearer ${state.capability}`,...(state.paymentSignature?{'PAYMENT-SIGNATURE':state.paymentSignature}:{})},signal:AbortSignal.timeout(45000)});
 let response=await send();
 if(response.status===402&&!state.paymentSignature) {
  const raw=response.headers.get('PAYMENT-REQUIRED');if(!raw)throw new Error('No x402 v2 payment challenge.');const required=decodePaymentRequiredHeader(raw);
  const accepted=required.accepts[0];if(required.x402Version!==2||accepted?.network!=='eip155:5042002'||accepted.scheme!=='exact'||accepted.asset.toLowerCase()!=='0x3600000000000000000000000000000000000000'||accepted.amount!=='1000000'||accepted.extra?.name!=='USDC'||accepted.extra?.version!=='2')throw new Error('Refusing unsupported payment requirements.');
  if(!process.env.MERCHANT_ADDRESS||accepted.payTo.toLowerCase()!==process.env.MERCHANT_ADDRESS.toLowerCase())throw new Error('MERCHANT_ADDRESS must match the trusted recipient.');
  const key=process.env.TEST_PURCHASER_PRIVATE_KEY;if(!/^0x[0-9a-fA-F]{64}$/.test(key||''))throw new Error('Dedicated TEST_PURCHASER_PRIVATE_KEY required in purchaser process only.');
  const client=new x402Client().register('eip155:5042002',new ExactEvmScheme(privateKeyToAccount(key as `0x${string}`)));
  state.paymentSignature=encodePaymentSignatureHeader(await client.createPaymentPayload(required));state.paymentOrigin=base.origin;
  // Save before sending: response loss or process interruption cannot create a fresh charge.
  await writeFile(stateFile,JSON.stringify(state)+'\n',{mode:0o600});response=await send();
 }
 const body=await response.json();if(![200,202].includes(response.status))throw new Error(`${body.error??'payment_rejected'}: ${body.message??'Reconcile with the same state file; do not sign a replacement.'}`);
 console.log(JSON.stringify({order:body,next:response.status===202?'Outcome pending. Rerun with the same private state file to reconcile the original authorization.':'Receipt confirmed. No additional payment required.'},null,2));
}
main().catch(()=>{console.error('Purchase not confirmed. Reuse the same private state file to reconcile; do not create a second payment.');process.exitCode=1;});
