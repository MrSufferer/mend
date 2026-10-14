// Owned local-server restart acceptance. All database/storage fixture state is cleaned.
import {spawn} from 'node:child_process';
import {readFileSync,openSync,closeSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {request,expect} from '@playwright/test';
import {privateKeyToAccount} from 'viem/accounts';
import {operatorFixture} from '../tests/operator-fixture';
if(!process.env.OPERATOR_WEB_ENV)throw Error('Explicit private web environment file required');
const port=3035,origin=`http://127.0.0.1:${port}`,account=privateKeyToAccount(`0x${'44'.repeat(32)}`);
const service=parseEnv(readFileSync('/private/tmp/mend-conversion6-service.env','utf8'));
const env:NodeJS.ProcessEnv={...process.env,...parseEnv(readFileSync(process.env.OPERATOR_WEB_ENV,'utf8')),APP_ORIGIN:origin,OPERATOR_CONVERSION_URL:service.CONVERSION_FUNCTION_URL,OPERATOR_CONVERSION_SECRET:service.OPERATOR_CONVERSION_SECRET};
delete env.CONVERSION_FUNCTION_URL;delete env.CONVERSION_SERVICE_SECRET;
let child:ReturnType<typeof spawn>|undefined;
async function start(){
 const log=openSync('/private/tmp/mend-ticket9-restart-web.log','w',0o600);
 child=spawn(process.execPath,['node_modules/next/dist/bin/next','dev','--webpack','--hostname','127.0.0.1','--port',String(port)],{env,stdio:['ignore',log,log],detached:true});closeSync(log);
 for(let i=0;i<45;i++){if(child.exitCode!==null)throw Error('Owned server exited');try{const ready=await fetch(origin+'/api/auth/session');if(ready.status===401)return;}catch{}await new Promise(resolve=>setTimeout(resolve,1000));}throw Error('Owned server unavailable');
}
async function stop(){if(!child?.pid)return;const done=new Promise(resolve=>child!.once('exit',resolve));process.kill(-child.pid,'SIGTERM');await done;child=undefined;}
async function main(){
const fixture=await operatorFixture();const client=await request.newContext({baseURL:origin});
try{
 await start();const challenge=await(await client.post('/api/auth/challenge',{headers:{Origin:origin},data:{address:account.address,chainId:5042002}})).json();expect((await client.post('/api/auth/verify',{headers:{Origin:origin},data:{...challenge,signature:await account.signMessage({message:challenge.message})}})).status()).toBe(200);
 const check=await(await client.post(`/api/operator/orders/${fixture.id}/actions`,{headers:{Origin:origin},data:{action:'check'}})).json();expect(check.operatorRequest.outcome).toBe('checked');expect(check.case.callsUsed).toBe(12);
 await stop();await start();
 const fresh=await(await client.get(`/api/operator/orders/${fixture.id}/recovery`)).json();expect(fresh.case.callsUsed).toBe(12);expect(fresh.operatorRequests.some((r:{id:string;outcome:string})=>r.id===check.operatorRequest.id&&r.outcome==='checked')).toBe(true);
 const exhausted=await(await client.post(`/api/operator/orders/${fixture.id}/investigate`,{headers:{Origin:origin}})).json();expect(exhausted.operatorRequest.outcomeEvidence.reason).toBe('budget_exhausted');expect(exhausted.case.callsUsed).toBe(12);
 console.log(JSON.stringify({fixture:'copied receipt, exhausted budget',webProcessRestart:true,durableCheckAudit:true,callsUsedBefore:12,callsUsedAfter:12,investigation:'budget_exhausted',newPayments:0,newModelCalls:0}));
}finally{await stop();await client.dispose();await fixture.cleanup();}

}
void main().catch(error=>{console.error(error instanceof Error?error.message:String(error));process.exitCode=1;});
