# Wallet access — issue #3

Connection and authentication are separate. The browser uses wagmi's injected EOA connector on Arc testnet (chain 5042002), then signs a server-issued SIWE message using viem. Signing in does not make a payment. Smart-contract wallet verification is outside this slice.

## Configuration

The web role needs `SESSION_SECRET` (at least 32 characters), `OPERATOR_WALLET_ADDRESS`, and the database/private-storage configuration from issue #2. Set `APP_ORIGIN` to the exact trusted origin with no trailing slash, including a local port when applicable. HTTPS is required except explicit localhost/127.0.0.1 development. On Vercel, absent `APP_ORIGIN` uses provider-controlled `VERCEL_URL`. Caller Host and forwarded-host headers are never trusted. Private RPC credentials are not sent to the browser; the injected wallet uses its own Arc connection.

Apply the checked-in Drizzle migration using the separate migration owner, then start with the restricted web environment. The owner never belongs in a deployed environment. The new auth tables grant the web role only SELECT/INSERT and the challenge-consumed/session-revoked update columns. The normal web role's existing owner_wallet update grant is used for atomic unpaid claims.

## HTTP access

- `POST /api/auth/challenge` takes `{address,chainId}` and returns `{challengeId,message,expiresAt}`. A five-minute HttpOnly browser-binding cookie accompanies the issued challenge. The server persists its exact canonical message, cryptographic nonce, expected wallet and expiry.
- `POST /api/auth/verify` takes `{challengeId,message,signature}`. Exact message equality, SIWE domain/scheme/URI/version/chain/issuedAt/expiry, browser binding, and actual EOA signature must all pass. Challenge consumption and session insertion are one atomic SQL statement guarded by database expiry. A concurrent verification creates exactly one session; a successful replacement revokes the old session.
- `GET /api/auth/session` returns only wallet, chain, customer/operator role and expiry. An opaque random HttpOnly cookie references a database session; its stored digest uses the provisioned session secret. Sessions have a fixed 24-hour lifetime and cannot be extended by browser input. Cookies are Secure on HTTPS and SameSite=Lax.
- `POST /api/auth/logout` revokes the persisted session and clears both cookies. All browser auth mutations and wallet claims require the exact configured Origin header. Session and private order responses are private/no-store.
- `POST /api/orders/:id/claim` requires **both** the order's existing 256-bit bearer capability and a live verified SIWE session. A conditional row update binds an unclaimed unpaid draft to that wallet; a different wallet cannot rebind it. Repeating the same claim by the owner is safe. Claim establishes authorized draft access, never a confirmed payer or payment.
- `GET /api/orders` lists only the session wallet's claimed orders, newest first, up to 100. Detail/download routes accept a capability for unclaimed drafts. Once claimed, they require the same verified wallet session, including submission recovery/completion replay. A bearer capability alone no longer accesses a claimed order. Programmatic clients can sign the same SIWE HTTP flow and retain its cookie jar; spoofed wallet headers do not authenticate them.
- `GET /api/operator/orders` requires the configured operator session. Its genuine queue excludes unpaid drafts and resolved orders. There are no paid obligations in this implementation slice, so the desk is empty. Refund, recovery and purchase controls are later tickets.

Customer DTOs contain status, plain next steps/timeline, disclosed terms and retention/payment facts. They omit capability hashes, object keys, document bytes, operational evidence and other-wallet diagnostic information. Foreign orders return the same 404 as missing orders. Signed private-download grants are limited to 60 seconds and the original retention expiry; existing grants remain capabilities until their bounded expiry.

The root and `/orders` show live customer access; `/recovery` is the operator desk. `/prototype/mend` remains clearly synthetic and is not the live application. The approved Signal Teal tokens and Geist/Geist Mono are reused. Account/network changes immediately hide private views, cancel/remove private query entries, revoke the previous session and require a fresh signature. Pending signatures are guarded against account changes. Focus rechecks expiry/revocation; sign-out propagates across tabs.

## Acceptance tests

`npx playwright test tests/auth.spec.ts tests/wallet-browser.spec.ts` runs real HTTP/database/storage and browser tests. Load only the web role's environment into the test server. The injected EIP1193 browser fixture signs actual EIP191 messages using disposable synthetic EOA keys; it does not mock wagmi or bypass the verification route. Traces are disabled because session cookies, capabilities and signed storage grants are private.

For local challenge/session expiry fixtures set `AUTH_FIXTURE_SETUP=1` and point `AUTH_FIXTURE_OWNER_ENV` at the separate local migration-owner environment. That file is read exclusively by the fixture subprocess; no owner credential is forwarded to the web server. For the operator browser case set `TEST_OPERATOR_ADDRESS` and the server's `OPERATOR_WALLET_ADDRESS` to the disposable fixture wallet selected by the test. Hosted acceptance uses the configured real operator and separate local signing, not a deployed private key.
