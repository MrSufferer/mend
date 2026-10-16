# Purchase a document order

For the inline browser flow and durable browser recovery, see [Purchase and retrieve a document](release-customer.md). The programmatic flow below remains supported.

`npm run submit -- https://your-preview.example document.pdf private-state.json` creates a private unpaid order and saves its capability. With `MERCHANT_ADDRESS` set to the trusted public recipient and `TEST_PURCHASER_PRIVATE_KEY` loaded only in the purchaser process, run:

```sh
npm run purchase -- https://your-preview.example private-state.json
```

Keep the state file private. The client validates Arc testnet, the USDC interface, exact `1000000` six-decimal units, EIP-712 token domain, and the configured merchant before signing. It saves the exact signed authorization before submitting. Rerun with the same state file after a timeout, lost response, pending result, or interruption. A saved payment is never replaced by a new signature. The signing key and authenticated RPC never belong in browser configuration or deployed web credentials.

`POST /api/orders/:id/payment` requires the original private order capability. A request without `PAYMENT-SIGNATURE` returns HTTP 402 and a base64 `PAYMENT-REQUIRED` v2 exact challenge. The client returns a base64 signed ERC-3009 payload in `PAYMENT-SIGNATURE`. Confirmed purchases return 200 and `PAYMENT-RESPONSE`; unknown outcomes return 202 with payment status `pending`. Repeating either request reconciles the stored authorization. A different authorization for an existing attempt, or the same authorization used on another order, returns 409.

The durable order has one payment attempt. Its unique `(payer, nonce)` prevents reuse across orders before settlement; unique transaction constraints prevent receipt reuse. Verified authorizations are stored before calling Arcus. Concurrent requests claim a bounded settlement lease. After an interrupted call, reconciliation queries the original authorization nonce from the persisted pre-submission block. A lease retry can submit only that same signed authorization: ERC-3009 nonce consumption prevents a second transfer. Expired or indeterminate attempts remain pending and require reconciliation; no replacement payment or refund entitlement is inferred from a timeout.

Payment confirmation requires the authenticated server RPC to report chain 5042002, a successful receipt, the exact USDC `AuthorizationUsed` nonce, and the six-decimal transfer from the original payer to the configured merchant. The confirmed block timestamp starts the purchased deadline. Receipt evidence stores block/hash, transfer amount/decimals, and native gas data. Native USDC uses 18 decimals, while this ERC-20 facade uses 6 for the same funds. Native gas data must never be added to the purchase amount or converted as six-decimal USDC.

A successful payment binds browser ownership to the original paying EOA. SIWE with that EOA recovers the order through the existing authenticated status API. The capability remains usable for payment reconciliation; it does not grant claimed-order document downloads. A receipt-confirmed purchase now invokes conversion through the server-only conversion binding. The durable initial generation, bounded retry, output publication and recovery use the original confirmed-payment deadline. Missing service configuration is a deployment failure, not proof of completed processing. See [current release setup](release.md) and [paid conversion](pdf-conversion.md).

Server configuration: `MERCHANT_ADDRESS`, `X402_FACILITATOR_URL` (Arcus first), `ARC_RPC_URL`, and the existing web-role database/storage/session settings. Web execution requires no purchaser, merchant, administrator, registrar, or recovery-worker signing key. Apply versioned Drizzle migrations using the isolated migration role.

For repeatable acceptance, set `PAYMENT_TEST_PURCHASER_ENV` to a dedicated local purchaser-role file and run `npm run test:payments`. The live test caches its private order/signature under `/private/tmp`; reruns reconcile the original purchase. `PAYMENT_TEST_STATE_FILE` selects a fresh private state file for a new authorized test purchase. `node scripts/test-payment-response-loss.mjs` proxies real Arcus calls and discards a successful settlement response, exercising nonce-based reconciliation. This driver does not simulate settlement or receipts.
