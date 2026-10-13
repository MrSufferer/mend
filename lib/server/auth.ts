import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { sql } from 'drizzle-orm';
import { getAddress, isAddress, verifyMessage, type Hex } from 'viem';
import { createSiweMessage, parseSiweMessage, validateSiweMessage } from 'viem/siwe';
import { database } from './db';
import { authChallenges } from './schema';
import { ApiError, json, jsonBody } from './http';
export const CHAIN_ID=5042002;
const sessionCookie='mend_session', bindingCookie='mend_preauth';
export function applicationOrigin() {
  const configured=process.env.APP_ORIGIN || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  if (!configured) throw new Error('APP_ORIGIN is required outside Vercel');
  const url=new URL(configured);
  if(url.origin!==configured || (url.protocol!=='https:' && !(url.protocol==='http:' && ['localhost','127.0.0.1'].includes(url.hostname)))) throw new Error('Invalid APP_ORIGIN');
  return url;
}
export function sameOrigin(request:Request) {
  if(request.headers.get('origin')!==applicationOrigin().origin) throw new ApiError(403,'origin_denied','Open Mend at its configured address and retry.');
}
function digest(token:string) {
  const secret=process.env.SESSION_SECRET;
  if(!secret || secret.length<32) throw new Error('A strong SESSION_SECRET is required');
  return createHmac('sha256',secret).update(token).digest('hex');
}
function opaque() {return randomBytes(32).toString('hex');}
async function cookieHash(name:string) {
  const token=(await cookies()).get(name)?.value;
  return token && /^[a-f0-9]{64}$/.test(token) ? digest(token) : undefined;
}
async function setCookie(name:string,token:string,maxAge:number) {
  (await cookies()).set(name,token,{httpOnly:true,secure:applicationOrigin().protocol==='https:',sameSite:'lax',path:'/',maxAge});
}
function denied(code='sign_in_failed',message='This sign-in request is invalid, used, or expired. Request a new signature.') {return new ApiError(401,code,message);}
export async function challenge(request:Request) {
  sameOrigin(request);
  const body=await jsonBody(request);
  if(typeof body?.address!=='string' || !isAddress(body.address) || body.chainId!==CHAIN_ID) throw new ApiError(400,'wallet_or_network_invalid','Use an EOA wallet on Arc testnet.');
  const origin=applicationOrigin(), wallet=getAddress(body.address), token=opaque(), id=randomUUID();
  const expiresAt=new Date(Date.now()+300_000);
  const message=createSiweMessage({address:wallet,chainId:CHAIN_ID,domain:origin.host,uri:origin.origin,version:'1',scheme:origin.protocol.slice(0,-1),nonce:opaque(),issuedAt:new Date(),expirationTime:expiresAt,statement:'Sign in to Mend. This does not authorize a payment.'});
  await database().insert(authChallenges).values({id,wallet:wallet.toLowerCase(),message,bindingHash:digest(token),expiresAt});
  await setCookie(bindingCookie,token,300);
  return json({challengeId:id,message,expiresAt:expiresAt.toISOString()});
}
export async function verify(request:Request) {
  sameOrigin(request);
  const body=await jsonBody(request), binding=await cookieHash(bindingCookie);
  if(!binding || typeof body?.challengeId!=='string' || !/^[0-9a-f-]{36}$/.test(body.challengeId) || typeof body.message!=='string' || typeof body.signature!=='string' || !/^0x[0-9a-fA-F]{130}$/.test(body.signature)) throw denied();
  const rows=await database().execute(sql`SELECT * FROM auth_challenges WHERE id=${body.challengeId}::uuid AND binding_hash=${binding} AND consumed_at IS NULL AND expires_at>now()`);
  const row=rows.rows[0];
  if(!row || row.message!==body.message) throw denied();
  const origin=applicationOrigin(), fields=parseSiweMessage(body.message);
  if(fields.version!=='1' || fields.chainId!==CHAIN_ID || fields.uri!==origin.origin || !fields.issuedAt || fields.issuedAt.getTime()>Date.now() || !fields.expirationTime || fields.expirationTime.getTime()<=Date.now() || !validateSiweMessage({message:fields,address:row.wallet as Hex,domain:origin.host,scheme:origin.protocol.slice(0,-1),time:new Date()})) throw denied();
  let valid=false;
  try {valid=await verifyMessage({address:row.wallet as Hex,message:body.message,signature:body.signature as Hex});} catch {throw denied();}
  if(!valid) throw denied();
  const token=opaque(), previous=await cookieHash(sessionCookie);
  // Consumption, session insertion and replacement revocation share one atomic SQL statement.
  const result=await database().execute(sql`WITH consumed AS (
    UPDATE auth_challenges SET consumed_at=now() WHERE id=${body.challengeId}::uuid AND binding_hash=${binding} AND consumed_at IS NULL AND expires_at>now() RETURNING wallet
  ), revoked AS (
    UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=${previous??''} AND EXISTS(SELECT 1 FROM consumed)
  ) INSERT INTO auth_sessions(token_hash,wallet,chain_id,expires_at)
    SELECT ${digest(token)},wallet,${CHAIN_ID},now()+interval '24 hours' FROM consumed RETURNING wallet,expires_at`);
  if(result.rows.length!==1) throw denied();
  await setCookie(sessionCookie,token,86400);
  await setCookie(bindingCookie,'',0);
  return json(sessionDto(result.rows[0]));
}
function sessionDto(row:Record<string,unknown>) {
  const wallet=String(row.wallet);
  return {wallet,chainId:CHAIN_ID,role:wallet===process.env.OPERATOR_WALLET_ADDRESS?.toLowerCase()?'operator':'customer',expiresAt:new Date(String(row.expires_at)).toISOString()};
}
export async function requireSession() {
  const token=await cookieHash(sessionCookie);
  if(!token) throw denied('sign_in_required','Connect your wallet, then sign in to access private orders.');
  const result=await database().execute(sql`SELECT wallet,expires_at FROM auth_sessions WHERE token_hash=${token} AND revoked_at IS NULL AND expires_at>now()`);
  if(!result.rows[0]) throw denied('session_expired','Your session expired or was signed out. Sign in again.');
  return sessionDto(result.rows[0]);
}
export async function requireOperator() {
  const session=await requireSession();
  if(session.role!=='operator') throw new ApiError(403,'operator_required','The Recovery desk is restricted to the configured operator wallet.');
  return session;
}
export async function logout(request:Request) {
  sameOrigin(request);
  const token=await cookieHash(sessionCookie);
  if(token) await database().execute(sql`UPDATE auth_sessions SET revoked_at=now() WHERE token_hash=${token}`);
  await setCookie(sessionCookie,'',0); await setCookie(bindingCookie,'',0);
  return json({signedOut:true});
}
