import {healthStatus} from '../../../../../../lib/server/health';
import {handle,json} from '../../../../../../lib/server/http';
export const runtime='nodejs';
export async function GET(_request:Request,{params}:{params:Promise<{id:string}>}){return handle(async()=>json(await healthStatus((await params).id)));}
