# Ticket #4: receipt-confirmed x402 purchase

Acceptance run: 2026-10-14 (Asia/Ho_Chi_Minh). This evidence covers the purchase slice; processing is deliberately still gated for ticket #5.

## Real Arcus integration gate

The official x402 v2 exact client signed an ERC-3009 authorization for `1000000` six-decimal units of the Arc testnet USDC facade, paid directly by the dedicated purchaser EOA to the configured merchant. The web server used Arcus and the authenticated server RPC. The RPC reported chain `5042002`; the token interface reported name `USDC`, version `2`, and decimals `6`.

- [Initial successful purchase receipt](https://testnet.arcscan.app/tx/0xbeba789acb09ad312faf9d8bce6a7f886186146c857d1f13558dd5fa773fdc07), block `67022284`.
- [Successful purchase with lost facilitator response](https://testnet.arcscan.app/tx/0xdca467abe980a7f1fd054bedd303984e63335532658bd78b03452d2f47c0dae6).

For both purchases, confirmation required a successful receipt containing the original payer's exact `AuthorizationUsed` nonce and an exact `Transfer` of `1000000` facade units to the merchant. The order records the receipt block/hash, amount and six-decimal denomination, native gas data, payer, transaction, and confirmed block timestamp. The separate native-USDC gas transfer uses 18 decimals and is not counted toward the purchase amount. A transaction hash alone never unlocks processing.

Arcus settled successfully, so the conditional self-hosted fallback was unnecessary. A transient Arcus verification rejection occurred before the response-loss run succeeded; no settlement was reported for that rejected attempt.

## Response loss and durable reconciliation

`node scripts/test-payment-response-loss.mjs` forwarded real verify/settle requests to Arcus, then discarded the socket response after Arcus reported successful settlement. The proxy observed exactly one successful settlement. The application received no settlement transaction response and recovered the receipt through the persisted payer/authorization nonce and pre-submission block. Concurrent requests and repeated submissions of the same saved authorization converged on the same paid order. Reusing that authorization on another fresh order returned `409`.

The runnable client persists the original order capability and signed payment before submission and reuses them on retries. The web role has no purchaser or merchant signing key. Database migration and purchaser credentials were loaded in separate local processes; authenticated RPC credentials remained server-side.

## Verification

- Purchase lifecycle: real database-backed Playwright challenge, exact receipt, concurrent replay, lost response, and cross-order authorization reuse checks passed. Cached private payment state allows repeated checks without another charge.
- Runnable `scripts/purchase.ts` reconciled the initial confirmed purchase from saved private state without a signing key, returning the same receipt and `processingStarted: false`.
- Authentication plus purchase regression: 7 passed, 1 skipped. The skipped existing session-expiry case requires its optional expiry fixture.
- Submission/order regression: 8 passed, 1 skipped. The skipped existing policy-overlap case requires its optional policy fixture.
- Versioned migrations `0003` and `0004` applied with the isolated migration role. The deployed web role successfully inserted and reconciled payment attempts and receipt fields.
- TypeScript and production build passed.

Private synthetic document state, signed authorizations, purchaser keys, and RPC credentials are excluded from this evidence and from Git. Tests used synthetic PDFs and local execution against the actual configured database/storage/Arc services.
