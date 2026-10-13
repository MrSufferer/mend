import { customerOrders } from '../../../lib/server/orders';
import { handle,json } from '../../../lib/server/http';
export const runtime='nodejs';
export async function GET() {return handle(async()=>json(await customerOrders()));}
