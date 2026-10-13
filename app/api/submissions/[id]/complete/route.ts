import { randomUUID, createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import { database } from '../../../../../lib/server/db';
import { submissions, orders } from '../../../../../lib/server/schema';
import { handle, json, ApiError, capabilityHash } from '../../../../../lib/server/http';
import { readUpload, saveUpload, deleteUpload } from '../../../../../lib/server/storage';
import { validatePdf } from '../../../../../lib/server/pdf';
import { presentOrder } from '../../../../../lib/server/orders';
export const runtime = 'nodejs';
export const maxDuration = 60;
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}) {return handle(async()=>{
  const hash = capabilityHash(request); const {id} = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new ApiError(404,'submission_not_found','Submission not found.');
  const db = database();
  const [submission] = await db.select().from(submissions).where(and(eq(submissions.id,id),eq(submissions.capabilityHash,hash)));
  if (!submission) throw new ApiError(404,'submission_not_found','Submission not found.');
  const [existing] = await db.select().from(orders).where(eq(orders.submissionId,id));
  if (existing) return json(presentOrder(existing));
  if (submission.rejected) throw new ApiError(422,submission.rejected,'This document was rejected before payment.');
  if (submission.expiresAt.getTime() <= Date.now()) {await deleteUpload(`staging/${id}.pdf`); throw new ApiError(410,'submission_expired','Upload window expired.');}
  let upload:Awaited<ReturnType<typeof readUpload>>; let validation:{pages:number};
  try {
    upload = await readUpload(`staging/${id}.pdf`);
    if (upload.bytes.length!==submission.size || createHash('sha256').update(upload.bytes).digest('hex')!==submission.sha256)
      throw new ApiError(422,'document_mismatch','Uploaded bytes do not match the declared document.');
    validation = await validatePdf(upload.bytes);
  } catch(error) {
    if (error instanceof ApiError) {
      await db.update(submissions).set({rejected:error.code}).where(eq(submissions.id,id));
      await deleteUpload(`staging/${id}.pdf`);
    }
    throw error;
  }
  // Copy validated bytes to a server-only key: an unexpired PUT URL cannot replace an accepted document.
  const uploadKey = `accepted/${id}.pdf`;
  await saveUpload(uploadKey,upload.bytes);
  const uploadCreatedAt = upload.uploadedAt;
  const inserted = await db.insert(orders).values({id:randomUUID(),submissionId:id,capabilityHash:hash,status:'unpaid',
    terms:submission.terms,uploadKey,uploadCreatedAt,
    uploadExpiresAt:new Date(uploadCreatedAt.getTime()+7*24*60*60*1000),uploadSize:submission.size,uploadSha256:submission.sha256,pages:validation.pages,
  }).onConflictDoNothing().returning();
  const [order] = inserted.length ? inserted : await db.select().from(orders).where(eq(orders.submissionId,id));
  // Keep staging until its PUT grant expires; later sweep also deletes abandoned uploads.
  return json(presentOrder(order), inserted.length ? 201 : 200);
});}
