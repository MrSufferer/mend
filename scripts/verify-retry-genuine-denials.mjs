// Read-only canonical comparison plus trusted service denial; no payment/model call.
import{readFileSync,writeFileSync}from'node:fs';import{parseEnv}from'node:util';import{randomUUID}from'node:crypto';import{neon}from'@neondatabase/serverless';
const dir=process.env.PROVISIONING_ENV_DIR;if(!dir)throw Error('Explicit provisioning directory required');const owner=neon(parseEnv(readFileSync(dir+'/migration.env','utf8')).DATABASE_URL_UNPOOLED),worker=neon(parseEnv(readFileSync(dir+'/database-worker.env','utf8')).DATABASE_URL_UNPOOLED),service=parseEnv(readFileSync('/private/tmp/mend-conversion6-service.env','utf8'));
const results=[];
for(const [kind,id]of [['unknown','72557542-5b7b-4082-b6ae-6e306ee13980'],['expired','70416aef-c250-46de-aa30-cd5be751f9f2']]){
 const before=await owner.query('SELECT generation,state,publisher_finished_at FROM execution_attempts WHERE order_id=$1 ORDER BY generation',[id]),inv=randomUUID();
 const [{started}]=await worker.query('SELECT mend_agent_begin($1::uuid,$2::uuid) AS started',[id,inv]);if(started.error)throw Error('Existing investigation: '+started.error);
 try{const r=await fetch(service.CONVERSION_FUNCTION_URL+'agent/retry',{method:'POST',headers:{Authorization:'Bearer '+service.AGENT_CONVERSION_SECRET,'Content-Type':'application/json'},body:JSON.stringify({invocationId:inv})}),result=await r.json();const after=await owner.query('SELECT generation,state,publisher_finished_at FROM execution_attempts WHERE order_id=$1 ORDER BY generation',[id]);results.push({kind,orderId:id,http:r.status,result,attemptsUnchanged:JSON.stringify(before)===JSON.stringify(after),generations:after.map(a=>a.generation)});}finally{await worker.query('SELECT mend_agent_finish($1::uuid,$2)',[inv,'trusted_retry_denied']);}
}
writeFileSync('/private/tmp/mend-ticket8-genuine-denials.json',JSON.stringify(results,null,2));console.log(JSON.stringify(results));
