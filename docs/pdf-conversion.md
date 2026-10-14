# Paid PDF conversion

A receipt-confirmed purchase invokes the authenticated `mendconversion` Neon Function. Its durable generation-zero claim permits one initial parser per order. The original payment block timestamp establishes the purchased deadline; invoking or downloading does not reset it. Backend execution is deployed on Neon Free in Singapore; the web application receives only its URL and a service authentication secret.

The function explicitly overrides both injected database URLs and every injected storage credential with the conversion role. It receives no purchaser, registrar, recovery, administrator, session, or model credentials. The PDF parser runs in a Node worker thread with an empty environment, receives bounded PDF bytes, and returns bounded plain text. PDF.js extracts local text without an external model or OCR provider.

The parent verifies the accepted upload hash, observes the parser's `exit` event, then records a durable output candidate before writing storage. It reads the stored object back and verifies nonempty content and its hash before recording authenticated availability as delivery. `orders.result` is an authenticated manifest, not a public storage URL. Its seven-day expiry starts at object creation (`LastModified`), independently of the upload's creation clock. Result retrieval checks paying-wallet ownership, expiry, and the actual private bytes before serving an attachment.

Delivery records when verified bytes became available. `result_downloads` records a separately authenticated response served; it does not prove that a customer saved or read the file. Downloads and fixture restoration preserve the original expiry. Customer projections omit object keys and raw diagnostics.

## Deployment and checks

Run `MEND_CREDENTIAL_DIRECTORY=/absolute/private/inventory node scripts/deploy-conversion.mjs` locally. This management process uses the cached Neon API credential and allowlisted conversion environment files. It bundles Node 24 ESM and waits for the current deployment to be completed and active. The protected service configuration is written outside the repository, defaulting to `/private/tmp/mend-conversion-service.env`. Never copy management credentials or conversion storage/database credentials into web deployment variables.

Run `TEST_BASE_URL=http://127.0.0.1:3028 TEST_AUTH_ORIGIN=http://127.0.0.1:3028 PAYMENT_TEST_PURCHASER_ENV=/absolute/private/purchaser.env npx playwright test tests/conversion.spec.ts`. Cached signatures and private capabilities stay outside git. Optional `CONVERSION_FIXTURE_DB_ENV` enables local administrative setup for exact-expiry and controlled integrity-failure checks; those credentials are neither web nor function runtime configuration.

## Recovery boundary

`execution_attempts.stopped_at`, `stop_reason`, and `parser_exit_code` describe the parser only. They do **not** establish whole-execution termination, output absence, or refund safety: publication follows parser exit. A prepared output candidate may exist even if its order manifest was never committed. Later recovery must inspect that candidate and establish a shared disposition/publication fence before retry or refund. This slice does not implement scheduled interruption recovery, process-stop acknowledgement, or final refund arbitration.

References: [Neon deployment](https://neon.com/docs/compute/functions/deploy), [environment overrides](https://neon.com/docs/compute/functions/environment-variables), [Node worker exit](https://nodejs.org/api/worker_threads.html#event-exit), [PDF.js](https://github.com/mozilla/pdf.js).

The optional localhost acceptance fallback is `scripts/local-payment-facilitator.mjs`. Start it with private-file pointers `FACILITATOR_WEB_CONFIG` and `FACILITATOR_PURCHASER_ENV`; it binds only `127.0.0.1:3039`, accepts only the dedicated payer's exact 1 test USDC transfer to the configured merchant, and uses the official pinned x402 verifier/settler through the authenticated server RPC. Its signing key remains outside Next.js and Neon. A temporary isolated web facilitator-URL override exercises the same durable receipt gate. Preserve the original authorization and reconcile it before switching; an unknown settlement is never grounds for another signature. Restore Arcus and stop the helper after acceptance. See [ticket evidence](evidence/issue-5.md) for the specific fallback trigger and expiry reconciliation.
