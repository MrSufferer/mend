import { createHash, randomUUID } from 'node:crypto';
import { authenticated, body, credential, csv, database, HttpError, json, serve, text, transaction, wallet } from './http';
import { registerResult, type RetainedResult, type Settlement } from './restoration';

export const csvIdentity = { service: 'json-to-csv', merchant: 'controlled-csv-merchant', network: 'controlled-ledger', amount: '1' };
export function validCsv(result: string) { return result.length > 0 && result.endsWith('\r\n') && !result.includes('\0'); }
function convert(rows: unknown): string {
  if (!Array.isArray(rows) || !rows.length || rows.length > 100 || rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new HttpError(422, 'Expected 1–100 flat JSON objects');
  const columns = Object.keys(rows[0]);
  if (!columns.length || columns.length > 32 || rows.some(row => Object.keys(row).some(key => !columns.includes(key)))) throw new HttpError(422, 'Inconsistent columns');
  const cell = (value: unknown) => {
    if (value != null && !['string', 'number', 'boolean'].includes(typeof value)) throw new HttpError(422, 'Only scalar cells supported');
    let output = value == null ? '' : String(value);
    if (/^[\s]*[=+\-@]/.test(output)) output = "'" + output;
    return /[",\r\n]/.test(output) ? `"${output.replaceAll('"', '""')}"` : output;
  };
  const result = [columns.map(cell).join(','), ...rows.map(row => columns.map(key => cell(row[key])).join(','))].join('\r\n') + '\r\n';
  if (Buffer.byteLength(result) > 32_768) throw new HttpError(422, 'Result too large');
  return result;
}
export async function startCsvProvider(config: { path: string; token: string; recoveryOrigin: string; providerId: string; port?: number; retentionMs: number }) {
  credential(config.token); text(config.providerId);
  if (!Number.isSafeInteger(config.retentionMs) || config.retentionMs < 1 || config.retentionMs > 86_400_000) throw Error('Retention must be between 1ms and 24h');
  const db = database(config.path);
  db.exec(`CREATE TABLE IF NOT EXISTS requests (id TEXT PRIMARY KEY, wallet TEXT NOT NULL, input TEXT NOT NULL,
    digest TEXT NOT NULL, created INTEGER NOT NULL, retention INTEGER NOT NULL, result TEXT, receipt TEXT UNIQUE, expires INTEGER, executions INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, request TEXT UNIQUE NOT NULL, record TEXT NOT NULL);`);
  function purge() {
    db.prepare("UPDATE requests SET input = '', result = '' WHERE (expires IS NOT NULL AND expires <= ?) OR (expires IS NULL AND created <= ?)").run(Date.now(), Date.now() - 86_400_000);
  }
  purge();
  return serve(config.port, db, async (req, res, path) => {
    authenticated(req, config.token);
    purge();
    if (req.method === 'GET' && path.startsWith('/test/receipts/')) {
      const receipt = db.prepare('SELECT record FROM receipts WHERE id = ?').get(path.slice('/test/receipts/'.length));
      if (!receipt) throw new HttpError(404, 'Not found');
      json(res, 200, JSON.parse(String(receipt.record))); return;
    }
    if (req.method === 'GET' && /^\/requests\/[^/]+$/.test(path)) {
      const row = db.prepare('SELECT executions, receipt FROM requests WHERE id = ?').get(path.split('/')[2]);
      if (!row) throw new HttpError(404, 'Not found');
      json(res, 200, { executions: row.executions, paymentCount: row.receipt ? 1 : 0, evidence: 'controlled' }); return;
    }
    if (req.method !== 'POST') throw new HttpError(404, 'Not found');
    const input = await body(req);
    if (path === '/requests') {
      const payer = wallet(input.wallet);
      convert(input.rows); // Validate before allocating a durable request or accepting a receipt.
      const encoded = JSON.stringify(input.rows);
      const requestId = randomUUID();
      db.prepare('INSERT INTO requests (id, wallet, input, digest, created, retention) VALUES (?, ?, ?, ?, ?, ?)').run(requestId, payer, encoded, createHash('sha256').update(encoded).digest('hex'), Date.now(), config.retentionMs);
      json(res, 201, { requestId, evidence: 'controlled', terms: { ...csvIdentity, retentionMs: config.retentionMs } });
    } else if (path === '/test/receipts') {
      const requestId = text(input.requestId);
      const payer = wallet(input.wallet);
      const row = db.prepare('SELECT wallet, digest, retention, created FROM requests WHERE id = ?').get(requestId);
      if (!row || Number(row.created) + 86_400_000 <= Date.now() || row.wallet !== payer) throw new HttpError(409, 'Payer/request mismatch');
      if (db.prepare('SELECT 1 FROM receipts WHERE request = ?').get(requestId)) throw new HttpError(409, 'Receipt already issued');
      const receiptId = randomUUID();
      const paidAt = Date.now();
      const receipt: Settlement = { ...csvIdentity, receiptId, requestId, wallet: payer, paidAt, expiresAt: paidAt + Number(row.retention), inputDigest: String(row.digest), confirmed: true };
      db.prepare('INSERT INTO receipts VALUES (?, ?, ?)').run(receiptId, requestId, JSON.stringify(receipt));
      json(res, 201, { receiptId, evidence: 'controlled' });
    } else if (/^\/requests\/[^/]+\/purchase$/.test(path)) {
      const requestId = path.split('/')[2];
      const receiptId = text(input.receiptId);
      const record = transaction(db, () => {
        const row = db.prepare('SELECT * FROM requests WHERE id = ?').get(requestId);
        const receipt = db.prepare('SELECT record FROM receipts WHERE id = ?').get(receiptId);
        if (!row || !receipt) throw new HttpError(409, 'Payment evidence unavailable');
        const settlement: Settlement = JSON.parse(String(receipt.record));
        if (settlement.requestId !== requestId || settlement.wallet !== row.wallet || (row.receipt && row.receipt !== receiptId)) throw new HttpError(409, 'Payment mismatch');
        const expiresAt = settlement.expiresAt;
        if (expiresAt <= Date.now()) throw new HttpError(410, 'Result expired');
        const result = row.result == null ? convert(JSON.parse(String(row.input))) : String(row.result);
        if (row.result == null) db.prepare('UPDATE requests SET result = ?, receipt = ?, expires = ?, executions = 1 WHERE id = ?').run(result, receiptId, expiresAt, requestId);
        return { providerId: config.providerId, requestId, receiptId, inputDigest: String(row.digest), expiresAt, result } satisfies RetainedResult;
      });
      // Failed registration stays pending in durable provider storage. Replaying purchase reconciles it.
      await registerResult(config.recoveryOrigin, config.token, record);
      if (input.interrupt === true) { res.destroy(); return; }
      csv(res, record.result);
    } else throw new HttpError(404, 'Not found');
  });
}
