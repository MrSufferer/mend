// A separately killable, disk-backed external world. All identities and money are synthetic.
import {createServer} from 'node:http';
import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {encodeAbiParameters,encodeEventTopics,keccak256,toFunctionSelector,type Hex} from 'viem';
import {reserve,token,reserveAbi,tokenAbi,signerAddresses} from '../../backend/refund-chain';
const file=process.env.RECOVERY_EFFECT_FILE!;
const state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{objects:{},charges:[],transactions:{},pendingTransactions:{},deferMining:false,registrations:[],refunds:[],events:[],modelCalls:0,balance:'10000000',allowance:'10000000',offset:0,unknown:false,hideReceipts:false,modelTool:null,height:99,blocks:{}};
function save(){writeFileSync(file+'.new',JSON.stringify(state),{mode:0o600});renameSync(file+'.new',file);}
const holds=new Map<string,(()=>void)[]>();
async function boundary(name:string){state.events.push(name);save();if(holds.has(name))await new Promise<void>(r=>holds.get(name)!.push(r));}
const hex=(n:number|bigint)=>'0x'+n.toString(16);
function mine(){const number=++state.height,hash='0x'+createHash('sha256').update(String(number)).digest('hex');const b={number:hex(number),hash,timestamp:hex(Math.floor(Date.now()/1000)+state.offset),transactions:[],parentHash:state.blocks[number-1]?.hash??hash,gasLimit:'0x1ffffff',gasUsed:'0x0',miner:reserve,extraData:'0x',size:'0x1',difficulty:'0x0',totalDifficulty:'0x0',nonce:'0x0000000000000000',sha3Uncles:hash,logsBloom:'0x'+'00'.repeat(256),transactionsRoot:hash,stateRoot:hash,receiptsRoot:hash};state.blocks[number]=b;state.snapshots??={};state.snapshots[number]={balance:state.balance,allowance:state.allowance,registrations:[...state.registrations],refunds:[...state.refunds],payers:[...Object.values(state.transactions).map((t:any)=>t.binding),...(state.pendingBinding?[state.pendingBinding]:[])]};save();return b;}
if(!state.blocks[state.height])mine();
function paymentReceipt(charge:any){const b=state.blocks[charge.block],base={address:token,blockNumber:b.number,blockHash:b.hash,transactionHash:charge.hash,transactionIndex:'0x0',removed:false};return receipt(charge.hash,charge.payer,charge.merchant,[{...base,logIndex:'0x0',topics:encodeEventTopics({abi:tokenAbi,eventName:'AuthorizationUsed',args:{authorizer:charge.payer,nonce:charge.nonce}}),data:'0x'},{...base,logIndex:'0x1',topics:encodeEventTopics({abi:tokenAbi,eventName:'Transfer',args:{from:charge.payer,to:charge.merchant}}),data:encodeAbiParameters([{type:'uint256'}],[BigInt(1000000)])}],b);}
function receipt(hash:string,from:string,to:string,logs:any[],b:any){return {transactionHash:hash,transactionIndex:'0x0',blockHash:b.hash,blockNumber:b.number,from,to,contractAddress:null,cumulativeGasUsed:'0x5208',gasUsed:'0x5208',effectiveGasPrice:'0x1',status:'0x1',type:'0x2',logsBloom:'0x'+'00'.repeat(256),logs};}
function includeTransaction(b:any){const hash=keccak256(b.raw),kind=b.kind,r=b.binding;if(state.transactions[hash])return;
   if(kind==='refund'&&(BigInt(state.balance)<BigInt(1000000)||BigInt(state.allowance)<BigInt(1000000)||state.refunds.includes(r.chain_order_id)))throw Error('contract_denied');
   if(kind==='refund'){state.balance=String(BigInt(state.balance)-BigInt(1000000));state.allowance=String(BigInt(state.allowance)-BigInt(1000000));state.refunds.push(r.chain_order_id);}else state.registrations.push(r.chain_order_id);
   state.pendingBinding=r;const logs:any[]=[{address:reserve,topics:encodeEventTopics({abi:reserveAbi,eventName:kind==='refund'?'Refunded':'EntitlementRegistered',args:{orderId:r.chain_order_id,payer:r.payer}}),data:encodeAbiParameters(kind==='refund'?[{type:'uint256'},{type:'uint256'}]:[{type:'uint256'}],kind==='refund'?[BigInt(1000000),BigInt(Math.floor(Date.now()/86400000))]:[BigInt(1000000)])}];
   if(kind==='refund')logs.push({address:token,topics:encodeEventTopics({abi:tokenAbi,eventName:'Transfer',args:{from:reserve,to:r.payer}}),data:encodeAbiParameters([{type:'uint256'}],[BigInt(1000000)])});
   state.transactions[hash]={kind,binding:r,rawHash:hash,receipt:receipt(hash,signerAddresses[kind as 'refund'|'registrar'],reserve,logs,mine())};
 delete state.pendingBinding;delete state.pendingTransactions[hash];save();}
async function body(req:AsyncIterable<Buffer>){const chunks=[];for await(const chunk of req)chunks.push(chunk);return Buffer.concat(chunks);}
const server=createServer(async(req,res)=>{try{
 const url=new URL(req.url!,'http://fixture'),path=url.pathname,bytes=await body(req);
 const json=(value:unknown,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value));};
 if(path==='/control'){
  const c=JSON.parse(bytes.toString());if(c.hold)holds.set(c.hold,[]);if(c.release){const waiting=holds.get(c.release)??[];holds.delete(c.release);waiting.forEach(r=>r());}
  if(c.reset){for(const waiting of holds.values())waiting.forEach(r=>r());holds.clear();Object.assign(state,{objects:{},charges:[],transactions:{},pendingTransactions:{},deferMining:false,registrations:[],refunds:[],events:[],modelCalls:0,balance:'10000000',allowance:'10000000',offset:0,unknown:false,hideReceipts:false,orphan:false,modelTool:null});mine();}
  for(const key of ['balance','allowance','offset','unknown','hideReceipts','modelTool','orphan','deferMining'])if(key in c)state[key]=c[key];if(['offset','balance','allowance'].some(k=>k in c))mine();if(c.minePending)for(const pending of Object.values(state.pendingTransactions))includeTransaction(pending);if(c.clearEvents)state.events=[];save();json({ok:true});return;
 }
 if(path==='/state'){json(state);return;}
 if(path==='/boundary'){await boundary(JSON.parse(bytes.toString()).name);json({ok:true});return;}
 if(path==='/model'){state.modelCalls++;await boundary('model');
  if(!state.modelTool){json({error:{message:'Controlled unavailable model',code:429}},429);return;}
  const b=JSON.parse(bytes.toString()),last=b.messages?.at(-1),name=last?.role==='tool'?null:state.modelTool;
  json({id:'controlled-'+state.modelCalls,created:1,model:b.model,object:'chat.completion',choices:[{index:0,finish_reason:name?'tool_calls':'stop',message:name?{role:'assistant',content:null,tool_calls:[{id:'fixture-tool-'+state.modelCalls,type:'function',function:{name,arguments:name==='observe_later'?'{"seconds":60}':'{}'}}]}:{role:'assistant',content:'Evidence remains unresolved.'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}});return;
 }
 if(path==='/supported'){json({kinds:[{x402Version:2,scheme:'exact',network:'eip155:5042002'}],extensions:[],signers:{'eip155:*':[reserve]}});return;}
 if(path==='/verify'||path==='/settle'){
  const b=JSON.parse(bytes.toString()),a=b.paymentPayload.payload.authorization;
  if(path==='/verify'){json({isValid:true,payer:a.from});return;}
  let charge=state.charges.find((c:any)=>c.payer===a.from.toLowerCase()&&c.nonce===a.nonce);
  if(!charge){const b=mine();charge={payer:a.from.toLowerCase(),merchant:a.to.toLowerCase(),nonce:a.nonce,hash:'0x'+createHash('sha256').update(a.nonce).digest('hex'),paidAt:Number(BigInt(b.timestamp)),block:state.height};state.charges.push(charge);}
  await boundary('settlement');json({success:true,payer:a.from,transaction:charge.hash,network:'eip155:5042002'});return;
 }
 if(path==='/chain'){
  const b=JSON.parse(bytes.toString()),hash=keccak256(b.raw);
  if(state.deferMining&&!state.transactions[hash]){state.pendingTransactions[hash]??=b;save();await boundary(b.kind+'-submitted');}
  else{includeTransaction(b);await boundary(b.kind+'-included');}
  json({hash});return;
 }
 if(path==='/rpc'){
  const b=JSON.parse(bytes.toString());let result:any=null;
  if(b.method==='eth_chainId')result=hex(5042002);
  else if(b.method==='eth_blockNumber')result=hex(state.height);
  else if(b.method==='eth_getBlockByNumber'||b.method==='eth_getBlockByHash'){
   result=b.method==='eth_getBlockByHash'?Object.values(state.blocks).find((v:any)=>v.hash===b.params[0]):state.blocks[b.params[0]==='latest'?state.height:Number(BigInt(b.params[0]))];
   if(state.orphan&&b.method==='eth_getBlockByNumber'&&result)result={...result,hash:'0x'+'ff'.repeat(32)};
  }else if(b.method==='eth_getLogs')result=state.charges.flatMap((c:any)=>paymentReceipt(c).logs).filter((l:any)=>Number(BigInt(l.blockNumber))>=Number(BigInt(b.params[0].fromBlock))&&Number(BigInt(l.blockNumber))<=Number(BigInt(b.params[0].toBlock))&&(!b.params[0].topics||b.params[0].topics.every((t:any,i:number)=>!t||t.toLowerCase()===l.topics[i].toLowerCase())));
  else if(b.method==='eth_getTransactionReceipt'){
   await boundary('receipt-read');
   if(state.unknown){json({jsonrpc:'2.0',id:b.id,error:{code:-32000,message:'Controlled unavailable RPC'}});return;}
   if(!state.hideReceipts)result=state.transactions[b.params[0]]?.receipt??(state.charges.find((c:any)=>c.hash===b.params[0])?paymentReceipt(state.charges.find((c:any)=>c.hash===b.params[0])):null);
  }else if(b.method==='eth_call'){
   const data=b.params[0].data,selector=data.slice(0,10),snapshot=state.snapshots[b.params[1]==='latest'||!b.params[1]?state.height:Number(BigInt(b.params[1]))];
   if(selector===toFunctionSelector('entitlements(bytes32)')){const chain='0x'+data.slice(10),entry=snapshot.payers.find((t:any)=>t.chain_order_id===chain) as any;result=encodeAbiParameters([{type:'address'},{type:'uint256'},{type:'bool'}],[entry?entry.payer:'0x'+'00'.repeat(20),entry?BigInt(1000000):BigInt(0),snapshot.refunds.includes(chain)]);}
   else result=encodeAbiParameters([{type:'uint256'}],[BigInt(selector===toFunctionSelector('balanceOf(address)')?snapshot.balance:selector===toFunctionSelector('remainingDailyAllowance()')?snapshot.allowance:selector===toFunctionSelector('decimals()')?6:0)]);
  }else {json({jsonrpc:'2.0',id:b.id,error:{code:-32601,message:'Unsupported controlled RPC method'}});return;}
  json({jsonrpc:'2.0',id:b.id,result});return;
 }
 // S3 signs every application request; unauthenticated object URLs are private.
 const authenticated=!!req.headers.authorization||url.searchParams.has('X-Amz-Signature');
 if(!authenticated){res.writeHead(403);res.end();return;}
 if(req.method==='PUT'){
  if(req.headers['if-none-match']==='*'&&state.objects[path]){res.writeHead(412);res.end();return;}
  state.objects[path]={bytes:bytes.toString('base64'),at:new Date().toISOString()};await boundary(path.endsWith('.txt')?'output-put':'input-put');res.end();return;
 }
 if(req.method==='DELETE'){delete state.objects[path];await boundary('delete');res.writeHead(204);res.end();return;}
 const value=state.objects[path];if(!value){res.writeHead(404,{'Content-Type':'application/xml'});res.end('<Error><Code>NoSuchKey</Code></Error>');return;}
 await boundary(path.endsWith('.txt')?'output-read':'input-read');
 const contents=Buffer.from(value.bytes,'base64');res.writeHead(200,{'Content-Length':contents.length,'Last-Modified':new Date(value.at).toUTCString(),ETag:'"controlled"'});res.end(req.method==='HEAD'?undefined:contents);
 }catch{res.writeHead(500);res.end('{}');}});
server.listen(Number(process.env.RECOVERY_EFFECT_PORT||0),'127.0.0.1',()=>console.log('READY:'+((server.address() as {port:number}).port)));
