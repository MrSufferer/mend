import { randomUUID } from 'node:crypto';
import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
import { policies } from '../lib/server/schema';
import { validatePolicy } from '../lib/server/terms';
async function main() {
  if (!process.env.DATABASE_URL_UNPOOLED) throw new Error('Load the local migration-owner environment. Never deploy it.');
  const [deliverySeconds='120', maxRetries='1', automaticRefundAllowance='10']=process.argv.slice(2);
  const policy=validatePolicy({deliverySeconds:Number(deliverySeconds),maxRetries:Number(maxRetries),automaticRefundAllowance});
  const db=drizzle(neon(process.env.DATABASE_URL_UNPOOLED));
  const id=randomUUID(); await db.insert(policies).values({id,policy});
  console.log(JSON.stringify({version:id,policy,appliesTo:'future submissions only'}));
}
main().catch(()=>{console.error('Policy configuration failed. Check local owner access and bounded values.');process.exitCode=1;});
