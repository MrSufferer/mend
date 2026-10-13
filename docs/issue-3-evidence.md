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

## Hosted acceptance

The merged preview at `6a78a79` passed 13 HTTP tests against real restricted Neon and private storage, including the 10 MiB upload, and nine injected-wallet browser cases. Four fixture-dependent cases were skipped on the hosted environment: owner-only policy mutation, forced HTTP expiry, disposable configured-operator browser access and forced browser expiry. Those cases were exercised locally.

The browser download assertion first produced a false positive because it classified preview-proxy requests as external using a hardcoded local port. Its corrected grant-specific assertion passed on the deployed preview; signed grants are held in memory and not logged. See [review fixes](review-fix-evidence.md).

Final Preview: https://mend-9vy0nh2lb-gadillacers-projects.vercel.app (deployment `dpl_4U4mAcvZZKoFyxBGFBBB61XP3etw`, source `1c508cc7e89f67895e5329eeea4179f3ff06ea5a`). Vercel reported `READY`, target `preview`, and the production build passed. Four focused browser regressions passed on this reviewed deployment: account switching revokes and hides private data; narrow layouts/keyboard access; wallet-prompt focus; pending private download after switching accounts. Computed live button weight is 500, with no desktop horizontal overflow.

The existing Preview protection remained enabled. Testing used a temporary automation bypass confined to a local forwarding proxy, with the bypass revoked after acceptance. No owner database credential or private wallet signer was deployed.
