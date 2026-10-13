'use client';
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { createConfig, http, useConnect, useConnection, useConnectors, useDisconnect, useSignMessage, useSwitchChain, WagmiProvider } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { defineChain } from 'viem';
export const arc=defineChain({id:5042002,name:'Arc testnet',nativeCurrency:{name:'USDC',symbol:'USDC',decimals:18},rpcUrls:{default:{http:['https://rpc.testnet.arc.network']}},testnet:true});
const config=createConfig({chains:[arc],connectors:[injected()],transports:{[arc.id]:http()},ssr:true});
export type Session={wallet:string;chainId:number;role:'operator'|'customer';expiresAt:string};
export class RequestError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
export async function api<T>(path:string,options?:RequestInit):Promise<T> {
  const response=await fetch(path,{...options,cache:'no-store',headers:{'Content-Type':'application/json',...options?.headers}});
  const data=await response.json();
  if(!response.ok)throw new RequestError(response.status,data.error,data.message);
  return data;
}
type WalletState={session:Session|null;authenticated:boolean;ready:boolean;busy:boolean;message:string;address?:string;chainId?:number;connected:boolean;connect:()=>Promise<void>;signIn:()=>Promise<void>;signOut:()=>Promise<void>;switchNetwork:()=>Promise<void>;reset:()=>void};
const WalletContext=createContext<WalletState|null>(null);
export function useWallet(){const value=useContext(WalletContext);if(!value)throw new Error('Wallet provider missing');return value;}
function AuthProvider({children}:{children:ReactNode}) {
  const connection=useConnection(),connectors=useConnectors(),connect=useConnect(),sign=useSignMessage(),disconnect=useDisconnect(),switchChain=useSwitchChain(),cache=useQueryClient();
  const [session,setSession]=useState<Session|null>(null),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const signing=useRef(false);
  const generation=useRef(0),lastIdentity=useRef<string|null>(null),logoutInFlight=useRef<Promise<unknown>>(Promise.resolve());
  const identity=connection.address?`${connection.address.toLowerCase()}:${connection.chainId}`:'';
  const currentIdentity=useRef(identity);currentIdentity.current=identity;
  const clear=useCallback(()=>{generation.current++;setSession(null);void cache.cancelQueries({queryKey:['private']});cache.removeQueries({queryKey:['private']});},[cache]);
  const revoke=useCallback(()=>{
    clear();
    // Queue revocations so a fresh challenge/sign-in cannot overtake an account reset.
    logoutInFlight.current=logoutInFlight.current.catch(()=>{}).then(()=>api('/api/auth/logout',{method:'POST'}));
    return logoutInFlight.current;
  },[clear]);
  const reportSignOutFailure=useCallback(()=>setMessage('Sign-out could not complete. Retry before signing in.'),[]);
  const load=useCallback(async()=>{
    if(signing.current)return;
    const version=generation.current;
    try {
      const found=await api<Session>('/api/auth/session');
      if(version!==generation.current)return;
      if(currentIdentity.current && currentIdentity.current!==`${found.wallet}:${found.chainId}`){void revoke().catch(reportSignOutFailure);return;}
      setSession(found);
    } catch(error){if(version===generation.current){clear();if(error instanceof RequestError && error.code!=='sign_in_required')setMessage(error.message);}}
    finally {setReady(true);}
  },[clear,revoke,reportSignOutFailure]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    if(connection.status==='connecting'||connection.status==='reconnecting')return;
    if(lastIdentity.current!==null && lastIdentity.current!==identity){setMessage('Wallet changed. Sign in again to access private orders.');void revoke().catch(reportSignOutFailure);}
    lastIdentity.current=identity;
    if(session && `${session.wallet}:${session.chainId}`!==identity){void revoke().catch(reportSignOutFailure);}
  },[identity,connection.status,session,revoke,reportSignOutFailure]);
  useEffect(()=>{
    const focus=()=>void load();
    const channel=new BroadcastChannel('mend-auth');
    channel.onmessage=()=>{clear();void load();};
    window.addEventListener('focus',focus);
    return()=>{channel.close();window.removeEventListener('focus',focus);};
  },[clear,load]);
  useEffect(()=>{
    if(!session)return;
    const timer=setTimeout(()=>{clear();setMessage('Your session expired. Sign in again.');},Math.max(0,new Date(session.expiresAt).getTime()-Date.now()));
    return()=>clearTimeout(timer);
  },[session,clear]);
  const run=async(action:()=>Promise<void>)=>{setBusy(true);setMessage('');try{await action();}catch(error){setMessage(error instanceof RequestError?error.message: /reject|denied/i.test(error instanceof Error?error.message:'')?'Signature or connection rejected. Nothing was paid. Try again when ready.':'The wallet request could not complete. Check your wallet and retry.');}finally{setBusy(false);}};
  const signIn=()=>run(async()=>{
    signing.current=true;
    try {
    if(!connection.address || connection.chainId!==arc.id)throw new Error('Switch to Arc testnet');
    const expected=identity,version=++generation.current;
    await logoutInFlight.current;
    const check=()=>{if(version!==generation.current || currentIdentity.current!==expected)throw new Error('Wallet changed during sign-in');};
    check();
    const challenge=await api<{challengeId:string;message:string}>('/api/auth/challenge',{method:'POST',body:JSON.stringify({address:connection.address,chainId:arc.id})});
    check();
    const signature=await sign.mutateAsync({account:connection.address,message:challenge.message});
    check();
    const found=await api<Session>('/api/auth/verify',{method:'POST',body:JSON.stringify({...challenge,signature})});
    if(version!==generation.current || currentIdentity.current!==expected){await revoke();throw new Error('Wallet changed during sign-in');}
    setSession(found);setReady(true);
    } finally {signing.current=false;}
  });
  const authenticated=ready && !!session && identity===`${session.wallet}:${session.chainId}` && new Date(session.expiresAt).getTime()>Date.now();
  return <WalletContext.Provider value={{session,authenticated,ready,busy,message,address:connection.address,chainId:connection.chainId,connected:connection.isConnected,
    connect:()=>run(async()=>{if(!connectors[0])throw new RequestError(400,'wallet_missing','Install or enable an injected EOA wallet, then reload Mend.');await connect.mutateAsync({connector:connectors[0]});}),signIn,
    signOut:()=>run(async()=>{await revoke();const channel=new BroadcastChannel('mend-auth');channel.postMessage('signed-out');channel.close();await disconnect.mutateAsync();}),
    switchNetwork:()=>run(async()=>{await switchChain.mutateAsync({chainId:arc.id});}),reset:()=>{void revoke().catch(reportSignOutFailure);}}}>{children}</WalletContext.Provider>;
}
export function WalletProviders({children}:{children:ReactNode}) {
  const [query]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:false,staleTime:0,refetchOnWindowFocus:true}}}));
  return <WagmiProvider config={config}><QueryClientProvider client={query}><AuthProvider>{children}</AuthProvider></QueryClientProvider></WagmiProvider>;
}
