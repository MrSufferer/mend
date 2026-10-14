import {neonConfig} from '@neondatabase/serverless';

// Backend HTTP queries get a fresh deadline each time; no expiring cached signal.
// A timeout is an unknown observation, never evidence of a stopped transaction.
neonConfig.fetchFunction=(url:RequestInfo|URL,options?:RequestInit)=>fetch(url,{
 ...options,signal:options?.signal?AbortSignal.any([options.signal,AbortSignal.timeout(10000)]):AbortSignal.timeout(10000),
});
