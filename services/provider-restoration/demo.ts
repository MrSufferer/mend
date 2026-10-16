import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { startCsvProvider, csvIdentity, validCsv } from './csv-provider';
import { startRestoration, type Settlement } from './restoration';

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 24) throw Error('The standalone provider reference requires Node 24+');
  const dir = resolve(process.env.PROVIDER_DEMO_STATE ?? '.provider-state');
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const secretPath = join(dir, 'controlled-identity.json');
  let identity: { token: string; privateKey: `0x${string}` };
  try { identity = JSON.parse(await readFile(secretPath, 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    identity = { token: randomBytes(32).toString('hex'), privateKey: generatePrivateKey() };
    await writeFile(secretPath, JSON.stringify(identity), { mode: 0o600, flag: 'wx' });
  }
  const payer = privateKeyToAccount(identity.privateKey); // Local demo identity only. Never fund it.
  let provider: Awaited<ReturnType<typeof startCsvProvider>>;
  const mend = await startRestoration({ path: join(dir, 'mend.sqlite'), audience: 'mend-controlled-reference-v1',
    providers: [{ id: 'csv-reference', token: identity.token, ...csvIdentity, validateResult: validCsv,
      async verifyPayment(receiptId): Promise<Settlement | null> {
        const response = await fetch(provider.origin + '/test/receipts/' + encodeURIComponent(receiptId), {
          headers: { authorization: `Bearer ${identity.token}` }, redirect: 'error', signal: AbortSignal.timeout(2000),
        });
        return response.ok ? response.json() : null;
      } }],
  });
  try {
    provider = await startCsvProvider({ path: join(dir, 'provider.sqlite'), token: identity.token, recoveryOrigin: mend.origin,
      providerId: 'csv-reference', retentionMs: 3_600_000 });
    async function post(origin: string, path: string, body: unknown, authenticated = false) {
      return fetch(origin + path, { method: 'POST', headers: { 'content-type': 'application/json',
        ...(authenticated ? { authorization: `Bearer ${identity.token}` } : {}) }, body: JSON.stringify(body) });
    }
    async function expectJson(response: Response, status: number) {
      if (response.status !== status) throw Error(`Unexpected demo response (${response.status})`);
      return response.json();
    }
    const { requestId } = await expectJson(await post(provider.origin, '/requests', { wallet: payer.address, rows: [{ name: 'Ada', score: 7 }] }, true), 201);
    const { receiptId } = await expectJson(await post(provider.origin, '/test/receipts', { requestId, wallet: payer.address }, true), 201);
    // Persist correlation before the deliberately interrupted paid-response boundary.
    await writeFile(join(dir, 'purchase.json.tmp'), JSON.stringify({ requestId, receiptId }), { mode: 0o600 });
    await rename(join(dir, 'purchase.json.tmp'), join(dir, 'purchase.json'));
    let interrupted = false;
    try { await post(provider.origin, `/requests/${requestId}/purchase`, { receiptId, interrupt: true }, true); }
    catch { interrupted = true; }
    if (!interrupted) throw Error('Expected controlled delivery interruption');
    const challenge = await expectJson(await post(mend.origin, '/challenges', { providerId: 'csv-reference', requestId, wallet: payer.address }), 200);
    const response = await post(mend.origin, '/recover', { nonce: challenge.nonce, signature: await payer.signMessage({ message: challenge.message }) });
    if (response.status !== 200 || await response.text() !== 'name,score\r\nAda,7\r\n') throw Error('Result restoration failed');
    const status = await expectJson(await fetch(provider.origin + `/requests/${requestId}`, { headers: { authorization: `Bearer ${identity.token}` } }), 200);
    if (status.executions !== 1 || status.paymentCount !== 1) throw Error('Unexpected execution or payment count');
    console.log(JSON.stringify({ evidence: 'controlled', services: 2, originalDelivery: 'interrupted', restoration: 'verified', executions: status.executions,
      controlledPayments: status.paymentCount, independentProviderProof: false, liveX402Proof: false }));
  } finally { if (provider) await provider.close(); await mend.close(); }
}
void main().catch(() => { console.error('Controlled provider demo failed. Check private local configuration and run the conformance tests.'); process.exitCode = 1; });
