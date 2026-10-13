import { claimOrder } from '../../../../../lib/server/orders';
import { handle,json } from '../../../../../lib/server/http';
export const runtime='nodejs';
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {return handle(async()=>json(await claimOrder(request,(await params).id)));}
