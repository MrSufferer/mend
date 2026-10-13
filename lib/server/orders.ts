import { eq } from 'drizzle-orm';
import { database } from './db';
import { orders, type Order } from './schema';
import { ApiError, capabilityHash } from './http';
export function presentOrder(order:Order) {
  return {id:order.id,status:order.status,ownerWallet:order.ownerWallet,createdAt:order.createdAt.toISOString(),terms:order.terms,
    payment:{confirmed:false,processingStarted:false},
    upload:{size:order.uploadSize,pages:order.pages,createdAt:order.uploadCreatedAt.toISOString(),expiresAt:order.uploadExpiresAt.toISOString(),available:order.uploadExpiresAt.getTime()>Date.now()}};
}
// #3 replaces/extends this boundary with verified SIWE-session ownership. Never trust an address header.
export async function authorizedOrder(request:Request,id:string) {
  const hash=capabilityHash(request);
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(404,'order_not_found','Order not found.');
  const [order] = await database().select().from(orders).where(eq(orders.id,id));
  if (!order || order.capabilityHash !== hash) throw new ApiError(404,'order_not_found','Order not found.');
  return order;
}
