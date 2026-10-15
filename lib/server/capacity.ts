import {sql} from 'drizzle-orm';
import {database} from './db';
export async function refundCapacity(){
 const result=await database().execute(sql`SELECT version::text,observed_version::text,observation,observed_at,observed_version=version AND observed_at>clock_timestamp()-interval '120 seconds' AS fresh FROM public.refund_capacity WHERE id='merchant'`);
 const row=result.rows[0];
 return row?{...row,status:row.fresh?(row.observation as {status?:string})?.status??'unknown':row.observation?'stale':'unknown'}:{status:'unknown'};
}
/** Narrow per-order projection: never expose other liabilities or canonical proof. */
export async function customerRefundCapacity(){
 const capacity=await refundCapacity(),observation=capacity.status==='stale'||capacity.status==='unknown'?null:('observation' in capacity?capacity.observation:null) as {allowanceResetAt?:string};
 return {status:capacity.status,allowanceResetAt:observation?.allowanceResetAt??null};
}
