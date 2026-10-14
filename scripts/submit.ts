import { randomBytes, randomUUID, createHash } from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {maxUploadBytes} from '../lib/server/storage';
type State={capability:string,idempotencyKey:string,sha256:string,size:number,orderId?:string};
async function main() {
  const [origin,file,stateFile='.mend-submission.json']=process.argv.slice(2);
  if (!origin || !file) throw new Error('Usage: npm run submit -- https://app.example document.pdf [private-state.json]');
  const base=new URL(origin); if (base.protocol!=='https:' && !['127.0.0.1','localhost'].includes(base.hostname)) throw new Error('Use HTTPS outside localhost.');
  const bytes=await readFile(resolve(file)); if(bytes.length>maxUploadBytes) throw new Error('PDF exceeds 10 MB.');
  const sha256=createHash('sha256').update(bytes).digest('hex');
  let state:State;
  try {state=JSON.parse(await readFile(stateFile,'utf8'));}
  catch(error) {
    if ((error as NodeJS.ErrnoException).code!=='ENOENT') throw error;
    state={capability:randomBytes(32).toString('hex'),idempotencyKey:randomUUID(),sha256,size:bytes.length};
    await writeFile(stateFile,JSON.stringify(state)+'\n',{mode:0o600,flag:'wx'});
  }
  if(state.sha256!==sha256 || state.size!==bytes.length) throw new Error('This private recovery state belongs to a different document. Use a new state file.');
  const headers={Authorization:`Bearer ${state.capability}`,'Content-Type':'application/json'};
  async function api(path:string,init:RequestInit={}) {
    const response=await fetch(new URL(path,base),{...init,headers});
    const body=await response.json(); if(!response.ok) throw new Error(`${body.error}: ${body.message}`); return body;
  }
  const submission=await api('/api/submissions',{method:'POST',body:JSON.stringify({idempotencyKey:state.idempotencyKey,size:state.size,sha256})});
  let order=submission.order;
  if(!order) {
    console.log(JSON.stringify({disclosedBeforePurchase:submission.terms},null,2));
    const uploaded=await fetch(submission.upload.url,{method:'PUT',headers:submission.upload.headers,body:bytes});
    if(!uploaded.ok) throw new Error('Private upload failed. Rerun with the same state file.');
    order=await api(`/api/submissions/${submission.id}/complete`,{method:'POST'});
  }
  state.orderId=order.id; await writeFile(stateFile,JSON.stringify(state)+'\n',{mode:0o600});
  console.log(JSON.stringify({order,recoveryState:resolve(stateFile),next:'Run npm run purchase with this origin and private state file to pay 1 test USDC.'},null,2));
}
main().catch(error=>{console.error(error instanceof Error?error.message:'Submission failed');process.exitCode=1;});
