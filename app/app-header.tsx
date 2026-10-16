'use client';
import Link from 'next/link';
import {Moon,ShieldCheck,Sun} from 'lucide-react';
import {useEffect,useState} from 'react';
import {useWallet} from '../lib/client/wallet';
type Destination='overview'|'convert'|'orders'|'recovery';
export default function AppHeader({current}:{current:Destination}){
 const wallet=useWallet(),[dark,setDark]=useState(false);
 useEffect(()=>{setDark(document.documentElement.classList.contains('dark'));},[]);
 function theme(){document.documentElement.classList.toggle('dark',!dark);setDark(!dark);}
 return <><a href="#main" className="skip">Skip to content</a><header className="app-header"><Link href="/" className="wordmark" aria-label="Mend home"><ShieldCheck aria-hidden="true" size={24}/>mend<span className="environment">ARC TESTNET</span></Link><nav aria-label="Main navigation">{([['overview','/','Overview'],['convert','/convert','Convert'],['orders','/orders','My orders'],['recovery','/recovery','Recovery desk']] as const).map(([id,href,label])=><Link key={id} href={href} aria-current={current===id?'page':undefined}>{label}</Link>)}</nav><div className="header-actions">{wallet.authenticated?<><span className="identity mono" title={wallet.address}>{wallet.address?.slice(0,6)}…{wallet.address?.slice(-4)}</span><button className="secondary" disabled={wallet.busy} onClick={()=>void wallet.signOut()}>Sign out</button></>:null}<button className="theme-button" onClick={theme} aria-label={dark?'Use light theme':'Use dark theme'}>{dark?<Sun size={18} aria-hidden="true"/>:<Moon size={18} aria-hidden="true"/>}</button></div></header></>;
}
