import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { chmodSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export class HttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function database(path: string) {
  if (!path || path === ':memory:') throw Error('A durable database path is required');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path, { timeout: 5000 });
  chmodSync(path, 0o600);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
  return db;
}
export function transaction<T>(db: DatabaseSync, action: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try { const value = action(); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
export function credential(token: string) {
  if (typeof token !== 'string' || Buffer.byteLength(token) < 32) throw Error('Provider credentials require at least 32 bytes');
  return token;
}
export function authenticated(req: IncomingMessage, token: string) {
  const actual = Buffer.from(req.headers.authorization ?? '');
  const expected = Buffer.from(`Bearer ${token}`);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new HttpError(401, 'Unauthorized');
}
export async function body(req: IncomingMessage): Promise<Record<string, any>> {
  if (req.headers['content-type']?.split(';')[0] !== 'application/json') throw new HttpError(415, 'JSON required');
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 65_536) throw new HttpError(413, 'Request too large');
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error();
    return value;
  } catch { throw new HttpError(400, 'Invalid JSON object'); }
}
export function text(value: unknown, max = 128): string {
  if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f]/.test(value)) throw new HttpError(400, 'Invalid field');
  return value;
}
export function wallet(value: unknown): string {
  const address = text(value, 42);
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new HttpError(400, 'Invalid wallet');
  return address.toLowerCase();
}
export function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'private, no-store' });
  res.end(JSON.stringify(value));
}
export function csv(res: ServerResponse, value: string) {
  res.writeHead(200, { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="result.csv"', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' });
  res.end(value);
}
export async function serve(port: number | undefined, db: DatabaseSync, handler: (req: IncomingMessage, res: ServerResponse, path: string) => Promise<void>) {
  const server = createServer((req, res) => {
    void handler(req, res, (req.url ?? '').split('?')[0]).catch(error => {
      if (!res.destroyed && !res.headersSent) json(res, error instanceof HttpError ? error.status : 503, { error: error instanceof HttpError ? error.message : 'Temporarily unavailable' });
      else res.destroy();
    });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5000;
  try {
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port ?? 0, '127.0.0.1', resolve); });
  } catch (error) { db.close(); throw error; }
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Missing listener address');
  return { origin: `http://127.0.0.1:${address.port}`, async close() {
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeIdleConnections(); });
    db.close();
  } };
}
