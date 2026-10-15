import {healthResult} from '../../../../../../../lib/server/health';
import {handle} from '../../../../../../../lib/server/http';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){return handle(()=>params.then(p=>healthResult(p.id)));}
