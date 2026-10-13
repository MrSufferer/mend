# Private unpaid submissions — issue #2

This slice validates and durably records a purchase before payment. It does not settle x402, process a paid job, invoke a model, or claim a wallet identity. Those are dependent tickets.

## Run

Use Node 22.13+ and `npm ci`. Load only the web role's `DATABASE_URL`, private web storage `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `UPLOAD_BUCKET` into the web environment. A restricted web `DATABASE_URL_UNPOOLED` is optional; the migration-owner URL is never a web credential. Do not load management API keys or wallet private keys.

Run `npm run dev`. Then:

```sh
npm run submit -- http://127.0.0.1:3000 document.pdf .mend-submission.json
```

The client creates a mode-0600 private recovery-state file **before** its first request. It prints the disclosed terms, uploads directly to private storage, and prints the persistent unpaid order. Rerun with the same PDF and state file after a lost response. The same document recovers the same order; a changed document requires a new state file. Keep that file private: its 256-bit bearer capability authorizes that unpaid submission and order. The server persists only its SHA-256 hash. The default `.mend-*.json` files are gitignored.

For the hosted API replace the local origin with the Vercel generated HTTPS URL. The direct storage upload supports the full 10 MiB accepted size while avoiding Vercel's request and response payload limits; PDF bytes do not transit a multipart Vercel request.

## HTTP interface

Every private request uses `Authorization: Bearer <64 lowercase hex characters>`. Generate the 32 bytes with a cryptographic random source and save them before submitting.

1. `POST /api/submissions` with JSON `{ "idempotencyKey": "stable-client-key", "size": 1234, "sha256": "lowercase-hex-of-pdf" }` returns the disclosed terms and a private signed PUT grant expiring within 15 minutes. The same capability and idempotency key recover the submission or its accepted order. Different bytes with an existing key return 409.
2. PUT the exact PDF bytes to `upload.url` using `upload.headers`. The URL is a secret capability; never log it or put it in an issue. The signed request includes the declared content length. Storage remains private, including while an unvalidated document is staged.
3. `POST /api/submissions/:id/complete` validates size, declared SHA-256, PDF structure, encryption (including empty-password encryption), maximum 50 pages, and text-based content. Image-only/scanned documents and scanned pages mixed into text documents are rejected; blank pages in an otherwise text-based document are permitted. A rejection creates no order or payment and deletes its current staged object. An accepted document is copied to a server-only key, so the still-live staging grant cannot overwrite it.
4. `GET /api/orders/:id` returns only the authorized order, its unpaid status, snapshotted terms and upload expiry. Another capability receives 404; missing capability receives 401. Neither submission nor inspection starts processing.
5. `GET /api/orders/:id/upload` returns an ownership-gated signed GET grant valid for at most 60 seconds and never beyond the upload expiry. The client downloads directly from storage. An unsigned storage GET is denied. Possession of a signed grant authorizes its use until expiry; keep it private.

Accepted upload retention starts at the storage upload timestamp, not validation, restoration, or download. The API refuses new download grants after seven days. Output creation/expiry and automated seven-day physical deletion belong to the retention lifecycle ticket #15; no output is created here. `npm run storage:purge-staging` is a trusted local maintenance command using the restricted web DB/storage environment. It deletes abandoned/rejected/accepted staging copies and uncommitted accepted objects only after their upload windows plus a five-minute in-flight margin have expired. Operational records remain. Schedule it when wiring the full retention sweeper; without invocation abandoned staging is not automatically deleted.

## Migrations and future policy configuration

Load the separate **local migration-owner** `DATABASE_URL_UNPOOLED` only for `npm run db:migrate`. Drizzle Kit's checked-in SQL/journal/snapshots are the source of versioned migration history. `npm run db:generate` creates subsequent migrations; never use push against the deployed database.

The migration grants `mend_web` SELECT on this slice's records, INSERT on submissions/orders, UPDATE only on `submissions.rejected` and `orders.owner_wallet`. It grants the conversion, registrar, and worker roles SELECT only on orders. They cannot edit snapshotted terms or recovery policies. Future tickets must add only their required column/function privileges. Owner credentials and signer keys are unnecessary for runtime.

Using only the local owner environment, configure future obligations:

```sh
npm run policy:set -- 120 1 10
```

Arguments are delivery seconds (1–120), maximum retries (0–1), and test-USDC automatic-refund allowance per UTC day. Configuration inserts a new immutable policy version. Terms are frozen on initial disclosure and copied unchanged to the accepted order; later configuration does not modify existing disclosed or purchased terms. The normal policy remains 1 test USDC, 120 seconds from confirmed payment and at most one retry. Retention, gas exclusion, provider exposure, and operator/registrar dependence are disclosed before the upload is accepted. A deadline alone never establishes a refund entitlement.

## Ownership integration for #3

`lib/server/orders.ts` owns the order-access boundary. `orders.ownerWallet` is NULL here: a bearer capability establishes possession of an unpaid submission, not a paying-wallet claim. Ticket #3 must require both the existing capability and a verified SIWE wallet session to bind an unclaimed order, atomically preventing rebinding to another wallet. Session-based list, inspection, and download authorization must compare the stored wallet with the verified session, never with an address supplied in a header or JSON. Payment later must match that proved identity.

## Verification

`npm run test:api` runs Playwright HTTP tests against real Neon PostgreSQL and private Neon storage, without mocked database/storage adapters. To run against deployed hosting set `TEST_BASE_URL`; no database credentials are then needed in the test process. The optional policy-update scenario requires `POLICY_TEST_ENV_FILE` pointing to a local migration-owner env file; the file is read only for local test setup and its owner URL is passed only to the policy subprocess and never forwarded to the web server. Do not enable this configuration-changing scenario on an active public merchant.

Coverage includes valid uploads, exact 10 MiB direct upload, invalid/scanned/encrypted and over-page-limit rejection, document mismatch, duplicate/concurrent recovery, cross-capability denial, anonymous storage denial, immutable accepted bytes, preserved disclosure when future policy changes, and no processing/payment before confirmation. Traces are disabled to avoid publishing bearer headers or signed URLs; fixtures contain synthetic data only. `npm run typecheck` and `npm run build` verify the pinned application stack. Encrypted fixtures were generated with pypdf using a synthetic blank page and RC4-128, with both a nonempty and empty user password. PDF extraction uses the pinned Apache-2.0 PDF.js distribution; no customer documents are used in tests.
