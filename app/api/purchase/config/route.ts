import {desc} from 'drizzle-orm';
import {database} from '../../../../lib/server/db';
import {policies,serviceAvailability} from '../../../../lib/server/schema';
import {defaultPolicy,purchasedTerms} from '../../../../lib/server/terms';
import {paymentRequirements} from '../../../../lib/server/payments';
import {handle,json} from '../../../../lib/server/http';
export const runtime='nodejs';
export async function GET(){return handle(async()=>{
 const db=database();const [policy,state]=await Promise.all([db.select().from(policies).orderBy(desc(policies.createdAt)).limit(1),db.select().from(serviceAvailability).limit(1)]);
 return json({available:!!state[0]&&!state[0].paused,terms:purchasedTerms(policy[0]?.policy??defaultPolicy,policy[0]?.id??'default-v1'),payment:paymentRequirements()});
});}
