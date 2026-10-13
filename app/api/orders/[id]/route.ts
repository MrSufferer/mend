import { handle, json } from '../../../../lib/server/http';
import { authorizedOrder, presentOrder } from '../../../../lib/server/orders';
export const runtime = 'nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {return handle(async()=>json(presentOrder(await authorizedOrder(request,(await params).id))));}
