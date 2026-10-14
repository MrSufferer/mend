// Neon deployments increase the per-function integer ID. Never report an older active artifact.
export function deploymentId(body,previous){
 const returned=body?.deployment?.id??body?.id??body?.function?.current_deployment?.id;
 if(returned!==undefined){
  if(!Number.isSafeInteger(returned)||returned<=previous)throw Error('Invalid deployment identifier');
  return returned;
 }
 if(!Number.isSafeInteger(previous)||previous<0)throw Error('Deployment identifier missing');
 return previous+1;
}
export async function waitForDeployment(id,read,pause,attempts=60){
 for(let n=0;n<attempts;n++){
  const body=await read(),fn=body.function??body,current=fn.current_deployment;
  if(current?.id>id)throw Error('Deployment superseded; completion unconfirmed');
  if(current?.id===id&&current.status==='failed')throw Error('Deployment failed');
  if(fn.invocation_url&&current?.id===id&&current.status==='completed'&&fn.active_deployment?.id===id&&fn.active_deployment.status==='completed')return fn;
  if(n+1<attempts)await pause();
 }
 throw Error('Completion unconfirmed');
}

// Capture the pre-deploy ID before POST, then verify only that requested artifact.
export async function prepareDeployment(api,headers,fetcher=fetch,pause=()=>new Promise(resolve=>setTimeout(resolve,2000))){
 const read=async()=>{const response=await fetcher(api,{headers});if(!response.ok)throw Error(`Deployment status HTTP ${response.status}`);return response.json();};
 const beforeBody=await read(),previous=(beforeBody.function??beforeBody).current_deployment?.id;
 if(!Number.isSafeInteger(previous)||previous<0)throw Error('Previous deployment identifier missing');
 return async response=>{
  const raw=await response.text();let body;
  if(raw.trim()){try{body=JSON.parse(raw);}catch{throw Error('Invalid deployment response');}}
  const id=deploymentId(body,previous),fn=await waitForDeployment(id,read,pause);
  return {id,fn};
 };
}
