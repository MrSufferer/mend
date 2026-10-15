import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import {createServer} from 'node:http';
import {neon} from '@neondatabase/serverless';
import {drizzle} from 'drizzle-orm/neon-http';
import * as schema from '../lib/server/schema';
import {createAgentService} from '../backend/agent';
import {createRegistrarService} from '../backend/registrar';
import {refundFixture,role} from './refund-fixture';
for(const args of [{},{orderId:'caller-chosen',payer:'caller-chosen',amountAtomic:'999999999'}])test(`actual SDK request_refund accepts only bounded invocation input: ${Object.keys(args).length?'reject facts':'derive order'}`,async()=>{
 const f=await refundFixture(),prior={...process.env};let dispatches=0,n=0;
 const load=(role:string)=>parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/${role}.env`,'utf8')).DATABASE_URL_UNPOOLED;
 const secret='controlled-agent-registrar-binding-only'.repeat(2);
 const registrar=createRegistrarService({database:()=>drizzle(neon(load('database-registrar')),{schema}),submit:async()=>{throw Error('must not sign without canonical payment');}});
 const server=createServer(async(req,res)=>{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const response=await registrar.fetch(new Request('http://registrar'+req.url,{method:req.method,headers:req.headers as Record<string,string>,body:Buffer.concat(chunks)}));res.writeHead(response.status);res.end(await response.text());});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address() as {port:number};
 Object.assign(process.env,{DATABASE_URL:load('database-worker'),OPENROUTER_API_KEY:'controlled',AGENT_SERVICE_SECRET:secret,AGENT_REGISTRAR_SECRET:secret,AGENT_REGISTRAR_URL:`http://127.0.0.1:${address.port}`});
 try{
  await f.owner.query('UPDATE recovery_cases SET calls_used=0 WHERE order_id=$1',[f.id]);
  const agent=createAgentService({maxSteps:2,conversionFetch:async(input,init)=>{dispatches++;const body=JSON.parse(String(init?.body));expect(Object.keys(body)).toEqual(['invocationId']);expect(body.invocationId).toMatch(/^[0-9a-f-]{36}$/);return fetch(input,init);},modelFetch:async()=>Response.json({id:'controlled-'+n++,created:1,model:'nvidia/nemotron-3.5-lightning:free',object:'chat.completion',choices:[{index:0,finish_reason:n===1?'tool_calls':'stop',message:n===1?{role:'assistant',content:null,tool_calls:[{id:'refund-tool',type:'function',function:{name:'request_refund',arguments:JSON.stringify(args)}}]}:{role:'assistant',content:'Refund has not been confirmed.'}}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}})});
  const response=await agent.fetch(new Request('http://agent/investigate',{method:'POST',headers:{Authorization:`Bearer ${secret}`},body:JSON.stringify({orderId:f.id})}));expect(response.status).toBe(200);
  const result=await response.json();expect(dispatches).toBe(Object.keys(args).length?0:1);
  if(!Object.keys(args).length){expect(result.actions[0].tool).toBe('request_refund');expect(result.actions[0].evidence).toEqual({status:'unresolved',reason:'payment_unknown'});}
  expect((await role('migration').query('SELECT count(*)::int AS n FROM refunds WHERE order_id=$1',[f.id]))[0].n).toBe(0);
 }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));for(const key of Object.keys(process.env))if(!(key in prior))delete process.env[key];Object.assign(process.env,prior);await f.cleanup();}
});
