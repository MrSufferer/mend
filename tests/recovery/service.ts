// Test-only HTTP host around the real deployed service exports. No production crash API.
import {createServer} from 'node:http';
import {privateKeyToAccount} from 'viem/accounts';
import {keccak256,type Hex} from 'viem';
import {createAgentService} from '../../backend/agent';
import {createRegistrarService} from '../../backend/registrar';
import {createRefundService} from '../../backend/refund';
import conversion from '../../backend/conversion';
import receipts from '../../backend/receipts';
import {driveTransaction,validateTransactionBinding,ledger} from '../../backend/refund-transactions';
import {calldata,reserve,type RefundBinding} from '../../backend/refund-chain';
const effects=process.env.RECOVERY_EFFECT_URL!;
const account=privateKeyToAccount(`0x${'31'.repeat(32)}`);
async function boundary(name:string){await fetch(effects+'/boundary',{method:'POST',body:JSON.stringify({name})});}
async function submit(order:string,kind:'registrar'|'refund',binding:RefundBinding){
 const data=calldata(kind,binding),request={chainId:5042002,to:reserve,data,value:'0',gas:'100000',maxFeePerGas:'2',maxPriorityFeePerGas:'1'};
 let op=await ledger.operation(order,kind);
 if('reason' in op){if(op.reason!=='not_reserved')return op;const chain=await(await fetch(effects+'/state')).json();const nonce=Object.values(chain.transactions).filter((tx:any)=>tx.kind===kind).length;op=await ledger.operation(order,kind,nonce,request);}
 if('reason' in op)return op;
 return driveTransaction(op,data,{
  sign:async o=>account.signTransaction({type:'eip1559',chainId:5042002,to:reserve,data,nonce:o.nonce,gas:BigInt(100000),maxFeePerGas:BigInt(2),maxPriorityFeePerGas:BigInt(1)}),
  persist:async(o,raw)=>{const signed=await ledger.signed(o.id,raw,keccak256(raw));await boundary(kind+'-signed');return signed;},
  validate:(o,expected)=>validateTransactionBinding(o,expected,account.address),
  observe:async hash=>{const s=await(await fetch(effects+'/state')).json();return s.unknown?'unknown':s.transactions[hash]?'included':'missing';},
  broadcast:async raw=>{const r=await fetch(effects+'/chain',{method:'POST',body:JSON.stringify({kind,binding,raw})});return (await r.json()).hash as Hex;},
  state:ledger.state,
 });
}
const name=process.env.RECOVERY_SERVICE;
const service=name==='agent'?createAgentService({modelFetch:async(_input,init)=>fetch(effects+'/model',init)}):name==='registrar'?createRegistrarService({submit}):name==='refund'?createRefundService({submit}):name==='receipts'?receipts:conversion;
const server=createServer(async(req,res)=>{try{const chunks=[];for await(const chunk of req)chunks.push(chunk);const response=await service.fetch(new Request('http://owned'+req.url,{method:req.method,headers:req.headers as Record<string,string>,body:['GET','HEAD'].includes(req.method!)?undefined:Buffer.concat(chunks)}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));}catch{res.writeHead(500);res.end('{}');}});
server.listen(Number(process.env.RECOVERY_SERVICE_PORT??0),'127.0.0.1',()=>console.log('READY:'+(server.address() as {port:number}).port));
