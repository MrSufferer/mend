# Mend: agent recovery for x402-paid API orders on Arc

## Problem Statement

A customer can pay for an asynchronous API job and still receive no usable result. The merchant must reconstruct payment, execution, and delivery evidence before deciding whether to restore a result, wait, retry, or refund. Blind retries can duplicate work or charges; continued sales during an incident can create more unresolved obligations.

The immediate goal is the fastest publicly deployed, working product on Arc testnet that demonstrates genuine agent-operated recovery of x402-paid orders. Customer recruitment, market validation, and production-money readiness are not shipping gates.

## Solution

Mend operates one built-in merchant selling asynchronous PDF-to-text conversion for 1 test USDC per order. A runnable programmatic client purchases jobs through x402. Customers use wallet-authenticated browser pages to track orders and download results; the merchant uses a private operational dashboard.

A tool-using LLM agent investigates unresolved paid orders and chooses permitted actions: restore existing results, monitor running work, retry safely, request a refund, or pause sales. Deterministic handlers and a separately funded refund-reserve contract enforce its authority. The agent verifies outcomes and records supporting evidence.

The first release demonstrates actual PDF processing and Arc testnet payments and refunds, including clearly labeled injected failures. Deterministic recovery alone or an LLM that merely narrates predetermined outcomes does not satisfy this specification.

## User Stories

1. As an API customer, I want a runnable client that purchases and submits a document job through x402, so that I can use the paid API programmatically.
2. As an API customer, I want the price and purchased terms before payment, so that I understand the obligation the merchant accepts.
3. As an API customer, I want unsupported documents rejected before payment, so that I do not pay for work the service cannot perform.
4. As an API customer, I want a persistent order identifier, so that a lost response does not prevent me from finding my purchase.
5. As an API customer, I want repeated requests to reconcile an existing purchase, so that communication failures do not cause duplicate charges or jobs.
6. As an API customer, I want to authenticate with my paying wallet, so that only I can access my documents and results.
7. As an API customer, I want to track payment, processing, recovery, and final disposition, so that I know what is happening to my purchase.
8. As an API customer, I want a verified downloadable text result, so that I receive the work I purchased.
9. As an API customer, I want completed results restored when delivery fails, so that unnecessary reruns do not delay me.
10. As an API customer, I want ongoing work monitored, so that a temporary delay does not trigger duplicate execution.
11. As an API customer, I want failed work retried safely within the delivery deadline, so that recoverable failures can still produce my result.
12. As an API customer, I want an eligible failed order refunded to its original payer, so that the purchase obligation is resolved correctly.
13. As an API customer, I want refund receipts and pending-refund status, so that I can distinguish a requested refund from money actually returned.
14. As an API customer, I want uncertain cases visibly unresolved, so that the system does not claim success without evidence.
15. As an API customer, I want retention and gas-refund terms disclosed, so that I understand download availability and refund amounts.
16. As a merchant operator, I want a private dashboard of unresolved orders, so that I can see outstanding delivery and refund obligations.
17. As a merchant operator, I want evidence and action histories for each case, so that I can audit the agent's decisions.
18. As a merchant operator, I want the agent to investigate and execute recovery tools, so that routine cases do not require manual reconstruction.
19. As a merchant operator, I want related failures investigated together, so that recovery addresses an incident across affected orders.
20. As a merchant operator, I want configurable recovery policies preserved per purchase, so that later edits do not silently change purchased terms.
21. As a merchant operator, I want to fund a limited refund reserve, so that the worker cannot spend unrestricted merchant funds.
22. As a merchant operator, I want refunds restricted by entitlement, payer, amount, and cumulative allowance, so that the agent cannot expand its own authority.
23. As a merchant operator, I want purchases paused when failures spread, so that the service stops creating unresolved obligations.
24. As a merchant operator, I want purchases paused when eligible refunds cannot be funded or authorized within the allowance, so that exposure does not continue growing.
25. As a merchant operator, I want existing paid orders recovered while sales are paused, so that pausing does not abandon customers.
26. As a merchant operator, I want to resume sales after a successful health check, so that reopening is deliberate.
27. As a merchant operator, I want cases escalated when evidence or agent execution is insufficient, so that uncertainty remains visible for review.
28. As a merchant operator, I want pending refunds retried when funding and allowance permit, so that resolved capacity constraints do not leave customers waiting indefinitely.
29. As a merchant operator, I want worker restarts and repeated events to preserve recovery state, so that crashes cannot duplicate actions.
30. As a merchant operator, I want document contents kept off-chain and deleted on schedule, so that operational records do not become permanent document storage.
31. As a product reviewer, I want a normal purchase and reproducible recovery demonstrations, so that I can verify the complete workflow.
32. As a product reviewer, I want injected failures clearly identified, so that demonstrations are not presented as real customer incidents.
33. As an API customer, I want a clear wallet connection and sign-in flow with readable rejection and expiry messages, so that I can access my orders without guessing what failed.
34. As an API customer, I want switching accounts to recheck my access, so that another wallet cannot inherit my authenticated documents.
35. As an API customer, I want overdue orders to remain visible after hosting interruptions, so that delayed recovery does not hide the merchant's obligation.
36. As an API customer, I want contract and transaction links with amounts labeled as test USDC, so that I can inspect onchain evidence and understand the demonstration's limits.
37. As an API customer, I want to understand which providers see my data and how long downloads remain available, so that I can make an informed choice before submitting a document.
38. As an API customer, I want usable keyboard and narrow-screen flows, so that I can track orders and download results on my device.
39. As a merchant operator, I want model-budget exhaustion to preserve deterministic reconciliation and already-authorized refunds, so that an agent failure does not abandon existing obligations.
40. As a merchant operator, I want repeatable tests of interrupted and concurrent recovery, so that changes do not introduce duplicate charges, jobs, or refunds.
41. As a product reviewer, I want verified reserve source and recorded deployment inputs, so that I can relate deployed behavior to the reviewed implementation.
42. As a product reviewer, I want an independent release report with reproducible findings and explicit untested checks, so that a deployed page is not mistaken for a validated product.
43. As a product reviewer, I want the powers of the administrator, registrar, worker, merchant, and infrastructure providers documented, so that I can assess what the system guarantees and where it still depends on operators.
44. As a project maintainer, I want documented build inputs, licenses, configuration, migrations, and contract interfaces, so that another developer can reproduce and inspect the release.

## Implementation Decisions

- Build one merchant and one supported service. Accept text-based PDFs up to 10 MB and 50 pages. Reject scanned, encrypted, invalid, and over-limit documents before payment. Produce downloadable plain text through local processing; external processing providers are not required.
- Use Arc testnet and real test USDC settlement. A working programmatic x402 client is mandatory; browser x402 checkout is not a first-release requirement.
- Attempt x402 v2 exact settlement through Arcus first. Its live supported-networks response advertised Arc testnet during discovery, but successful settlement has not been tested. Gate integration on an actual testnet payment. Investigate self-hosted settlement using the official x402 implementation if necessary.
- Settle directly from the payer to the merchant. This replaces the earlier proposal for a custom purchase contract. Retain a separate refund-reserve contract.
- Persist the order before settlement and bind verified payment evidence to that order. Start processing only after confirmed settlement. Recover through ambiguous settlement responses without initiating another charge blindly.
- Use durable order and action records, transaction references, and reconciliation to survive restarts and repeated events. Each purchase must have an unambiguous payment association; reusing a receipt must not authorize another order.
- Separate service execution, payment reconciliation, recovery tools, agent orchestration, and reserve enforcement behind narrow interfaces. The confirmed stack is TypeScript/Node.js, Next.js on Vercel, Neon Functions backend execution, Neon PostgreSQL with Drizzle ORM and Drizzle Kit migrations, and private Neon Object Storage. Render is a backend-only fallback. Remaining libraries, compatible versions, and internal schemas are delegated implementation choices subject to current documentation and working integration checks; changes to cost, scope, or trust boundaries require revisiting the decision.
- Use viem for chain access and SIWE verification, and wagmi with TanStack Query for browser wallet state. Start with an injected-wallet connector. Wallet connection does not itself establish an authenticated server session; account changes must not inherit another payer's access.
- Use Solidity with Arc Foundry and pinned OpenZeppelin Contracts 5.x for the reserve. Apply SafeERC20, AccessControl, and ReentrancyGuard where applicable; share ABI artifacts from the pinned contract build. Preserve Arc's distinct native-USDC and ERC-20 units and use Arc-aware execution tests. Do not introduce an upgradeable proxy or a second contract framework for this MVP.
- Use Vercel AI SDK with the OpenRouter provider (`@openrouter/ai-sdk-provider`) and a server-side `OPENROUTER_API_KEY`. Keep Neon backend infrastructure on Free. Keep the model interchangeable and separate inference from independently authorized execution tools.
- The recovery agent must select investigation and action tools using actual evidence. Tools cover settlement, job status, stored outputs, related orders, result restoration, scheduled observation, safe retry, refund requests, and route pausing.
- Tool handlers independently enforce policy. Documents and log content are evidence, not authority to alter policy or invoke privileged actions. The model cannot invent payment evidence, recipients, or entitlements.
- Bound agent investigation to 12 model calls total per recovery case, persisted across restarts, and 60 seconds per investigation invocation. Model errors or exhaustion preserve the case for operator review; deterministic payment reconciliation, deadline enforcement, and already-authorized pending refunds continue independently. Use AI SDK with an explicit direct provider instance; the provider account, model, and live inference verification remain pending. Supply credentials through environment configuration, not chat.
- Default policy: 1 test USDC purchase price, a two-minute deadline measured from confirmed payment, and at most one retry. Snapshot purchased terms per order. Restore a valid existing output before considering another execution. Retry only after confirming the previous attempt stopped, no valid output exists, and time remains before the original deadline.
- At the deadline, attempt to stop processing, confirm it stopped, and check again for a valid result before refunding. A timeout alone is not refund eligibility. Ambiguous execution or payment evidence remains unresolved for review.
- Free-hosting interruptions may delay recovery investigation by several minutes. The original two-minute purchase deadline still applies; show overdue obligations honestly, and do not treat a delayed sweep or expired execution lease as proof that processing stopped. Use scheduled recovery invocations over durable database state.
- Confirmed failure with exhausted recovery permits a full purchase-price refund. Transaction gas is excluded and disclosed before purchase. No partial refunds are required.
- Use a separately funded reserve with contract-enforced original-payer, entitlement, amount, duplicate-refund, and cumulative-spend restrictions. The default automatic refund allowance is 10 test USDC per UTC calendar day. Reserve administration belongs to the operator, separate from the recovery worker.
- A separately authorized registrar records verified refund entitlements. The agent cannot fabricate or enlarge them. Explicitly document the registrar's trust boundary: the contract enforces recorded entitlements; it does not independently infer off-chain job failure.
- Keep the administrator key out of deployed recovery services and isolate the registrar from the worker. Prevent the worker from rewriting eligibility evidence or policy to enlarge its own authority. Direct merchant settlement and registrar-dependent refunds do not provide a permissionless customer refund path if the operator disappears; disclose that limitation.
- Eligible refunds blocked by reserve balance or daily allowance remain refund pending. Show an operator alert in the dashboard and pause new purchases. Retry pending refunds automatically when funding and allowance permit; do not bypass limits silently.
- Independently pause purchases after three confirmed processing failures within five minutes, even if the model is unavailable. The agent can request an earlier pause based on related failures. Existing paid orders continue recovery. Operator resumption requires a successful health check after the latest pause and sufficient reserve balance and remaining daily allowance for all outstanding authorized refunds, accounting for submitted transactions. Reopening is not automatic; funding alone never resumes sales.
- Authenticate customers and the configured operator through Sign-In with Ethereum, verified with viem, and server-managed browser sessions. Validate the expected domain, single-use nonce, signature, and expiry. Support EOAs only in the first release; customer identity must match the paying wallet. Restrict the dashboard to one configured operator wallet and verify result ownership before granting access.
- Authenticated availability of a verified downloadable result counts as delivery; an actual download is recorded separately. Delete each uploaded document seven days after upload and each output seven days after its creation; restoration and downloads do not restart retention. Display the exact result expiry and retain order, decision, and transaction records, including unresolved obligations after file deletion. Do not place document contents on-chain.
- Track delivery, refund, and escalation explicitly, with intermediate processing, observation, uncertainty, and refund-pending states. Do not report a transaction hash alone as completed settlement or refund.
- Deploy publicly on the agreed free hosting services using provider-generated URLs. Existing account access may be used. Model inference uses a separately billed direct provider through AI SDK; a paid Neon plan is not required for this choice. No infrastructure upgrade or automatic model-credit purchase is authorized.
- Follow the relevant ETHSKILLS Solidity, security, testing, and shipping guidance, adapted to Arc and the accepted architecture. Scaffold-ETH-specific components, approval flows, hosting recipes, and wallet infrastructure do not become project requirements merely because they appear in that guidance.
- Display reserve and transaction explorer links, label amounts as test USDC, and provide readable pending and failure states. Keep authenticated RPC credentials server-side. Choose status polling against responsiveness and free-tier capacity rather than copying a generic interval.
- Record a reproducible release commit, compiler settings, contract ABI/address/chain and deployment transaction, and verify deployed reserve source on the supported Arc explorer. Document build/configuration and migration procedures, dependency licenses, project licensing, administrative powers, and provider dependencies. Do not claim a working self-host or user-exit path without evidence.

## Testing Decisions

- Accepted primary seam: externally observable order lifecycle through the public paid API and authenticated status/download surfaces, backed by real durable execution and a database. Drive scenarios using the programmatic purchaser and controllable processing failures; retain the separate direct reserve-contract authorization seam below.
- There is no existing implementation or test suite to reuse. Preserve the recorded architecture decisions on isolated refund authority and delayed recovery on free hosting; use the domain terms order, payment, result, recovery case, incident, policy, entitlement, and reserve consistently.
- Use Playwright Test for browser and HTTP API lifecycle checks at the accepted primary seam. Exercise real database-backed execution with isolated users and synthetic documents. Failure traces and screenshots must not publish session credentials or private document contents.
- Good tests assert customer-visible outcomes, persisted obligations, actual action effects, and money movement. Avoid assertions about private helper structure, exact LLM wording, or a predetermined tool sequence when several sequences are valid.
- At the lifecycle seam, cover a normal paid conversion, restored output after a lost response, ongoing work without duplicate execution, one safe retry, eligible refund, uncertain evidence, exhausted reserve or allowance, and route pausing and resumption.
- Interrupt execution around settlement, job execution, refund submission, and persistence boundaries. Replay requests and events and exercise concurrency. Assert no duplicate charges, duplicate execution beyond the one authorized retry, duplicate refunds, or false resolution claims.
- Verify deadline behavior, per-order policy snapshots, midnight UTC allowance reset, seven-day content deletion, retained receipts, and access rejection for a different wallet.
- Use controlled model/tool fixtures for reproducible lifecycle tests, plus live-model acceptance demonstrations proving that the agent selects and executes tools based on differing evidence. Fixtures alone do not prove the agent requirement.
- Add a narrow contract authorization test seam because application-only tests cannot prove reserve enforcement. Directly exercise unauthorized calls, wrong recipients, excessive amounts, replayed entitlements, cumulative allowance, and separation between registrar, worker, and administrator authority.
- Use Arc Foundry with forge-std for contract unit, fuzz, invariant, and integration tests, with at least 1,000 fuzz runs and gas snapshots. Verify stateful refund uniqueness, payer binding, and daily limits. Use Slither for static analysis in development and contract CI; resolve high/medium findings or document reviewed false positives. Verify Slither compatibility with the chosen Arc compiler/build artifacts during setup.
- Exercise the actual browser SIWE flow, including signature rejection, wrong network, account changes, expired/replayed challenges and sessions, operator restrictions, and cross-wallet access rejection. Check keyboard use, narrow screens, loading/empty/error states, metadata, and useful errors. API-authenticated fixtures alone do not prove wallet interaction works.
- Complete a real Arc testnet settlement and refund smoke test, inspect successful receipts, and verify an unknown transaction outcome does not trigger blind resubmission.
- Release acceptance requires a public deployment, runnable purchase instructions, normal PDF conversion, and clearly labeled reproducible demonstrations of restoration, monitoring, retry, refund, and sales pausing. Verify observable outcomes and evidence, not just screenshots or generated explanations.
- After the build, a separate reviewer or fresh context reads the source and exercises the deployed application. Record the reviewed commit/deployment, PASS/FAIL for applicable checks, reproduction evidence, and explicit untested or inapplicable checks. Recheck fixes; unresolved failures affecting money movement, authorization, privacy, or required acceptance behavior block release.
- Include a full CROPS review of censorship resistance, source visibility and licensing, privacy, and security. Name the powers of Vercel, Neon, facilitator, RPC provider, operator, registrar, worker, merchant, and USDC issuer. Verify private-file ownership/retention, actual browser and model data disclosure, key isolation, spending limits, and realistic recovery/exit options. Another RPC can expose receipts but cannot restore private files or replace registrar authority.

## Out of Scope

- Beta recruitment, market validation, paid pilots, and production-money operation.
- Multiple merchants, merchant signup, subscription billing, and generic integration marketplaces.
- Browser-based x402 checkout as a shipping requirement.
- OCR, encrypted PDFs, AI summaries, additional document formats, external processing providers, and replacement-provider procurement.
- Partial refunds, gas reimbursement, cross-chain payment or refund flows, and unrestricted agent financial authority.
- Custom domains, email notifications, submission videos, and mandatory hackathon publishing assets beyond the working product.
- A deterministic-only recovery implementation or an explanation-only LLM substitute for the agreed agent.
- Scaffold-ETH, a second contract framework, mandatory RainbowKit/WalletConnect infrastructure, account abstraction, a dedicated indexer, IPFS document storage, and unrelated DeFi/oracle libraries.

## Further Notes

- This specification consolidates the agreed product, technology stack, ETHSKILLS additions, and QA decisions. The accepted testing seams remain unchanged.
- The workspace contains requirements, specification, stack research, glossary, architecture decisions, and a throwaway UI prototype. Production implementation has not begun; prototype checks do not constitute release QA.
- Arcus discovery establishes advertised support, not end-to-end compatibility or a successful payment. See https://docs.arcusnetwork.co/ and the official facilitator guidance at https://github.com/x402-foundation/x402/blob/main/docs/core-concepts/facilitator.md.
- Credentials, funded testnet wallets, reserve deployment, model execution, and public deployment still require implementation-time verification. Do not treat the local research notes as proof these have been completed.
- The user selected GitHub repository MrSufferer/mend. The approved 18 implementation tickets are published with native blocking relationships; ticket 01 is ready-for-human and all others are ready-for-agent with prerequisites. See the research and ticket plan for the publication index. Parent specification #19 contains the agreed functional specification and stack; all 18 tickets are its native sub-issues with user-story traceability. Production implementation has not begun.

## Prototype design checkpoint — 2026-10-12

Signal Teal with Geist and Geist Mono is accepted for the visual direction. The user selected **A — Recovery desk**: an order queue alongside focused case detail, with refund capacity and purchase availability supporting the selected case. This is the layout baseline for subsequent UI work. Incident room and Order ledger remain archived comparison variants. See [prototype review](docs/prototype/design-review.md) and [brand tokens](brand.md). The layout selection does not accept any new recovery policy or unreviewed interaction detail. The prototype does not validate authentication, persistence, payment, model, reserve, or deployment integrations. Ticket publication and production implementation remain paused pending review.


### Accepted interaction decisions — grill round 1

- Recovery runs automatically. Operators may request investigation or invoke an individually permitted recovery action through the same evidence, authority, and budget checks. There is no force-refund or mark-resolved override.
- Customer pages lead with outcome, next step, purchased deadline, exact file expiry, and confirmed transaction links, followed by a plain-language timeline. Raw tool logs, model diagnostics, and other customers’ incident details remain operator-only.
- Recovery desk defaults to unresolved orders, with cases requiring operator intervention first, then oldest overdue obligations. Filters expose processing, unpaid, and completed orders. File expiry does not resolve an outstanding obligation.
- A valid result discovered or completed after the deadline takes precedence over a refund only before refund entitlement registration. Restore authenticated availability and explicitly record late delivery. Once an entitlement is registered, complete the refund without switching the disposition back to delivery. The two-minute deadline triggers stopping and investigation; it is not an unconditional money-back guarantee.
- Retention starts separately for each private file at creation, as specified above. Restoration and downloads do not extend it.
- Reopening uses aggregate outstanding authorized refund capacity, not a check for only one order, as specified above.

These decisions refine the specification; the synthetic prototype has not been updated to implement them. The user confirmed shared understanding in Q12, closing the specification interview. All 11 decisions from rounds 1 and 2 are accepted. Ticket publication and production implementation remain paused.


### Accepted interaction decisions — grill round 2

- After the persisted 12-call model budget is exhausted, operators can inspect evidence, request fresh deterministic checks, and invoke actions those checks permit. Investigation requests cannot reset the model budget. Missing evidence leaves the case unresolved; deterministic reconciliation continues.
- Revalidate evidence, permissions, and policy at execution time for every operator action. If another recovery run changes the conditions, skip the now-ineligible action, explain the reason, and refresh the case. Record the requesting actor and action outcome in the audit history.
- Private files expire on schedule even during unresolved recovery. Keep the obligation open and continue payment/execution reconciliation. Expiry alone establishes neither delivery nor refund eligibility. If delivery was never established, execution is confirmed stopped, and no valid output remains, allow the normal isolated-registrar refund assessment.
- The reopening health check runs a small synthetic PDF through the real validation, processing, private storage, and authenticated retrieval path. Check payment infrastructure availability and the independently required aggregate refund capacity. Display which checks passed and when. Any subsequent confirmed processing failure invalidates the passing result; a successful check must also follow the latest pause.
- For authorized pending refunds, customer pages explain whether the blocker is reserve funding, the daily allowance, or transaction confirmation. Show the UTC reset time when applicable without promising an uncertain completion time. State that no additional customer payment is required.

### Interaction acceptance checks

Verify model-budget exhaustion cannot be bypassed through operator controls; concurrent recovery cannot make stale operator actions execute; audit history records actor and outcome; expired files do not close unresolved obligations; health checks exercise the real document path and are invalidated by subsequent confirmed processing failure; and customer refund explanations distinguish funding, allowance, and receipt confirmation without leaking operational diagnostics. Add these to lifecycle and independent release review coverage. These are required future checks, not completed validations.


### Ticket publication status

The user resumed to-tickets, approved the revised 18-ticket breakdown, and authorized publication to [MrSufferer/mend](https://github.com/MrSufferer/mend/issues). All 18 tickets are published; this supersedes earlier ticket-publication holds in the design checkpoint. Prototype alignment is incorporated into the approved behavior slices, and production implementation has not begun.


The published parent specification is [GitHub #19](https://github.com/MrSufferer/mend/issues/19). Its native sub-issues #1–#18 include their relevant numbered user stories and technology constraints, with a full US-01–US-44 coverage table in the parent.


## Implementation authorization — 2026-10-13

The user resumed implementation for GitHub ticket #2 and then the next ticket in the approved list, #3. This supersedes historical implementation holds for those two slices only. Issue #1 is closed with verified provisioning access. The remaining tickets and parent specification are not completed by this work. The approved design, authority boundaries, and testing seams above remain the implementation baseline.

## Implementation authorization — 2026-10-14

The user authorized continuing all remaining approved tickets #4–#18 until complete. This supersedes the earlier two-ticket scope; historical implementation evidence remains limited to the slices actually verified. The approved design, authority boundaries, and testing seams remain the baseline.
