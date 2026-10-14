import {test,expect} from '@playwright/test';
import {createServer,type Server} from 'node:http';
import registrar from '../backend/registrar';
import refund from '../backend/refund';
test('isolated HTTP boundaries reject missing authority and caller supplied refund facts',async()=>{
 const secret='owned-http-fixture-secret-'.repeat(3),old={...process.env};
 Object.assign(process.env,{REGISTRAR_SERVICE_SECRET:secret,REFUND_SERVICE_SECRET:secret,REGISTRAR_CONVERSION_SECRET:secret});
 let server:Server|undefined;
 try{
  server=createServer(async(req,res)=>{try{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(chunk);const url=new URL(req.url!,'http://127.0.0.1:3036');const service=url.pathname.startsWith('/registrar/')?registrar:refund;url.pathname=url.pathname.replace(/^\/(registrar|refund|conversion)/,'');const response=await service.fetch(new Request(url,{method:req.method,headers:req.headers as Record<string,string>,body:Buffer.concat(chunks).length?Buffer.concat(chunks):undefined}));res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());}catch{res.writeHead(500);res.end();}});
  await new Promise<void>(resolve=>server!.listen(3036,'127.0.0.1',resolve));
  for(const path of ['/registrar/register','/refund/reconcile']){
   const denied=await fetch(`http://127.0.0.1:3036${path}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({orderId:'70416aef-c250-46de-aa30-cd5be751f9f2'})});expect(denied.status).toBe(401);
   const malformed=await fetch(`http://127.0.0.1:3036${path}`,{method:'POST',headers:{Authorization:`Bearer ${'é'.repeat(secret.length)}`}});expect(malformed.status).toBe(401);
   const narrative=await fetch(`http://127.0.0.1:3036${path}`,{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify({orderId:'70416aef-c250-46de-aa30-cd5be751f9f2',payer:'0xattacker',amount:'1',confirmed:true})});expect([400,503]).toContain(narrative.status);expect(await narrative.text()).not.toMatch(/refunded|registered/);
  }
 }finally{if(server)await new Promise<void>(resolve=>server!.close(()=>resolve()));for(const key of Object.keys(process.env))if(!(key in old))delete process.env[key];Object.assign(process.env,old);}
});
