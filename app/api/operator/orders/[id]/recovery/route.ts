import { operatorRecovery } from '../../../../../../lib/server/orders';
import { handle,json } from '../../../../../../lib/server/http';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {return handle(async()=>json(await operatorRecovery((await params).id)));}
