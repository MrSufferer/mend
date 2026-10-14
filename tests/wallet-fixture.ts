import {type Page} from '@playwright/test';
import {privateKeyToAccount} from 'viem/accounts';
import {hexToBytes,type Hex} from 'viem';
const accounts=['11','22','44'].map(value=>privateKeyToAccount(`0x${value.repeat(32)}`));
export async function wallet(page:Page,index=0,chainId=5042002) {
  await page.exposeFunction('signWalletMessage',async(address:string,message:Hex)=>{
    const account=accounts.find(a=>a.address.toLowerCase()===address.toLowerCase());
    if(!account) throw new Error('Unknown synthetic signer');
    return account.signMessage({message:{raw:hexToBytes(message)}});
  });
  await page.addInitScript(({addresses,index,chainId})=>{
    type Callback=(value:unknown)=>void;
    const listeners=new Map<string,Set<Callback>>();
    let selected=index,chain=chainId,connected=false,reject=false,hold=false,release:(()=>void)|undefined;
    const emit=(event:string,value:unknown)=>listeners.get(event)?.forEach(fn=>fn(value));
    const provider={isMetaMask:true,on(event:string,fn:Callback){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event)!.add(fn);},removeListener(event:string,fn:Callback){listeners.get(event)?.delete(fn);},async request({method,params}:{method:string,params?:unknown[]}) {
      if(method==='eth_chainId')return '0x'+chain.toString(16);
      if(method==='eth_requestAccounts'){connected=true;return[addresses[selected]];}
      if(method==='eth_accounts')return connected?[addresses[selected]]:[];
      if(method==='wallet_switchEthereumChain'){chain=parseInt((params![0] as {chainId:string}).chainId,16);emit('chainChanged','0x'+chain.toString(16));return null;}
      if(method==='wallet_requestPermissions')return[{parentCapability:'eth_accounts'}];
      if(method==='wallet_getPermissions')return connected?[{parentCapability:'eth_accounts'}]:[];
      if(method==='personal_sign'){
        if(reject){reject=false;throw Object.assign(new Error('User rejected signature'),{code:4001});}
        const [message,address]=params as [string,string];
        if(hold)await new Promise<void>(resolve=>{release=resolve;});
        return (window as unknown as {signWalletMessage:(a:string,m:string)=>Promise<string>}).signWalletMessage(address,message);
      }
      throw Object.assign(new Error('Unsupported synthetic wallet method '+method),{code:-32601});
    }};
    Object.assign(window,{ethereum:provider,__wallet:{get waiting(){return !!release;},switch(index:number){selected=index;emit('accountsChanged',[addresses[selected]]);},reject(){reject=true;},hold(){hold=true;},release(){hold=false;release?.();release=undefined;},chain(id:number){chain=id;emit('chainChanged','0x'+id.toString(16));}}});
  },{addresses:accounts.map(a=>a.address),index,chainId});
}
