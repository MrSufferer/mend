// External transport fault: forward a real Arcus settlement, discard its response.
import {createServer} from 'node:http';import {spawn} from 'node:child_process';
let settlements=0;const transactions=new Set();
const proxy=createServer(async(req,res)=>{
 try {const chunks=[];for await(const chunk of req)chunks.push(chunk);const upstream=await fetch(new URL(req.url,'https://facilitator.arcusnetwork.co'),{method:req.method,headers:{'Content-Type':'application/json'},...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})});const text=await upstream.text();
  if(req.url==='/settle'&&upstream.ok) {const result=JSON.parse(text);if(result.success&&result.transaction){settlements++;transactions.add(result.transaction);res.destroy();return;}}
  res.writeHead(upstream.status,{'Content-Type':'application/json'});res.end(text);
 }catch{res.writeHead(503);res.end('{}');}
});
proxy.listen(3114,'127.0.0.1',()=>{
 const child=spawn('npx',['playwright','test','tests/payments.spec.ts','-g','real Arcus'],{stdio:'inherit',env:{...process.env,X402_FACILITATOR_URL:'http://127.0.0.1:3114',PAYMENT_TEST_STATE_FILE:process.env.PAYMENT_TEST_STATE_FILE||'/private/tmp/mend-ticket4-response-loss.json'}});
 child.on('exit',code=>{console.log(JSON.stringify({realSettlementsWhoseResponsesWereDropped:settlements,transactions:[...transactions]}));proxy.close();process.exitCode=code??1;});
});
