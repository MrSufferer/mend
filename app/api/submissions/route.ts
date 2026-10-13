import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { database } from '../../../lib/server/db';
import { submissions, orders, policies } from '../../../lib/server/schema';
import { handle, json, jsonBody, ApiError, capabilityHash } from '../../../lib/server/http';
import { maxUploadBytes, presignUpload } from '../../../lib/server/storage';
import { authorizedOrder, presentOrder } from '../../../lib/server/orders';
import { defaultPolicy, purchasedTerms } from '../../../lib/server/terms';
import { desc } from 'drizzle-orm';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request:Request) {return handle(async()=>{
  const hash = capabilityHash(request);
  const body = await jsonBody(request);
  if (!body || typeof body.idempotencyKey !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(body.idempotencyKey) ||
      typeof body.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(body.sha256) || !Number.isInteger(body.size) || body.size < 1)
    throw new ApiError(400,'invalid_submission','Provide idempotencyKey, byte size, and lowercase SHA-256 of the PDF.');
  if (body.size > maxUploadBytes) throw new ApiError(422,'oversized_pdf','PDF exceeds 10 MB.');
  const db = database();
  const [effective] = await db.select().from(policies).orderBy(desc(policies.createdAt)).limit(1);
  await db.insert(submissions).values({terms:purchasedTerms(effective?.policy??defaultPolicy,effective?.id??'default-v1'),id:randomUUID(), capabilityHash:hash,idempotencyKey:body.idempotencyKey,size:body.size,sha256:body.sha256,expiresAt:new Date(Date.now()+15*60*1000)}).onConflictDoNothing();
  const [submission] = await db.select().from(submissions).where(and(eq(submissions.capabilityHash,hash),eq(submissions.idempotencyKey,body.idempotencyKey)));
  if (submission.size!==body.size || submission.sha256!==body.sha256) throw new ApiError(409,'idempotency_conflict','That idempotency key belongs to a different document.');
  const [order] = await db.select().from(orders).where(eq(orders.submissionId,submission.id));
  if (order) return json({id:submission.id,order:presentOrder(await authorizedOrder(request,order.id))});
  if (submission.rejected) throw new ApiError(422,submission.rejected,'This rejected submission cannot be purchased; use a new idempotency key for a supported document.');
  if (submission.expiresAt.getTime() <= Date.now()) throw new ApiError(410,'submission_expired','Upload window expired. Use a new idempotency key.');
  return json({id:submission.id,expiresAt:submission.expiresAt.toISOString(),terms:submission.terms,upload:await presignUpload(`staging/${submission.id}.pdf`,submission.size,Math.max(1,Math.floor((submission.expiresAt.getTime()-Date.now())/1000)))},201);
});}
