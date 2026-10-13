import { createHash } from 'node:crypto';
export class ApiError extends Error { constructor(public status:number, public code:string, message:string) {super(message);} }
export function capabilityHash(request:Request) {
  const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) throw new ApiError(401,'capability_required','Use a privately saved 256-bit order capability.');
  return createHash('sha256').update(token).digest('hex');
}
export async function jsonBody(request:Request) {
  const body = await request.text();
  if (body.length > 8192) throw new ApiError(413,'request_too_large','Upload PDF bytes directly to private storage.');
  try {return JSON.parse(body);} catch {throw new ApiError(400,'invalid_json','Expected a JSON request.');}
}
export function json(value:unknown, status=200) {return Response.json(value,{status,headers:{'Cache-Control':'private, no-store'}});}
export async function handle(action:()=>Promise<Response>) {
  try {return await action();} catch (error) {
    if (error instanceof ApiError) return json({error:error.code, message:error.message},error.status);
    // Do not log credentials, signed URLs, request bodies, or document content.
    console.error('Mend API operation failed', error instanceof Error ? error.name : 'UnknownError');
    return json({error:'temporarily_unavailable',message:'Mend is temporarily unavailable. Retry; existing orders remain recoverable.'},503);
  }
}
