import { createHash, randomBytes } from 'node:crypto';
import { recoverMessageAddress, type Hex } from 'viem';
import { authenticated, body, credential, csv, database, HttpError, json, serve, text, transaction, wallet } from './http';

export type Settlement = {
  receiptId: string; requestId: string; wallet: string; merchant: string;
  network: string; amount: string; paidAt: number; expiresAt: number; inputDigest: string; service: string; confirmed: true;
};
export type RetainedResult = {
  providerId: string; requestId: string; receiptId: string; inputDigest: string;
  expiresAt: number; result: string;
};
export type Provider = {
  id: string; token: string; service: string; merchant: string; network: string; amount: string;
  verifyPayment(receiptId: string): Promise<Settlement | null>;
  validateResult(result: string): boolean;
};
export type RestorationConfig = { path: string; audience: string; port?: number; providers: Provider[] };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function startRestoration(config: RestorationConfig) {
  text(config.audience, 200);
  const providers = new Map<string, Provider>();
  for (const provider of config.providers) {
    text(provider.id); text(provider.service); text(provider.merchant); text(provider.network); text(provider.amount);
    credential(provider.token);
    if (providers.has(provider.id)) throw Error('Duplicate provider');
    providers.set(provider.id, provider);
  }
  const db = database(config.path);
  db.exec(`CREATE TABLE IF NOT EXISTS results (
    provider TEXT NOT NULL, request TEXT NOT NULL, receipt TEXT NOT NULL, fingerprint TEXT NOT NULL,
    wallet TEXT NOT NULL, expires INTEGER NOT NULL, record TEXT NOT NULL, result TEXT NOT NULL,
    PRIMARY KEY(provider, request), UNIQUE(provider, receipt));
    CREATE TABLE IF NOT EXISTS challenges (nonce TEXT PRIMARY KEY, provider TEXT NOT NULL, request TEXT NOT NULL,
      wallet TEXT NOT NULL, expires INTEGER NOT NULL, message TEXT NOT NULL);`);
  function purge() {
    db.prepare('DELETE FROM challenges WHERE expires <= ?').run(Date.now());
    // Preserve correlation tombstones: expiry must never permit payment/request reuse.
    db.prepare("UPDATE results SET result = '' WHERE expires <= ? AND result != ''").run(Date.now());
  }
  purge();
  return serve(config.port, db, async (req, res, path) => {
    if (req.method !== 'POST') throw new HttpError(404, 'Not found');
    const input = await body(req);
    purge();
    if (path === '/registrations') {
      const provider = providers.get(text(input.providerId));
      if (!provider) throw new HttpError(401, 'Unauthorized');
      authenticated(req, provider.token);
      const requestId = text(input.requestId);
      const receiptId = text(input.receiptId);
      if (!/^[a-f0-9]{64}$/.test(input.inputDigest)) throw new HttpError(400, 'Invalid input digest');
      if (typeof input.result !== 'string' || Buffer.byteLength(input.result) > 32_768 || !provider.validateResult(input.result)) throw new HttpError(422, 'Invalid purchased result');
      const expiresAt = input.expiresAt;
      if (!Number.isSafeInteger(expiresAt)) throw new HttpError(400, 'Invalid retention');
      const settlement = await provider.verifyPayment(receiptId);
      if (!settlement || settlement.confirmed !== true || settlement.receiptId !== receiptId || settlement.requestId !== requestId ||
          settlement.expiresAt !== expiresAt || settlement.inputDigest !== input.inputDigest || settlement.service !== provider.service ||
          settlement.network !== provider.network || settlement.merchant !== provider.merchant || settlement.amount !== provider.amount ||
          !Number.isSafeInteger(settlement.paidAt) || settlement.paidAt > Date.now() || expiresAt <= settlement.paidAt || expiresAt - settlement.paidAt > 86_400_000) {
        throw new HttpError(409, 'Payment evidence unavailable or inconsistent');
      }
      const payer = wallet(settlement.wallet);
      const record = JSON.stringify({ providerId: provider.id, service: provider.service, requestId, receiptId,
        inputDigest: input.inputDigest, expiresAt, resultDigest: digest(input.result), settlement: { ...settlement, wallet: payer } });
      transaction(db, () => {
        const existing = db.prepare('SELECT record FROM results WHERE provider = ? AND request = ?').get(provider.id, requestId);
        if (existing) {
          if (existing.record !== record) throw new HttpError(409, 'Conflicting registration');
          return;
        }
        if (expiresAt <= Date.now()) throw new HttpError(410, 'Result expired');
        if (db.prepare('SELECT 1 FROM results WHERE provider = ? AND receipt = ?').get(provider.id, receiptId)) throw new HttpError(409, 'Receipt already bound');
        db.prepare('INSERT INTO results VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(provider.id, requestId, receiptId, input.inputDigest, payer, expiresAt, record, input.result);
      });
      json(res, 200, { registered: true, requestId });
    } else if (path === '/challenges') {
      const providerId = text(input.providerId);
      const requestId = text(input.requestId);
      const payer = wallet(input.wallet);
      if (!providers.has(providerId)) throw new HttpError(404, 'Not found');
      if (Number(db.prepare('SELECT count(*) AS n FROM challenges').get()!.n) >= 10_000) throw new HttpError(429, 'Try again later');
      const nonce = randomBytes(32).toString('hex');
      const expiresAt = Date.now() + 60_000;
      const message = `Mend result restoration\nAudience: ${config.audience}\nProvider: ${providerId}\nRequest: ${requestId}\nWallet: ${payer}\nNonce: ${nonce}\nExpires: ${expiresAt}`;
      db.prepare('INSERT INTO challenges VALUES (?, ?, ?, ?, ?, ?)').run(nonce, providerId, requestId, payer, expiresAt, message);
      json(res, 200, { nonce, message, expiresAt });
    } else if (path === '/recover') {
      const nonce = text(input.nonce);
      const challenge = db.prepare('SELECT * FROM challenges WHERE nonce = ?').get(nonce);
      if (!challenge || !String(challenge.message).startsWith(`Mend result restoration\nAudience: ${config.audience}\n`)) throw new HttpError(401, 'Authorization expired or used');
      let signer: string;
      try { signer = await recoverMessageAddress({ message: String(challenge.message), signature: text(input.signature, 132) as Hex }); }
      catch { throw new HttpError(401, 'Unauthorized'); }
      if (signer.toLowerCase() !== challenge.wallet) throw new HttpError(401, 'Unauthorized');
      const result = transaction(db, () => {
        const used = db.prepare('DELETE FROM challenges WHERE nonce = ? AND expires > ? RETURNING nonce').get(nonce, Date.now());
        if (!used) throw new HttpError(401, 'Authorization expired or used');
        return db.prepare('SELECT result, expires, record FROM results WHERE provider = ? AND request = ? AND wallet = ?').get(challenge.provider, challenge.request, challenge.wallet);
      });
      if (!result || Number(result.expires) <= Date.now() || !result.result) throw new HttpError(404, 'Result unavailable');
      if (digest(String(result.result)) !== JSON.parse(String(result.record)).resultDigest) throw new HttpError(503, 'Result validation failed');
      csv(res, String(result.result));
    } else throw new HttpError(404, 'Not found');
  });
}

/** Server-to-server integration; persist these exact fields before first delivery. */
export async function registerResult(origin: string, token: string, record: RetainedResult) {
  const url = new URL(origin);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')) throw Error('HTTPS required outside loopback');
  const response = await fetch(new URL('/registrations', url), { method: 'POST', redirect: 'error',
    headers: { authorization: `Bearer ${credential(token)}`, 'content-type': 'application/json' },
    body: JSON.stringify(record), signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error(`Registration failed (${response.status})`);
}
