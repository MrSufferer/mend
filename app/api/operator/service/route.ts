import {operatorAvailability,operatorPause} from '../../../../lib/server/availability';
import {handle,json} from '../../../../lib/server/http';
export const runtime='nodejs';
export async function GET(){return handle(async()=>json(await operatorAvailability()));}
export async function POST(request:Request){return handle(async()=>json(await operatorPause(request)));}
