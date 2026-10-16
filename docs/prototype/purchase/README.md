# Browser purchase design handoff — A: Inline checkout

Question: Where should browser purchase live in Mend’s accepted customer workspace?

This is a simulated, throwaway prototype. It does not implement payments, PDF processing, wallet authentication, browser persistence, or production QA. The user selected **A — Inline checkout** on 16 October 2026 after trying the prototype. No combination or additional changes were requested. This approves the layout direction; browser persistence remains unresolved. Return this handoff to the originating session before creating the implementation ticket. Do not promote this throwaway code.

## Selected direction and run command

Verdict: place the purchase inline above My orders, with the product, price and three-step guide beside the active task. On phones the guide precedes the task. Keep the accepted Recovery desk and existing brand. B and C remain comparison references.

Worktree: `/Users/kyler/repos/tameion-agent/.worktrees/mend-purchase-prototype`.

## Run and compare

From this worktree, run `npm run prototype:purchase` after `npm ci` if dependencies are absent. Open:

- A — inline checkout: http://127.0.0.1:3012/prototype/purchase?variant=A
- B — guided purchase: http://127.0.0.1:3012/prototype/purchase?variant=B
- C — side-by-side: http://127.0.0.1:3012/prototype/purchase?variant=C

The shared floating arrow picker changes the URL without resetting in-memory state. Left/right keys cycle when focus is outside interactive controls and dialogs. Actual browser refresh resets demo data. The development-only route and picker are unavailable in production.

A embeds purchase above My orders, keeping the product and price visible. B presents one focused purchase with a separate receipt summary. C keeps a purchase panel beside the private order list; on mobile the panel moves above the list. The real Recovery desk is unchanged. This separate prototype route reproduces the existing My orders header and workspace; it avoids wiring mock state into the live authenticated page.

## Try it

1. Use sample PDF (or choose a file; bytes are neither uploaded nor parsed).
2. Review price, limits, retention, refunds and provider access. Confirm the terms checkbox.
3. Connect demo wallet. Continue to sign a separate sign-in message. Continue again to approve the separate payment. Each request may be rejected and retried.
4. Payment enters unknown/pending. “Check existing payment” reconciles the same simulated authorization and shows receipt-confirmed processing.
5. “Preview completed conversion” simulates publication. Download sample text; download is recorded separately from result availability.
6. Expand Demo controls for wrong network, unsupported file, return/refresh, wallet changes, overdue recovery, refund delays and file expiry. State JSON is deliberately confined to these demo controls.

Real selected files get only extension/size checks; all content validation is simulated. The sample is a fixture, not a real conversion. A non-PDF or file over 10 MiB is rejected. Production must reject invalid, encrypted (including empty-password), image-only, mixed scanned/text, and over-50-page documents before payment. Blank pages in text PDFs remain allowed.

## Screen flow and primary actions

| Screen | Primary action and next state |
| --- | --- |
| Inline entry | Choose a PDF or “Use sample PDF” → review |
| Review | Accept disclosed terms → “Connect wallet to continue” |
| Connected | “Sign in to continue” → separate non-payment message |
| Signed in | “Review payment in wallet” → separate 1 test USDC approval |
| Pending / unknown | “Check existing payment” → reconcile the original authorization; no new payment |
| Receipt confirmed | Processing → verified text available, or unresolved recovery |
| Ready | “Download sample text” → tracked demo download; availability remains distinct |
| Recovery / refund pending | Explain unresolved status and registrar authority; no forced refund |
| Expired | Preserve delivery history; remove file access without inventing refund entitlement |

Connection/sign-in/payment rejection stays on the current purchase with a readable retry. Wrong network offers “Switch to Arc testnet”. “Back to My orders” keeps the attempt in the private list; reopening it continues that attempt. In production processing and reconciliation must be server-driven; the demo advances manually.

## Behavior shared by all options

- Price: exactly 1 test USDC on Arc testnet, chain 5042002. Network gas is separate and excluded from refunds. No dollar-value claims.
- Connect, sign in, and approve payment are separate actions. Private keys remain in the wallet.
- Payment approval creates one attempt. A pending outcome offers only a check of that existing attempt, never a replacement payment.
- Receipt-confirmed payment starts the 120-second delivery deadline. Processing, authenticated availability of verified text, and actual download are distinct states.
- Upload expires seven days after upload; output expires seven days after its own creation. Download/restoration do not restart either clock. Access expiry and physical deletion are separate.
- Overdue work remains unresolved; recovery may inspect/restore output. Being overdue or losing access at expiry does not automatically establish refund eligibility.
- Refund eligibility is independently verified by the registrar. Pending refunds name funding, UTC daily allowance or receipt delays without promising a completion time. Only a successful receipt confirms reimbursement to the original payer; gas is excluded. No customer force-refund control.
- Signing out or changing wallets hides private filenames, details and results immediately. Returning with the original payer requires sign-in again. Connecting alone grants no access. Demo controls can inspect synthetic fixtures and must never ship.
- Provider disclosure precedes any real upload in production. This demo sends no bytes. The existing Vercel/Neon access, minimized OpenRouter metadata, unknown upstream inference host and public wallet metadata limits remain in force.

## Future implementation seams (not implemented)

Use `app/live.tsx` for the customer workspace and existing order/result rendering. Reuse `lib/client/wallet.tsx` for connect, network correction, SIWE, session revocation and private query invalidation. Investigate browser signing against current wagmi/viem/x402 docs when implementing. Reuse the submission, completion and `/api/orders/:id/payment` APIs; mirror challenge verification and persist-before-send invariants in `scripts/submit.ts` and `scripts/purchase.ts`. Reuse authenticated `/api/orders` and result routes for original-payer recovery. Existing recovery policy and all eleven accepted interaction decisions remain authoritative.

Production must validate document contents before payment, check sale availability, retain the immutable returned policy snapshot and verify the exact amount/network/token/merchant challenge. The prototype’s fixed times and terms are fixtures, never production sources.

## Unresolved design/implementation questions

- Browser persistence: evaluate secure storage of the original order capability and exact authorization BEFORE transmission. No user-managed file. Preserve the ability to reconcile the original signed authorization after response loss; block payment if that safety cannot be established.
- Across devices, cleared browser storage, unavailable wallet signing, and unsigned/unconfirmed purchases: define recovery without exposing private data or offering a blind second payment. SIWE original-payer lookup covers confirmed ownership; it does not alone solve every unsettled-attempt case.

## Scope for a later approved ticket

Build one browser PDF purchase path and its recovery entry in My orders. Integrate wallet signing and durable attempt recovery; retain existing operational authority boundaries. Revisit human-only QA issue 32 only after the approved UI is implemented. No new checkout ticket, production deployment, paid request, model request, signature or service mutation is part of this session.

Acceptance checks for that later ticket: unsupported files blocked before charge; displayed terms match server snapshot; separate connect/sign-in/payment prompts; readable rejection/network retries; response-loss/reload preserves one order and original authorization; no second transfer/job from replay; ownership change clears private queries and pending downloads; verified result and expiry gates; overdue/refund uncertainty remains unresolved; keyboard and narrow layouts; human QA starts in the browser.

## Canonical context

- Parent: https://github.com/MrSufferer/mend/issues/19
- Independent review (closed): https://github.com/MrSufferer/mend/issues/18
- Review merge: https://github.com/MrSufferer/mend/pull/31
- Deferred human-only QA: https://github.com/MrSufferer/mend/issues/32
- Base: `f355a9393febddf9e0256f3414e6d4f3c29f36ec` (current origin/main at start).
- Capture branch: `prototype/mend-browser-purchase`.

Workspace workflow was read. This is design exploration without an active implementation ticket; no ticket checkpoint was invented and no closed issue was reopened. Before any later ticket work, use the workspace session gate. A link/comment to the implementation issue is deferred because this session explicitly must not create that issue, and no external messages are authorized.


## Approved direction captures

These capture selected A at 1440px and 375px. The user approved A as the layout direction; these state captures document that direction, rather than separate approvals for each fixture.

| State | Desktop | Phone |
| --- | --- | --- |
| Entry | [View](screenshots/approved-A-entry-desktop.png) | [View](screenshots/approved-A-entry-mobile.png) |
| Review and terms | [View](screenshots/approved-A-review-desktop.png) | [View](screenshots/approved-A-review-mobile.png) |
| Connect wallet | [View](screenshots/approved-A-connect-desktop.png) | [View](screenshots/approved-A-connect-mobile.png) |
| Sign in | [View](screenshots/approved-A-signin-desktop.png) | [View](screenshots/approved-A-signin-mobile.png) |
| Approve payment | [View](screenshots/approved-A-payment-desktop.png) | [View](screenshots/approved-A-payment-mobile.png) |
| Payment pending | [View](screenshots/approved-A-pending-desktop.png) | [View](screenshots/approved-A-pending-mobile.png) |
| Processing | [View](screenshots/approved-A-processing-desktop.png) | [View](screenshots/approved-A-processing-mobile.png) |
| Result ready | [View](screenshots/approved-A-ready-desktop.png) | [View](screenshots/approved-A-ready-mobile.png) |
| Overdue recovery | [View](screenshots/approved-A-recovery-desktop.png) | [View](screenshots/approved-A-recovery-mobile.png) |
| Refund pending | [View](screenshots/approved-A-refund-desktop.png) | [View](screenshots/approved-A-refund-mobile.png) |
| Expired result | [View](screenshots/approved-A-expired-desktop.png) | [View](screenshots/approved-A-expired-mobile.png) |

## Comparison captures and validation

Comparison screenshots (not approved-design evidence):

| Variant | Desktop | Phone | Review desktop | Review phone |
| --- | --- | --- | --- | --- |
| A | [Entry](screenshots/purchase-A-desktop.png) | [Entry](screenshots/purchase-A-mobile.png) | [Review](screenshots/purchase-A-review-desktop.png) | [Review](screenshots/purchase-A-review-mobile.png) |
| B | [Entry](screenshots/purchase-B-desktop.png) | [Entry](screenshots/purchase-B-mobile.png) | [Review](screenshots/purchase-B-review-desktop.png) | [Review](screenshots/purchase-B-review-mobile.png) |
| C | [Entry](screenshots/purchase-C-desktop.png) | [Entry](screenshots/purchase-C-mobile.png) | [Review](screenshots/purchase-C-review-desktop.png) | [Review](screenshots/purchase-C-review-mobile.png) |

TypeScript passed. Browser checks passed separate connection/sign-in/payment, connection and payment rejection/retry, pending return/re-authentication, existing-payment reconciliation, download, wallet switch privacy, original-payer return, URL/keyboard variant switching with preserved state, and actual refresh resetting fixtures. All three entry/review layouts fit 375px and 1440px. The full selected A flow, including wallet dialogs, pending, processing, result, recovery, refund and expiry, also fits at 375px and 1440px. Browser instrumentation observed zero `/api/` requests during the simulated flow.

No prototype test suite was added. Existing shared wallet-connector optional-module build warnings were observed; the prototype does not mount those live providers. Production integration and human-only QA remain untested and deferred.

The capture commit is recorded below after committing the prototype. No remote publication or issue comment was made.
