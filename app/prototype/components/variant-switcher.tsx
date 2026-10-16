'use client';
import { useEffect, useCallback } from 'react';
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
import { ArrowLeft, ArrowRight } from 'lucide-react';
export const variants = [{key:'A',name:'Inline checkout'},{key:'B',name:'Guided purchase'},{key:'C',name:'Side-by-side'}];
export default function VariantSwitcher({current}:{current:string}) {
  const router=useRouter(),params=useSearchParams(),pathname=usePathname();
  const cycle=useCallback((direction:number)=>{const i=variants.findIndex(v=>v.key===current),query=new URLSearchParams(params.toString());query.set('variant',variants[(i+direction+3)%3].key);router.replace(`${pathname}?${query}`,{scroll:false});},[current,params,pathname,router]);
  useEffect(()=>{const key=(event:KeyboardEvent)=>{if(event.altKey||event.ctrlKey||event.metaKey||document.querySelector('dialog[open]'))return;if((event.target as HTMLElement).closest('input,textarea,select,button,a,[contenteditable="true"],[role="slider"]'))return;if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();cycle(event.key==='ArrowLeft'?-1:1);}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[cycle]);
  if(process.env.NODE_ENV==='production')return null;
  return <nav className="purchase-switcher" aria-label="Prototype variants"><button aria-label="Previous variant" onClick={()=>cycle(-1)}><ArrowLeft size={17}/></button><div><small>DESIGN EXPLORATION · {current} / C</small><strong>{current} · {variants.find(v=>v.key===current)?.name}</strong></div><button aria-label="Next variant" onClick={()=>cycle(1)}><ArrowRight size={17}/></button></nav>;
}
