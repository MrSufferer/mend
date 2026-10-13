import { handle, ApiError, json } from '../../../../../lib/server/http';
import { authorizedOrder } from '../../../../../lib/server/orders';
import { presignRead } from '../../../../../lib/server/storage';
export const runtime = 'nodejs';
export async function GET(request:Request,{params}:{params:Promise<{id:string}>}) {return handle(async()=>{
  const order = await authorizedOrder(request,(await params).id);
  const remainingSeconds=Math.floor((order.uploadExpiresAt.getTime()-Date.now())/1000);
  if (remainingSeconds < 1) throw new ApiError(410,'upload_expired','The private upload retention period has ended.');
  const expiresIn=Math.min(60,remainingSeconds);
  return json({url:await presignRead(order.uploadKey,expiresIn),expiresIn});
});}
