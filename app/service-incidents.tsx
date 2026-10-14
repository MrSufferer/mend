'use client';
import {useEffect,useState,type FormEvent} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {api,RequestError,useWallet} from '../lib/client/wallet';
type Incident={id:string;actorKind:string;actor:string;reason:string;evidence:{attemptIds:string[];orderIds:string[]};createdAt:string};
type Availability={availability:{paused:boolean;generation:number;pausedAt:string|null};incidents:Incident[]};
export default function ServiceIncidents(){
 const wallet=useWallet(),cache=useQueryClient(),session=wallet.session;
 const enabled=wallet.authenticated&&session?.role==='operator';
 const [busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const state=useQuery({queryKey:['private',session?.wallet,session?.expiresAt,'service'],enabled,refetchInterval:enabled?5000:false,queryFn:({signal})=>api<Availability>('/api/operator/service',{signal})});
 useEffect(()=>{if(state.error instanceof RequestError&&state.error.status===401)wallet.reset();},[state.error,wallet.reset]);
 async function pause(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const reason=new FormData(event.currentTarget).get('reason');setBusy(true);setMessage('');
  try{await api('/api/operator/service',{method:'POST',body:JSON.stringify({reason})});setMessage('New purchases paused. Existing paid orders continue.');}
  catch(error){setMessage(error instanceof RequestError?error.message:'Pause could not be confirmed. Refresh service evidence before retrying.');}
  finally{setBusy(false);await cache.invalidateQueries({queryKey:['private']});}
 }
 if(!enabled)return null;
 return <section className="panel service-incidents" aria-labelledby="service-heading"><h2 id="service-heading">Service availability</h2>
  {state.isPending?<p role="status">Loading service evidence…</p>:state.error?<><p role="status" className="access-warning">{state.error instanceof RequestError?state.error.message:'Service evidence could not load.'}</p><button className="secondary" onClick={()=>void state.refetch()}>Retry service evidence</button></>:<>
   <p role="status"><strong>{state.data?.availability.paused?'New purchases paused':'Accepting new purchases'}</strong></p>
   <p>Payment reconciliation, conversion and recovery for existing paid orders continue. Purchased terms, the original payer and delivery deadlines remain binding.</p>
   {!state.data?.availability.paused?<form onSubmit={pause}><label htmlFor="pause-reason">Processing incident reason</label><textarea id="pause-reason" name="reason" required minLength={3} maxLength={240} rows={2} autoComplete="off" aria-describedby="pause-help"/><p id="pause-help" className="caption">Record the processing issue. Keep document contents and credentials out of this private incident record.</p><button className="primary" disabled={busy} aria-busy={busy}>{busy?'Pausing purchases…':'Pause new purchases'}</button></form>:<p className="caption">A pause remains in effect until a verified recovery decision authorizes resuming purchases.</p>}
   {message?<p role="status" className="access-warning">{message}</p>:null}
   <h3>Processing incidents</h3>{state.data?.incidents.length?<ol className="incident-history">{state.data.incidents.map(incident=><li key={incident.id}><p><strong>{incident.reason}</strong></p><p>{incident.actorKind==='deterministic'?'Failure threshold':incident.actorKind==='agent'?'Recovery agent':'Operator'} · <time dateTime={incident.createdAt}>{new Date(incident.createdAt).toLocaleString()}</time></p><details><summary>Inspect actor and affected orders</summary><p className="mono">Actor: {incident.actor}</p>{incident.evidence.orderIds.length?<ul>{incident.evidence.orderIds.map(id=><li className="mono" key={id}>{id}</li>)}</ul>:<p>No affected orders were recorded.</p>}<p className="caption">Confirmed failure attempts: {incident.evidence.attemptIds.length.toLocaleString('en-US')}</p></details></li>)}</ol>:<p>No processing incidents have been recorded.</p>}
  </>}
 </section>;
}
