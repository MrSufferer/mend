import {handle,ApiError} from '../../../../../lib/server/http';
import {authorizedOrder} from '../../../../../lib/server/orders';
import {database} from '../../../../../lib/server/db';
import {orders,resultDownloads} from '../../../../../lib/server/schema';
import {verifiedResult} from '../../../../../lib/server/storage';
import {requireSession} from '../../../../../lib/server/auth';
import {randomUUID} from 'node:crypto';
import {eq} from 'drizzle-orm';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {return handle(async()=>{
 const order=await authorizedOrder(request,(await params).id);
 if(!order.paidAt)throw new ApiError(409,'payment_required','A confirmed purchase is required before a result can be delivered.');
 const session=await requireSession();if(session.wallet!==order.payerWallet)throw new ApiError(404,'order_not_found','Order not found.');
 if(!order.result||!order.deliveredAt)throw new ApiError(409,'result_pending','A verified result is not yet available.');
 const bytes=await verifiedResult(order.result);
 const servedAt=new Date();await database().batch([
  database().insert(resultDownloads).values({id:randomUUID(),orderId:order.id,wallet:session.wallet,servedAt,size:bytes.length,sha256:order.result.sha256}),
  database().update(orders).set({lastDownloadAt:servedAt}).where(eq(orders.id,order.id)),
 ]);
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="result.txt"','Cache-Control':'private, no-store'}});
});}
