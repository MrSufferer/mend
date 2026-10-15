import {refundCapacity} from './capacity';
import {randomUUID} from 'node:crypto';
import {desc,sql} from 'drizzle-orm';
import {z} from 'zod';
import {database} from './db';
import {serviceAvailability,serviceIncidents} from './schema';
import {operatorAuthority,requireOperator,sameOrigin} from './auth';
import {ApiError,jsonBody} from './http';
export async function operatorAvailability(){
 await requireOperator();
 const [state,incidents]=await Promise.all([database().select().from(serviceAvailability),database().select().from(serviceIncidents).orderBy(desc(serviceIncidents.createdAt)).limit(20)]);
 const retention=await database().execute(sql`SELECT public.mend_retention_status() AS status`);
 return {availability:state[0],incidents,capacity:await refundCapacity(),retention:retention.rows[0].status};
}
export async function operatorPause(request:Request){
 sameOrigin(request);const authority=await operatorAuthority();
 const body=z.object({reason:z.string().trim().min(3).max(240)}).strict().safeParse(await jsonBody(request));
 if(!body.success)throw new ApiError(400,'invalid_pause_reason','Describe the processing incident in 3–240 characters.');
 const result=await database().execute(sql`SELECT public.mend_operator_pause(${randomUUID()}::uuid,${authority.sessionHash},${authority.wallet},${body.data.reason}) AS value`);
 if((result.rows[0]?.value as {error?:string})?.error)throw new ApiError(401,'session_expired','Your operator session expired. Sign in again.');
 return operatorAvailability();
}
