import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { startRestoration } from '../../services/provider-restoration/restoration';
import { startCsvProvider, validCsv } from '../../services/provider-restoration/csv-provider';

const token = 'controlled-provider-credential-32-bytes-minimum';
const account = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
async function post(origin: string, path: string, body: unknown, credential?: string) {
  return fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json', connection: 'close', ...(credential ? { authorization: `Bearer ${credential}` } : {}) }, body: JSON.stringify(body) });
}
async function fixture(t: TestContext, options: { retentionMs?: number } = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'mend-provider-'));
  let provider: Awaited<ReturnType<typeof startCsvProvider>>;
  const config = {
    path: join(dir, 'mend.sqlite'), audience: 'mend-controlled-demo',
    providers: [{ id: 'csv-reference', token, service: 'json-to-csv', merchant: 'controlled-csv-merchant', network: 'controlled-ledger', amount: '1', validateResult: validCsv,
      verifyPayment: async (receiptId: string) => {
        const response = await fetch(provider.origin + '/test/receipts/' + encodeURIComponent(receiptId), { headers: { authorization: `Bearer ${token}`, connection: 'close' }, signal: AbortSignal.timeout(2000) });
        if (!response.ok) return null;
        return response.json();
      } }],
  };
  let mend = await startRestoration(config);
  let mendStopped = false;
  const providerConfig = { path: join(dir, 'provider.sqlite'), token, recoveryOrigin: mend.origin, providerId: 'csv-reference', retentionMs: options.retentionMs ?? 60_000 };
  provider = await startCsvProvider(providerConfig);
  t.after(async () => { if (!mendStopped) await mend.close(); await provider.close(); await rm(dir, { recursive: true, force: true }); });
  async function request(rows: unknown = [{ name: 'Ada', score: 7 }]) {
    const response = await post(provider.origin, '/requests', { wallet: account.address, rows }, token);
    assert.equal(response.status, 201);
    return response.json();
  }
  async function receipt(requestId: string, wallet = account.address) {
    const response = await post(provider.origin, '/test/receipts', { requestId, wallet }, token);
    assert.equal(response.status, 201);
    return response.json();
  }
  async function purchase(requestId: string, receiptId: string, interrupt = false) {
    return post(provider.origin, `/requests/${requestId}/purchase`, { receiptId, interrupt }, token);
  }
  async function recovery(requestId: string, signer = account) {
    const challenge = await (await post(mend.origin, '/challenges', { providerId: 'csv-reference', requestId, wallet: signer.address })).json();
    const body = { nonce: challenge.nonce, signature: await signer.signMessage({ message: challenge.message }) };
    return { response: await post(mend.origin, '/recover', body), body };
  }
  return { get mend() { return mend; }, get provider() { return provider; }, request, receipt, purchase, recovery,
    async stopMend() { await mend.close(); mendStopped = true; },
    async restart() {
      if (!mendStopped) await mend.close();
      await provider.close();
      mend = await startRestoration(config);
      mendStopped = false;
      provider = await startCsvProvider({ ...providerConfig, recoveryOrigin: mend.origin });
    },
  };
}

test('lost purchase response is restored after both services restart, without another execution or payment', async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.request();
  const { receiptId } = await f.receipt(requestId);
  await assert.rejects(() => f.purchase(requestId, receiptId, true));
  await f.restart();
  const { response } = await f.recovery(requestId);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(await response.text(), 'name,score\r\nAda,7\r\n');
  const replay = await f.purchase(requestId, receiptId);
  assert.equal(replay.status, 200);
  assert.equal(await replay.text(), 'name,score\r\nAda,7\r\n');
  const status = await (await fetch(f.provider.origin + `/requests/${requestId}`, { headers: { authorization: `Bearer ${token}`, connection: 'close' } })).json();
  assert.equal(status.executions, 1);
  assert.equal(status.paymentCount, 1);
  assert.equal(status.evidence, 'controlled');
});

test('concurrent recovery succeeds with separate authorizations; replaying one authorization succeeds once', async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.request();
  const { receiptId } = await f.receipt(requestId);
  assert.equal((await f.purchase(requestId, receiptId)).status, 200);
  const results = await Promise.all(Array.from({ length: 8 }, () => f.recovery(requestId)));
  assert.ok(results.every(({ response }) => response.status === 200));
  const challenge = await (await post(f.mend.origin, '/challenges', { providerId: 'csv-reference', requestId, wallet: account.address })).json();
  const auth = { nonce: challenge.nonce, signature: await account.signMessage({ message: challenge.message }) };
  const replay = await Promise.all([post(f.mend.origin, '/recover', auth), post(f.mend.origin, '/recover', auth)]);
  assert.deepEqual(replay.map(r => r.status).sort(), [200, 401]);
  assert.equal((await post(f.mend.origin, '/recover', results[0].body)).status, 401);
});

test('identifiers do not grant access and signatures must match the challenged original payer', async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.request();
  const { receiptId } = await f.receipt(requestId);
  await f.purchase(requestId, receiptId);
  assert.equal((await f.recovery(requestId, stranger)).response.status, 404);
  const challenge = await (await post(f.mend.origin, '/challenges', { providerId: 'csv-reference', requestId, wallet: account.address })).json();
  assert.equal((await post(f.mend.origin, '/recover', { nonce: challenge.nonce, signature: await stranger.signMessage({ message: challenge.message }) })).status, 401);
  assert.equal((await post(f.mend.origin, '/recover', { nonce: challenge.nonce, signature: await account.signMessage({ message: challenge.message + '\nchanged' }) })).status, 401);
  assert.equal((await fetch(f.mend.origin + '/recover')).status, 404);
  assert.equal((await post(f.mend.origin, '/registrations', { providerId: 'csv-reference' })).status, 401);
  assert.equal((await post(f.provider.origin, '/test/receipts', { requestId, wallet: stranger.address }, token)).status, 409);
});

test('concurrent purchase replay and cross-request receipt reuse cannot add another execution or charge', async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.request();
  const second = await f.request();
  const { receiptId } = await f.receipt(requestId);
  assert.equal((await f.purchase(second.requestId, receiptId)).status, 409);
  const purchases = await Promise.all(Array.from({ length: 6 }, () => f.purchase(requestId, receiptId)));
  assert.ok(purchases.every(response => response.status === 200));
  assert.equal((await post(f.provider.origin, '/test/receipts', { requestId, wallet: account.address }, token)).status, 409);
  const status = await (await fetch(f.provider.origin + `/requests/${requestId}`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(status.executions, 1);
  assert.equal(status.paymentCount, 1);
});

test('a failed registration is reconciled from the provider retained result after restart', async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.request();
  const { receiptId } = await f.receipt(requestId);
  await f.stopMend();
  assert.equal((await f.purchase(requestId, receiptId)).status, 503);
  await f.restart();
  assert.equal((await f.purchase(requestId, receiptId)).status, 200);
  assert.equal((await f.recovery(requestId)).response.status, 200);
  const status = await (await fetch(f.provider.origin + `/requests/${requestId}`, { headers: { authorization: `Bearer ${token}` } })).json();
  assert.equal(status.executions, 1);
});

test('expiry survives restart and purchase replay never extends purchased retention', async (t) => {
  const f = await fixture(t, { retentionMs: 100 });
  const { requestId } = await f.request();
  const { receiptId } = await f.receipt(requestId);
  assert.equal((await f.purchase(requestId, receiptId)).status, 200);
  await new Promise(resolve => setTimeout(resolve, 150));
  await f.restart();
  assert.equal((await f.recovery(requestId)).response.status, 404);
  assert.equal((await f.purchase(requestId, receiptId)).status, 410);
});

test('registration rejects missing payment evidence, altered output and receipt/request conflicts', async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.request();
  const { receiptId } = await f.receipt(requestId);
  assert.equal((await f.purchase(requestId, receiptId)).status, 200);
  const record = { providerId: 'csv-reference', requestId, receiptId, inputDigest: 'a'.repeat(64), expiresAt: Date.now() + 30_000, result: 'name\r\nMallory\r\n' };
  assert.equal((await post(f.mend.origin, '/registrations', record, token)).status, 409);
  assert.equal((await post(f.mend.origin, '/registrations', { ...record, requestId: 'another-request' }, token)).status, 409);
  assert.equal((await post(f.mend.origin, '/registrations', { ...record, receiptId: 'unverified-receipt' }, token)).status, 409);
  assert.equal((await post(f.mend.origin, '/registrations', { ...record, result: '' }, token)).status, 422);
  const original = await f.recovery(requestId);
  assert.equal(await original.response.text(), 'name,score\r\nAda,7\r\n');
});

test('invalid input and oversized bodies fail before purchase; CSV escapes quotes and spreadsheet formulas', async (t) => {
  const f = await fixture(t);
  assert.equal((await post(f.provider.origin, '/requests', { wallet: account.address, rows: [{ nested: {} }] }, token)).status, 422);
  assert.equal((await post(f.provider.origin, '/requests', { wallet: account.address, rows: [{ large: 'x'.repeat(70_000) }] }, token)).status, 413);
  const { requestId } = await f.request([{ name: 'A,"B"', score: '=1+2' }]);
  const { receiptId } = await f.receipt(requestId);
  const result = await f.purchase(requestId, receiptId);
  assert.equal(await result.text(), 'name,score\r\n"A,""B""",\'=1+2\r\n');
});

test('registration cannot invent purchased input or extend the payment-authorized retention', async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.request();
  const { receiptId } = await f.receipt(requestId);
  const receipt = await (await fetch(f.provider.origin + `/test/receipts/${receiptId}`, { headers: { authorization: `Bearer ${token}` } })).json();
  const record = { providerId: 'csv-reference', requestId, receiptId, inputDigest: receipt.inputDigest ?? 'b'.repeat(64), expiresAt: receipt.expiresAt ?? Date.now() + 60_000, result: 'name,score\r\nAda,7\r\n' };
  assert.equal((await post(f.mend.origin, '/registrations', { ...record, inputDigest: 'a'.repeat(64) }, token)).status, 409);
  assert.equal((await post(f.mend.origin, '/registrations', { ...record, expiresAt: record.expiresAt + 1000 }, token)).status, 409);
});

test('an expired wallet challenge is unusable even with a valid signature', async (t) => {
  const f = await fixture(t);
  const { requestId } = await f.request();
  const { receiptId } = await f.receipt(requestId);
  await f.purchase(requestId, receiptId);
  const challenge = await (await post(f.mend.origin, '/challenges', { providerId: 'csv-reference', requestId, wallet: account.address })).json();
  const signature = await account.signMessage({ message: challenge.message });
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() + 61_000 });
  assert.equal((await post(f.mend.origin, '/recover', { nonce: challenge.nonce, signature })).status, 401);
});
