import {x402Client} from '@x402/core/client';
import {ExactEvmScheme} from '@x402/evm/exact/client';
import type {ClientEvmSigner} from '@x402/evm';
import {decodePaymentRequiredHeader,encodePaymentSignatureHeader} from '@x402/core/http';
import type {PaymentRequirements} from '@x402/core/types';
import type {PurchasedTerms} from '../server/terms';
import {api,RequestError} from './wallet';
import {attempts,saveAttempt,type PurchaseAttempt} from './purchase-journal';
export type PurchaseConfig={available:boolean;terms:PurchasedTerms;payment:PaymentRequirements};
export function canonical(value:unknown):string{return JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);}
const token='0x3600000000000000000000000000000000000000';
function validate(requirement:PaymentRequirements,trusted:PaymentRequirements){if(requirement.scheme!=='exact'||requirement.network!=='eip155:5042002'||requirement.asset?.toLowerCase()!==token||requirement.amount!=='1000000'||!/^0x[0-9a-fA-F]{40}$/.test(trusted.payTo)||requirement.payTo?.toLowerCase()!==trusted.payTo.toLowerCase()||requirement.maxTimeoutSeconds!==300||requirement.extra?.name!=='USDC'||requirement.extra?.version!=='2'||requirement.extra?.assetTransferMethod&&requirement.extra.assetTransferMethod!=='eip3009')throw new Error('Payment requirements do not match the trusted merchant, Arc network and exact 1 test USDC price. Payment blocked.');}
export async function prepare(file:File,payer:string,existing:PurchaseAttempt|undefined,check:()=>void){
 if(existing){existing=(await attempts(payer)).find(item=>item.id===existing!.id)??existing;if(existing.orderId||existing.signature)throw new Error('This draft has already progressed in another tab. Continue the saved existing purchase.');}
 if((await attempts(payer)).some(item=>item.signature&&!item.confirmed))throw new Error('An existing payment is unresolved. Check that authorization before starting another purchase.');
 if(!/\.pdf$/i.test(file.name)||file.size<1||file.size>10*1024*1024)throw new Error('Choose a PDF of at most 10 MiB.');
 const sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await file.arrayBuffer())),b=>b.toString(16).padStart(2,'0')).join('');check();
 if(existing&&(existing.sha256!==sha256||existing.size!==file.size))throw new Error('Reselect the original PDF to resume this draft. Its bytes must match.');
 const record=existing??{id:crypto.randomUUID(),payer,capability:Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join(''),sha256,size:file.size,name:file.name};
 await saveAttempt(record);check();return record;
}
export async function submit(record:PurchaseAttempt,file:File,acceptedTerms:PurchasedTerms,check:()=>void){
 const headers={Authorization:`Bearer ${record.capability}`};
 const response=await api<{id:string;order?:{id:string;terms:PurchasedTerms};terms:PurchasedTerms;upload:{url:string;headers:Record<string,string>}}>('/api/submissions',{method:'POST',headers,body:JSON.stringify({idempotencyKey:record.id,size:record.size,sha256:record.sha256})});check();
 record={...record,terms:response.order?.terms??response.terms};await saveAttempt(record);check();
 if(canonical(record.terms)!==canonical(acceptedTerms))throw new Error('The server returned different purchase terms. Review and accept the saved terms before uploading.');
 let order=response.order;
 if(!order){const uploaded=await fetch(response.upload.url,{method:'PUT',headers:response.upload.headers,body:file});check();if(!uploaded.ok)throw new Error('Upload failed. Retry with the same PDF and draft.');order=await api(`/api/submissions/${response.id}/complete`,{method:'POST',headers});check();}
 record={...record,orderId:order!.id,terms:order!.terms};await saveAttempt(record);check();
 await api(`/api/orders/${record.orderId}/claim`,{method:'POST',headers});check();return record;
}
export async function pay(record:PurchaseAttempt,trusted:PurchaseConfig|undefined,signer:ClientEvmSigner,check:()=>void,onSaved:(record:PurchaseAttempt)=>void){
 // Reload inside the cross-tab lock; a stale tab must never create a replacement.
 record=(await attempts(record.payer)).find(item=>item.id===record.id)!;check();if(!record?.orderId)throw new Error('Validate the PDF before payment.');
 const path=`/api/orders/${record.orderId}/payment`,headers={Authorization:`Bearer ${record.capability}`};
 if(!record.signature){
  if((await attempts(record.payer)).some(item=>item.id!==record.id&&item.signature&&!item.confirmed))throw new Error('An existing payment is unresolved. Check that authorization before approving another purchase.');check();
  if(!trusted)throw new Error('Trusted sale configuration is unavailable. New payment is blocked.');
  if(signer.address.toLowerCase()!==record.payer)throw new Error('Sign in and pay with the original payer wallet.');
  const config=await api<PurchaseConfig>('/api/purchase/config');check();if(!config.available)throw new Error('New purchases are paused. Existing payments remain recoverable.');validate(config.payment,trusted.payment);
  const response=await fetch(path,{method:'POST',headers});check();if(response.status!==402)throw new Error('Could not obtain a new payment challenge. Check My orders before continuing.');
  const raw=response.headers.get('PAYMENT-REQUIRED');if(!raw)throw new Error('Missing payment challenge.');const required=decodePaymentRequiredHeader(raw);
  if(required.x402Version!==2||required.accepts.length!==1||required.resource?.url!==new URL(path,location.origin).href)throw new Error('Unsupported payment challenge.');validate(required.accepts[0],config.payment);
  const payload=await new x402Client().register('eip155:5042002',new ExactEvmScheme(signer)).createPaymentPayload(required);check();
  record={...record,signature:encodePaymentSignatureHeader(payload)};await saveAttempt(record);onSaved(record);check();
 }
 const response=await fetch(path,{method:'POST',headers:{...headers,'PAYMENT-SIGNATURE':record.signature!}});check();
 const body=await response.json();if(![200,202].includes(response.status))throw new RequestError(response.status,body.error,`${body.message} Keep this attempt; do not approve another payment.`);
 record={...record,confirmed:response.status===200};await saveAttempt(record);onSaved(record);check();return record;
}
