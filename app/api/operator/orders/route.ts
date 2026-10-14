import { operatorOrders } from '../../../../lib/server/orders';
import { handle,json } from '../../../../lib/server/http';
export const runtime='nodejs';
export async function GET(request:Request) {return handle(async()=>json(await operatorOrders(new URL(request.url).searchParams.get('filter')??'unresolved')));}
