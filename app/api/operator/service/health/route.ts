import {startHealth} from '../../../../../lib/server/health';
import {handle,json} from '../../../../../lib/server/http';
export const runtime='nodejs';
export const maxDuration=30;
export async function POST(request:Request){return handle(async()=>json(await startHealth(request)));}
