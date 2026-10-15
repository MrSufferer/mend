import {test,expect} from '@playwright/test';
import {neon} from '@neondatabase/serverless';
import {drizzle} from 'drizzle-orm/neon-http';
import {createServer} from 'node:http';
import {parseEnv} from 'node:util';
import {readFileSync} from 'node:fs';
import {privateKeyToAccount} from 'viem/accounts';
import {encodeAbiParameters,encodeEventTopics,keccak256,type Hex} from 'viem';
import * as schema from '../lib/server/schema';
import {refundFixture,role} from './refund-fixture';
import {createRegistrarService} from '../backend/registrar';
import {createRefundService} from '../backend/refund';
import {driveTransaction,validateTransactionBinding,type Operation} from '../backend/refund-transactions';
import {reserve,token,reserveAbi,tokenAbi,calldata,signerAddresses,type ChainReceipt} from '../backend/refund-chain';
import type {CapacityReader} from '../backend/refund-capacity';
const account=privateKeyToAccount(`0x${'31'.repeat(32)}`),blockHash=`0x${'32'.repeat(32)}` as Hex;
const db=(name:string)=>drizzle(neon(parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/${name}.env`,'utf8')).DATABASE_URL_UNPOOLED),{schema});
for(const recovery of ['funding','allowance'])test(`${recovery}: real worker and registrar HTTP recover affordable refunds while aggregate pause and exhausted model budget persist`,async()=>{
 const first=await refundFixture(),second=await refundFixture(),registrarDb=db('database-registrar'),workerDb=db('database-refund-worker');
 const registrarSql=role('database-registrar'),workerSql=role('database-refund-worker'),conversion=role('database-conversion');
 let balance=BigInt(recovery==='funding'?0:1000000),allowance=BigInt(recovery==='funding'?1000000:0),effects=0;const receipts=new Map<Hex,ChainReceipt>(),registered=new Set<string>(),repaid=new Set<string>();
 const bindings=new Map<string,{chain_order_id:Hex;payer:Hex;amount_atomic:string}>();
 const reader:CapacityReader={getChainId:async()=>5042002,getBlock:async()=>({number:BigInt(100),hash:blockHash,timestamp:BigInt(Math.floor(Date.now()/1000))}),getTransactionReceipt:async({hash})=>{if(!receipts.has(hash))throw Error('not included');return receipts.get(hash)!;},readContract:async args=>args.functionName==='balanceOf'?balance:args.functionName==='remainingDailyAllowance'?allowance:[registered.has(String(args.args?.[0]))?bindings.get(String(args.args?.[0]))!.payer:`0x${'00'.repeat(20)}`,registered.has(String(args.args?.[0]))?BigInt(1000000):BigInt(0),repaid.has(String(args.args?.[0]))]};
 const submit:NonNullable<Parameters<typeof createRefundService>[0]>['submit']=async(order,kind,binding)=>{
  const q=kind==='registrar'?registrarSql:workerSql,data=calldata(kind,binding),request={chainId:5042002,to:reserve,data,value:'0',gas:'100000',maxFeePerGas:'2',maxPriorityFeePerGas:'1'};
  let op=(await q.query('SELECT mend_refund_operation($1,$2) AS value',[order,kind]))[0].value;
  if(op.reason==='not_reserved'){const [s]=await first.owner.query('SELECT next_nonce FROM refund_signers WHERE kind=$1',[kind]);op=(await q.query('SELECT mend_refund_operation($1,$2,$3,$4::jsonb) AS value',[order,kind,Math.max(0,s.next_nonce),JSON.stringify(request)]))[0].value;}
  if(op.reason)return op;
  return driveTransaction(op,data,{
   sign:async operation=>account.signTransaction({type:'eip1559',chainId:5042002,to:reserve,data,nonce:operation.nonce,gas:BigInt(100000),maxFeePerGas:BigInt(2),maxPriorityFeePerGas:BigInt(1)}),
   persist:async(operation,raw)=>(await q.query('SELECT mend_refund_signed($1,$2,$3) AS value',[operation.id,raw,keccak256(raw)]))[0].value as Operation,
   validate:(operation,expected)=>validateTransactionBinding(operation,expected,account.address),
   observe:async hash=>receipts.has(hash)?'included':'missing',
   broadcast:async raw=>{const hash=keccak256(raw);if(!receipts.has(hash)){
    if(kind==='refund'){if(balance<BigInt(1000000)||allowance<BigInt(1000000)||repaid.has(binding.chain_order_id))throw Error('contract denied');effects++;balance-=BigInt(1000000);allowance-=BigInt(1000000);repaid.add(binding.chain_order_id);}else registered.add(binding.chain_order_id);
    const logs=[{address:reserve,topics:encodeEventTopics({abi:reserveAbi,eventName:kind==='refund'?'Refunded':'EntitlementRegistered',args:{orderId:binding.chain_order_id,payer:binding.payer}}) as [Hex,...Hex[]],data:encodeAbiParameters(kind==='refund'?[{type:'uint256'},{type:'uint256'}]:[{type:'uint256'}],kind==='refund'?[BigInt(1000000),BigInt(Math.floor(Date.now()/86400000))]:[BigInt(1000000)])}];
    if(kind==='refund')logs.push({address:token,topics:encodeEventTopics({abi:tokenAbi,eventName:'Transfer',args:{from:reserve,to:binding.payer}}) as [Hex,...Hex[]],data:encodeAbiParameters([{type:'uint256'}],[BigInt(1000000)])});
    receipts.set(hash,{transactionHash:hash,status:'success',blockNumber:BigInt(100),blockHash,from:signerAddresses[kind],to:reserve,logs});
   }return hash;},
   state:async(id,state)=>{await q.query('SELECT mend_refund_receipt($1,$2)',[id,state]);},
  });
 };
 const registrar=createRegistrarService({database:()=>registrarDb,reader:()=>reader,capacityReader:reader,submit});
 const secret='controlled-worker-capacity-secret-'.repeat(2),prior={...process.env};Object.assign(process.env,{REGISTRAR_SERVICE_SECRET:secret,REFUND_SERVICE_SECRET:secret});
 let worker:ReturnType<typeof createRefundService>;
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const response=await (req.url==='/worker'?worker:registrar).fetch(new Request(`http://fixture${req.url==='/worker'?'/reconcile':req.url}`,{method:req.method,headers:req.headers as Record<string,string>,body:Buffer.concat(chunks)}));res.writeHead(response.status);res.end(await response.text());});
 try{
  for(const f of [first,second]){await conversion.query("SELECT mend_refund_output_check($1,$2::jsonb,'absent')",[f.id,JSON.stringify([f.attempt])]);const [r]=await registrarSql.query('SELECT mend_refund_fence($1,$2::jsonb) AS value',[f.id,JSON.stringify(f.payment())]);bindings.set(r.value.chain_order_id,r.value);}
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));process.env.REGISTRAR_SERVICE_URL=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  worker=createRefundService({database:()=>workerDb,submit});
  const reconcile=(orderId:string)=>fetch(`${process.env.REGISTRAR_SERVICE_URL}/worker`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({orderId})});
  expect(await (await reconcile(first.id)).json()).toEqual({status:'pending',reason:recovery==='funding'?'reserve_unfunded':'allowance_exhausted'});expect(effects).toBe(0);
  balance=BigInt(1000000);allowance=BigInt(1000000);
  expect((await (await reconcile(first.id)).json()).status).toBe('refunded');expect(effects).toBe(1);
  await Promise.all([reconcile(first.id),reconcile(first.id)]);expect(effects).toBe(1);
  const [status]=await first.owner.query("SELECT paused,(SELECT calls_used FROM recovery_cases WHERE order_id=$1) AS calls FROM service_availability WHERE id='merchant'",[first.id]);expect(status).toEqual({paused:true,calls:12});
  expect((await (await reconcile(second.id)).json()).reason).toBe('reserve_unfunded');
  balance=BigInt(1000000);allowance=BigInt(1000000);
  await Promise.all([reconcile(second.id),reconcile(second.id)]);await reconcile(second.id);expect(effects).toBe(2);
  const [count]=await first.owner.query("SELECT count(*)::int AS n FROM refund_transactions WHERE kind='refund' AND order_id IN ($1,$2)",[first.id,second.id]);expect(count.n).toBe(2);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));await first.cleanup();await second.cleanup();for(const k of Object.keys(process.env))if(!(k in prior))delete process.env[k];Object.assign(process.env,prior);}
});
