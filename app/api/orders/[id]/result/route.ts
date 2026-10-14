import {handle,ApiError} from '../../../../../lib/server/http';
import {authorizedOrder} from '../../../../../lib/server/orders';
import {database} from '../../../../../lib/server/db';
import {orders,resultDownloads} from '../../../../../lib/server/schema';
import {readResult} from '../../../../../lib/server/storage';
import {requireSession} from '../../../../../lib/server/auth';
import {randomUUID,createHash} from 'node:crypto';
import {eq} from 'drizzle-orm';
export const runtime='nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {return handle(async()=>{
 const order=await authorizedOrder(request,(await params).id);
 if(!order.paidAt)throw new ApiError(409,'payment_required','A confirmed purchase is required before a result can be delivered.');
 const session=await requireSession();if(session.wallet!==order.payerWallet)throw new ApiError(404,'order_not_found','Order not found.');
 if(!order.result||!order.deliveredAt)throw new ApiError(409,'result_pending','A verified result is not yet available.');
 if(new Date(order.result.expiresAt).getTime()<=Date.now())throw new ApiError(410,'result_expired','The result retention period has ended.');
 const bytes=await readResult(order.result.key);
 if(bytes.length!==order.result.size||createHash('sha256').update(bytes).digest('hex')!==order.result.sha256)throw new ApiError(409,'result_unavailable','The result could not be verified. The order needs recovery.');
 if(new Date(order.result.expiresAt).getTime()<=Date.now())throw new ApiError(410,'result_expired','The result retention period has ended.');
 const servedAt=new Date();await database().batch([
  database().insert(resultDownloads).values({id:randomUUID(),orderId:order.id,wallet:session.wallet,servedAt,size:bytes.length,sha256:order.result.sha256}),
  database().update(orders).set({lastDownloadAt:servedAt}).where(eq(orders.id,order.id)),
 ]);
 return new Response(new Uint8Array(bytes),{headers:{'Content-Type':'text/plain; charset=utf-8','Content-Disposition':'attachment; filename="result.txt"','Cache-Control':'private, no-store'}});
});}
