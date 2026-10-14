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
