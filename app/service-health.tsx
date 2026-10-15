'use client';
import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,RequestError,useWallet} from '../lib/client/wallet';
type Health={id:string;status:string;purpose:string;sourceId:string|null;startedAt:string;finishedAt:string|null;expiresAt:string;diagnostic:string|null;components:Record<string,{status:string;passedAt:string|null}>};
const names:Record<string,string>={validation:'PDF validation',parser:'Parser execution',storage:'Private storage write and readback',payment:'Payment availability',capacity:'Aggregate refund capacity',retrieval:'Authenticated result retrieval'};
const labels:Record<string,string>={passed:'Passed',failed:'Failed',unknown:'Unknown',not_run:'Not run',pending:'Pending',running:'Running',stale:'Stale'};
/** Mounted with the authenticated identity as its key, so private evidence cannot survive account changes. */
export default function ServiceHealth({paused}:{paused:boolean}){
 const wallet=useWallet(),cache=useQueryClient(),session=wallet.session;
 const [run,setRun]=useState<Health|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const alive=useRef(true);useEffect(()=>{alive.current=true;return()=>{alive.current=false;};},[]);
 const query=useQuery({queryKey:['private',session?.wallet,session?.expiresAt,'health',run?.id],enabled:!!run,refetchInterval:run?5000:false,queryFn:({signal})=>api<Health>(`/api/operator/service/health/${run!.id}`,{signal}),initialData:run??undefined});
 const current=query.data??run;
 useEffect(()=>{if(query.error instanceof RequestError&&query.error.status===401)wallet.reset();},[query.error,wallet.reset]);
 async function retrieve(h:Health){
  if(h.status!=='running'||h.components.storage.status!=='passed')return h;
  const response=await fetch(`/api/operator/service/health/${h.id}/result`,{cache:'no-store'});
  if(!response.ok)throw new RequestError(response.status,'health_retrieval_failed','Private result retrieval could not be verified. Run another check.');
  // Consume the actual authenticated response, then ask the server for durable proof.
  await response.text();return api<Health>(`/api/operator/service/health/${h.id}`);
 }
 async function runHealthCheck(purpose:'check'|'resume_recheck'){
  const resume=purpose==='resume_recheck';
  if(busy)return;setBusy(true);setMessage(resume?'Repeating the document, payment and capacity checks before resuming…':'Checking the real document and payment paths…');
  try{
   const source=current?.id;
   const h=await api<Health>(resume?'/api/operator/service/resume':'/api/operator/service/health',{method:'POST',body:JSON.stringify(resume?{healthId:source}:{})});
   if(!alive.current)return;setRun(h);cache.setQueryData(['private',session?.wallet,session?.expiresAt,'health',h.id],h);
   const verified=await retrieve(h);if(!alive.current)return;setRun(verified);cache.setQueryData(['private',session?.wallet,session?.expiresAt,'health',h.id],verified);
   if(resume&&verified.status==='passed'){
    await api('/api/operator/service/resume',{method:'POST',body:JSON.stringify({healthId:source,recheckId:h.id})});
    if(alive.current)setMessage('Fresh checks passed. New purchases resumed.');
   }else if(alive.current)setMessage(verified.status==='passed'?(paused?'All checks passed. Purchases remain paused until you choose Resume new purchases.':'All checks passed. New purchases are already open.'):'Health could not be confirmed. Inspect the component results and retry.');
  }catch(error){if(alive.current){setMessage(error instanceof RequestError?error.message:'Health could not be confirmed. Refresh evidence and retry.');if(error instanceof RequestError&&error.status===401)wallet.reset();}}
  finally{if(alive.current)setBusy(false);await cache.invalidateQueries({queryKey:['private']});}
 }
 return <section className="service-health" aria-labelledby="health-heading"><h3 id="health-heading">Service health</h3>
  <p>A unique test PDF runs through validation, the real parser, private storage and authenticated retrieval. Payment checks inspect current facilitator support and canonical chain state without making a payment.</p>
  <p className="caption">Evidence is current for at most 2 minutes and expires immediately when the pause, failure record or refund backlog changes. Payment availability cannot guarantee a future settlement.</p>
  <div className="health-actions"><button className="secondary" disabled={busy} aria-busy={busy} onClick={()=>void runHealthCheck('check')}>{busy?'Checking service…':current?'Run another health check':'Run health check'}</button>{paused?<button className="primary" disabled={busy||current?.status!=='passed'||!!query.error} aria-busy={busy} onClick={()=>void runHealthCheck('resume_recheck')}>Resume new purchases</button>:null}</div>
  {message?<p role="status">{message}</p>:null}
  {query.error?<><p role="status" className="access-warning">Current health evidence is unknown. {query.error instanceof RequestError?query.error.message:'The status could not load.'}</p><button className="secondary" onClick={()=>void query.refetch()}>Retry health status</button></>:null}
  {current?<><p role="status"><strong>Health: {labels[current.status]??'Unknown'}</strong></p><dl className="evidence-facts capacity-facts"><dt>Check started</dt><dd><time className="mono" dateTime={current.startedAt}>{new Date(current.startedAt).toLocaleString()}</time></dd><dt>Check completed</dt><dd>{current.finishedAt?<time className="mono" dateTime={current.finishedAt}>{new Date(current.finishedAt).toLocaleString()}</time>:'Not completed'}</dd></dl><ul className="health-components">{Object.entries(current.components).map(([key,item])=><li key={key}><strong>{names[key]??key}</strong><span>{labels[item.status]??'Unknown'}{item.passedAt?<>{item.status==='failed'?' · Last passed ':' · '}<time className="mono" dateTime={item.passedAt}>{new Date(item.passedAt).toLocaleTimeString()}</time></>:null}</span></li>)}</ul>{current.diagnostic?<p className="access-warning">{current.diagnostic==='document_failed'?'Document execution or private storage could not be verified.':current.diagnostic==='payment_or_capacity_failed'?'Payment availability or aggregate refund capacity could not be verified.':'The check could not finish. Run another health check.'}</p>:null}</>:<p>No health check has run in this session. A pause stays in effect until a fresh check and a deliberate resume both succeed.</p>}
 </section>;
}
