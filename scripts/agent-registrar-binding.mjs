// Private local deployment binding; both services reuse one registrar-only credential.
import {readFile,writeFile} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
export const bindingPath='/private/tmp/mend-agent-registrar13.env';
export async function agentRegistrarBinding(requireUrl=false){
 let binding;try{binding=parseEnv(await readFile(bindingPath,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;binding={};}
 if(!binding.AGENT_REGISTRAR_SECRET){if(requireUrl)throw Error('Deploy registrar binding before agent');binding.AGENT_REGISTRAR_SECRET=randomBytes(32).toString('hex');await saveAgentRegistrarBinding(binding);}
 if(binding.AGENT_REGISTRAR_SECRET.length<32||requireUrl&&!binding.AGENT_REGISTRAR_URL)throw Error('Incomplete agent registrar binding');
 return binding;
}
export async function saveAgentRegistrarBinding(binding){await writeFile(bindingPath,Object.entries(binding).map(([name,value])=>`${name}=${value}`).join('\n')+'\n',{mode:0o600});}
