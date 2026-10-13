import { eq, lte } from 'drizzle-orm';
import { database } from '../lib/server/db';
import { orders, submissions } from '../lib/server/schema';
import { deleteUpload } from '../lib/server/storage';
async function main() {
  const db=database();
  const expired=await db.select({id:submissions.id}).from(submissions).where(lte(submissions.expiresAt,new Date(Date.now()-5*60*1000)));
  let deleted=0;
  for (const {id} of expired) {
    await deleteUpload(`staging/${id}.pdf`);
    const [accepted]=await db.select({id:orders.id}).from(orders).where(eq(orders.submissionId,id));
    if (!accepted) await deleteUpload(`accepted/${id}.pdf`);
    deleted++;
  }
  console.log(JSON.stringify({expiredStagingPurged:deleted,operationalRecordsPreserved:true}));
}
main().catch(()=>{console.error('Staging purge failed; safe to rerun.');process.exitCode=1;});
