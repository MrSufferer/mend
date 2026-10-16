# Provider result restoration reference

This is a runnable integration of Mend's restoration API and a controlled JSON-to-CSV provider. It demonstrates provider registration and recovery after an interrupted original response. Both HTTP services and the local payment authority are Mend-operated. **This does not prove independent adoption, live x402 settlement, or production readiness.** BlockRun access remains tracked in [#44](https://github.com/MrSufferer/mend/issues/44); this implementation is [#46](https://github.com/MrSufferer/mend/issues/46).

Use Node 24+ (the built-in `node:sqlite` API is experimental in Node 24.10). From the repository:

```sh
npm ci
npm run test:provider-restoration
npm run provider:demo
```

The demo starts two loopback HTTP listeners, prepares a request and controlled payment receipt, persists their identifiers, commits and registers the CSV, and deliberately destroys the initial response. It then signs a Mend challenge with the original local demo wallet and verifies the recovered bytes. It checks one execution and one controlled payment. Successful output explicitly includes `independentProviderProof: false` and `liveX402Proof: false`. No blockchain, faucet, external provider, deployment, or existing PDF database is involved.

The runner hosts both listeners in one process. Tests stop and reopen both service instances against their persisted databases. These are service-lifecycle restart checks, not OS crash, power-loss or multi-host failover tests.

State defaults to `.provider-state/`, excluded from git. Set `PROVIDER_DEMO_STATE` to a private durable directory to choose another location. The local wallet key, shared provider credential, retained bytes and receipt records are private. Never fund the generated wallet or reuse these credentials elsewhere. A failed identity-file read never replaces an existing credential. Delete the directory only when deliberately discarding the entire controlled demonstration; rerunning the demo creates a new controlled purchase with a one-hour retention term.

## Integration contract

`services/provider-restoration/restoration.ts` exports `startRestoration`, `registerResult`, `Settlement` and `Provider`. `csv-provider.ts` is the concrete second service. They can be hosted by independent Node processes; the supplied demo is a local two-listener harness. The services bind only to `127.0.0.1`. Use a protected durable single-host environment with TLS termination for any further deployment work; an ephemeral Next.js/serverless filesystem is unsuitable. This iteration does not add a hosted API, My orders entry or frontend card.

Enrollment is a static allowlist passed to `startRestoration`: provider ID, service identity, merchant, network, exact amount, a server-to-server credential, a payment-authority adapter, and a purchased-result validator. There is no public enrollment endpoint, user-controlled fetch URL, automatic provider discovery or credential provisioning.

The controlled adapter queries the configured provider's authenticated, durable local receipt ledger. This receipt is **simulated payment evidence**, not a chain receipt. The receipt binds request, payer, service, input digest, amount, merchant, network, paid timestamp and original expiry. Mend checks these against its configured service and incoming registration. A live adapter must independently establish settlement and durable request correlation before it returns `confirmed: true`; do not reuse the demo adapter for an actual provider. On unavailable, missing or conflicting evidence, registration fails closed.

The provider's public HTTP surface is intentionally developer-only and requires its credential on every endpoint:

| Endpoint | Purpose |
| --- | --- |
| `POST /requests` | Persist wallet and immutable flat JSON input; return request ID before payment. |
| `POST /test/receipts` | Create exactly one controlled receipt for the matching wallet and request. No money moves. |
| `GET /test/receipts/:id` | Authority lookup used only by the configured controlled adapter. |
| `POST /requests/:id/purchase` | Commit the result once, then register the exact persisted result with Mend. Same receipt/request replays reconcile registration and return original bytes. `interrupt: true` induces a post-registration socket interruption. |
| `GET /requests/:id` | Report execution count and controlled-payment count for conformance checks. |

Mend's surface:

| Endpoint | Authorization and behavior |
| --- | --- |
| `POST /registrations` | Provider credential. Accepts `providerId`, `requestId`, `receiptId`, `inputDigest`, `expiresAt`, `result`. Immutable, idempotent, payment-verified registration; conflicting reuse returns 409. |
| `POST /challenges` | Accepts `providerId`, `requestId`, `wallet`; issues a 60-second challenge without disclosing whether a private order exists. |
| `POST /recover` | Accepts `nonce`, EIP-191 `signature`; atomically consumes a challenge and returns CSV only for the original payer. Unknown, wrong-owner and expired results all return 404. |

Wallet authorization supports EOA message signatures. The signed message contains audience, provider, request, wallet, nonce and expiry. No bearer order ID grants access. All results and errors use `private, no-store`; contents and signatures are not logged. Challenges are single-use, survive service restart until expiry, and have a global 10,000 outstanding cap. This is not a production rate limiter.

The reference service accepts at most 12 KiB of row input, with 1–100 flat JSON rows and at most 32 columns; CSV output is at most 32 KiB and JSON requests at most 64 KiB. Cells escape CSV quotes and prefix spreadsheet formula markers with an apostrophe. NUL characters in cells or headers are rejected before purchase. Missing cells become empty fields. The configured result validator requires nonempty CSV ending in CRLF without NUL. It is a declared structural check, not an independent proof that output is semantically correct for the input. The input hash and result digest bind the registered artifact to the purchased request.

## Durability and retention

Both services use private SQLite databases, WAL mode, full synchronous writes and short transactions. The provider commits input correlation, paid result and execution state before network registration or original delivery. A registration failure returns 503 but preserves the result; replaying the same purchase reconciles it without another execution. Mend retains the bytes locally, so successful restoration makes no provider execution or payment call. Receipt IDs cannot be reused across requests.

Purchased retention is fixed by the receipt and cannot be extended by replay or changed deployment defaults. It is capped at 24 hours in this reference. Expired bytes are redacted lazily on the next API operation or service startup, while correlation tombstones remain to prevent reuse. Draft input expires after 24 hours. This is not a guarantee of physical deletion: SQLite WAL, free pages and backups may retain prior content. A production retention design needs encrypted storage, scheduled cleanup, backup rules and tombstone archival. No expiration establishes refund entitlement or recovery success.

## Remaining gates

The controlled conformance suite covers interruption, service restart, concurrent recovery and purchase replay, wrong-wallet and altered-signature access, single-use and expired authorization, immutable terms, conflicting registration, unavailable evidence, cross-request receipt reuse, failed-registration reconciliation, expiry, input limits and escaping.

Independent provider participation, delegated access, authenticated execution/result evidence, genuine testnet x402 settlement, provider-specific validators, operations/enrollment and hosted customer entry remain separate work. Retry, refund and pause are absent capabilities. Existing PDF payment reconciliation and UI are unchanged. Production scalability, multiple writers across hosts, service credential rotation, abuse controls, secure deletion and crash/fault injection are not claimed.
