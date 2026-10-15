import {Worker} from 'node:worker_threads';
/** Observe the real parser's exit before publishing output; a timeout terminates it. */
export async function runPdfWorker(bytes:Uint8Array,deadline:number,control:{worker?:Worker;stopReason?:string},stop:(reason:string)=>void,holdMs=0){
 const worker=new Worker(new URL('./parser.mjs',import.meta.url),{workerData:{bytes,holdMs},env:{},resourceLimits:{maxOldGenerationSizeMb:256}});control.worker=worker;
 let value:{text?:string;error?:string}|undefined,reason='completed';
 const exit=new Promise<number>(resolve=>worker.once('exit',resolve));
 worker.on('message',message=>{value=message;});worker.on('error',()=>{reason='parser_error';});
 const timer=setTimeout(()=>stop('deadline'),Math.max(1,deadline-Date.now()));
 if(control.stopReason)void worker.terminate();
 const code=await exit;clearTimeout(timer);control.worker=undefined;reason=control.stopReason??reason;
 return {code,reason,text:code===0&&reason==='completed'&&!value?.error?value?.text:undefined};
}
