# Issue #3 acceptance evidence

The live root, `/orders`, and `/recovery` use real database-backed access. The archived prototype remains synthetic. This ticket establishes verified authorization of unpaid drafts; payment, conversion and operator money actions remain dependent tickets.

## Local acceptance

The combined Playwright run against the real restricted Neon web role and private storage passed 24 tests, with the existing policy-mutation scenario skipped because no policy fixture was enabled. This includes all six HTTP authentication cases, ten injected-wallet browser cases and eight order regressions, including the exact 10 MiB upload. Disposable EOA fixtures sign real messages; browser connection, signing and server verification are exercised together.

An additional browser check passed for visible loading, a readable network failure and retry against the real orders endpoint. `npm run typecheck`, `npm run build` and `git diff --check` passed. The production build includes the inherited hosted PDF-worker packaging fix.

HTTP coverage verifies canonical domain/URI/version/chain/address, browser binding, genuine signatures, Origin rejection, nonce replay and concurrent consumption, challenge/session expiry, replacement-session revocation, atomic cross-wallet claim, capability-plus-session requirements, private upload authorization, submission replay and safe customer DTOs. Browser coverage verifies separate connection/authentication, rejection, wrong network, account switching, an account switch during a held signature, operator denial and the configured operator's genuine empty queue, expired challenge/session messages, keyboard actions and layouts at 375/768/1280 pixels.

Two browser regressions were reproduced before their fixes: returning focus from a wallet prompt canceled the pending current-wallet signature; an already-issued download response could open after switching wallets. The current identity guards pass both cases. Existing signed download grants remain bearer grants for their bounded lifetime; wallet changes prevent a pending UI action from opening one.

The TDD sequence began with a real HTTP sign-in failing at the missing endpoint, then the atomic claim/privacy test failing at the missing claim route. Each became green after its corresponding implementation. The first browser connection test failed on the archived prototype before the live wallet flow was added.

The auth migration was applied with the separate owner subprocess. No owner credential or signer key enters the web process. Expiry fixtures modify only disposable challenge/session records from a separate local fixture subprocess. No customer document is used in tests, and traces are disabled to avoid recording capabilities, cookies or signed storage grants.

Hosted acceptance is performed separately after deployment. `tests/auth.spec.ts` supports `TEST_AUTH_ORIGIN` for the canonical deployment origin and `TEST_BASE_URL` for the protected-preview proxy; wrong-Origin cases remain effective. Local expiry/operator fixtures are skipped when absent. See [wallet access](wallet-auth.md) for configuration, API interfaces and the claimed-order programmatic authentication boundary.
