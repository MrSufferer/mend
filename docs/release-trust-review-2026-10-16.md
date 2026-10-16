# Independent trust, CROPS and contract review

Reviewed source `609c5bdc20ffe0b1cf47735f1cf3d2318bacddae`, read-only, on 2026-10-16. Read the release QA issue and parent specification, trust/customer/reproduction/license/contract documents, reserve source/tests, registrar/refund boundaries, agent prompts/tool response projections, wallet configuration and retention implementation. Fetched current ethskills root and QA, CROPS, security, testing, ship, addresses, wallets and L2 guidance before onchain checks. Generic Scaffold-ETH requirements do not replace this approved Next.js/EOA-only/API-checkout/Arc-testnet scope. No deployment, transaction broadcast/signature, new purchase, provider credit purchase, live model request or issue change was made.

## Contract result: PASS within this scope

At Arc testnet block **67436756**, hash `0x9599ffda3167e087402252ccb0c20165d56212d9c8c608c70b066d0342122a65`, fresh read-only RPC observed the reserve at `0x76b29d6a6eab98b32415b8a6adf5d587d991e082`, six-decimal token `0x3600000000000000000000000000000000000000`, **8 test USDC** reserve, **10 test USDC** remaining calendar-day allowance, immutable cap **10 test USDC**. Native reserve 8e18 reconciles to ERC-20 reserve 8e6; these interfaces represent the same underlying funds. Completion timestamp 2026-10-16T03:36:27.905295Z; snapshot block was acquired before later requests.

Fresh Blockscout source response was downloaded, not accepted from the old report. Its 12 source files and compiler settings exactly matched checked-in verified standard input; every source matched reviewed reserve/pinned dependency files. Independently recompiling with local solc 0.8.30 reproduced **entire deployed runtime including metadata and immutable token** and **entire creation input plus constructor arguments**. Current explorer ABI, compiled ABI and committed ABI match after normalizing entry order. The default auto-remapping build metadata distinction remains documented and does not indicate changed deployed logic.

All six recorded deployment/funding/synthetic registration/refund and historical genuine-obligation registration/refund receipts were fetched again, successful and canonical against their block hashes. This is fresh confirmation of historical actions, not a new purchase/refund demonstration. Full receipt IDs and source hashes are in [sanitized evidence](evidence/release-2026-10-16/trust-contract-evidence.json).

The named administrator/registrar/worker each has only its expected role. Unlike the earlier named-account-only observation, this review also queried **all RoleGranted/RoleRevoked events from deployment through snapshot**, in bounded ranges: three events total, yielding exactly the three expected holders. This is a snapshot of current roles, not a promise that the administrator cannot add/merge/revoke them later.

Independent local checks copied the reviewed contract/tests to `contracts-fresh`, using pinned OpenZeppelin `c64a1edb67b6e3f4a15cca8909c9482ad33a02b0` and forge-std `77041d2ce690e692d6e03cc812b57d1ddaa4d505`; Arc Foundry from the inspected prior tool archive, not stock Anvil. `forge test --network arc --fuzz-seed 0x18`: **8 direct tests + 2 invariants pass**; fuzz 1000; each invariant 1000 runs / 64000 calls / zero reverts. `forge snapshot --network arc --match-contract RefundReserveTest --check` from the contract directory passes without rewriting the committed snapshot. Slither 0.11.5 freshly analyzed 42 contracts / 101 detectors / zero results, filtering lib/test paths only. The durable sanitized evidence records test counts, source/receipt/runtime hashes and tool versions; raw local logs remain private. Reproduce with the pinned toolchain and commands in [contract tooling](../contracts/README.md) and [release instructions](release.md#contract-reproduction). Initial gas invocations from the parent directory could not locate `.gas-snapshot`; correcting the working directory passed. An initial ABI equality assertion differed only in array ordering; normalized equality passed. These setup failures are not hidden test failures.

Source inspection confirms immutable token/cap; registrar-only write-once entitlement; worker-only exact payer/amount single payment; checks/effects before SafeERC20 transfer with reentrancy guard; reverted transfer restores spent/entitlement state; no proxy/withdrawal/arbitrary-call/edit/cap-change surface. Administrator role mutation remains broad, and constructor role separation is not a permanent separation guarantee.

## Finding requiring explicit release disposition

**Provider identity evidence is incomplete.** `docs/release-trust.md` says a release receipt must identify actual deployed model/provider, but the acceptance report records only `nvidia/nemotron-3.5-lightning:free` and explicitly says upstream inference identity was not independently recorded. `backend/agent.ts` disables fallbacks and requires tool parameters but does not pin a named inference-provider order. A NVIDIA-branded model is not proof NVIDIA hosts the inference. No new quota-consuming inference was made here. The release report must retain **OpenRouter-selected upstream provider identity UNKNOWN** as an untested disclosure gate, or obtain an independently identified provider receipt under existing authorization. Do not declare that requirement passed from the model name alone.

No newly found high/medium reserve implementation defect. The architectural powers below are accepted bounded testnet compromises only where the approved spec explicitly accepts them. They would require stronger remediation/reapproval for real-fund or walkaway-guaranteed production claims.

## CROPS Review

Chosen default: Direct original-payer-to-merchant x402 settlement, private offchain PDF/text execution and durable evidence, bounded optional model decisions, and a separately funded immutable capped refund reserve. This minimizes onchain sensitive content and agent spending authority within the approved testnet scope. It preserves centralized eligibility and availability trust; it does not pass the walkaway test.

### Censorship Resistance

Risk: Vercel can block API/UI, Neon can stop DB/functions/object retrieval, Arc/Circle can interrupt chain/token service or restrict transfers, facilitator/RPC can delay payment confirmation, and operator/admin/registrar/worker can refuse or lose service. Sales pause blocks new purchases; paid recovery still requires live services. OpenRouter/provider can refuse inference. Public block explorer is an inspection convenience, not settlement truth.

Mitigation: Durable receipt checks, direct settlement, explicit unknown states, deterministic reconciliation when model fails, existing-obligation processing during pause, publicly inspectable contract/events and replaceable configured service boundaries. Daily cap limits spend but cannot guarantee timely repayment. Source enables another deployment; hosted private state and credentials remain necessary for existing obligations.

User escape: Keep original PDF/private CLI state and rerun same attempt for uncertain settlement; original payer can authenticate/download before expiry while service works. Public chain receipts can be inspected via another RPC/client. Users cannot bypass registrar/worker to register/refund themselves; self-hosting a new UI cannot recover absent private DB/files. No canonical L1 withdrawal/forced-inclusion exit was established for this Arc testnet; do not imply Ethereum-rollup escape guarantees.

### Open (visibility)

Risk: Proprietary hosted operations (Vercel, Neon, OpenRouter/provider, facilitator, Canteen, Arc/Circle) are not reconstructed by verifying one reserve. Final provider remote bundle bytes are not independently downloaded/hashed. Source/build documentation and dependency pins alone do not independently establish all live runtime authority.

Mitigation: Public app/backend/contracts, lockfile, versioned 47-migration prefix, shared ABI/manifest, exact verified compiler input, documented configuration role boundaries and dated source/deployment receipts. This review freshly ties contract bytes to source. Source-only changes after runtime source96 do not establish new runtime deployment.

User escape: Legally fork and reproduce app/contract logic and provision replacement providers using docs. Existing service's private data/keys/provider accounts are not public export artifacts, so a fork is a new service and cannot guarantee recovery of existing orders.

### Free, as in Freedom

Risk: Hosted service terms, quotas and account access remain external dependencies; native/distributed artifacts may impose notice/source/relinking obligations. Declared lockfile licenses alone do not prove remote shipped-artifact compliance or ensure future versions remain open.

Mitigation: MIT project license, pinned OpenZeppelin/forge-std permissive licenses, explicit inventory/notices including OFL Geist/Mono and native libvips/LGPL concerns. Existing release-license documentation correctly limits local trace observations and does not claim all dependencies are MIT/Apache.

User escape: Current MIT project source may be forked/modified/operated without team permission subject to third-party terms and notices. This does not grant access to vendor accounts, private customer data or proprietary provider internals. Remote deployed artifact license audit was not independently performed here.

### Privacy

Risk: Vercel validates document bytes; Neon stores uploads/text and durable order/policy/audit evidence and runs parser services. Administrators/compromised infrastructure can access server-held data. OpenRouter and its **unknown selected upstream** receive order UUID, payment transaction hash, amount/status/timestamps, output digest/size/expiry, execution/publication facts and bounded related failure metadata through tools; those can correlate with public payer/merchant transactions even if payer address is omitted. RPC/explorer/facilitator/Arc/Circle observe wallet/transaction/network metadata. Browser wallet and public Arc transport may observe network calls. Signed read grants are transferable bearer capabilities until expiry. No network telemetry capture was performed here.

Mitigation: Private storage, EOA SIWE ownership/session checks, account-change state clearing, public receipts without document bytes, projected tool results that omit private object keys/documents/log prose/credentials, independent original seven-day content clocks, expiry-enforced download and bounded deletion sweeps. Source is consistent with content/path omission from normal agent tool results; this is not proof about compromised infrastructure or historical provider retention.

User escape: Do not upload sensitive documents if these disclosures are unsuitable; use local extraction or an independently operated fork for future work, and keep source files/download before expiry. There is no user-proven provider erasure or blockchain deletion. Seven-day access cutoff does not guarantee immediate physical deletion, erasure of operational evidence, provider logs or backups. The parallel release reviewer freshly checked all201 due main staging records and independently HEAD-verified201 absent, zero present/unknown ([receipt](evidence/release-2026-10-16/retention-head.json)). This resolves the dated staging backlog uncertainty at that observation; it does not prove erasure of provider logs/backups or guarantee future deletion. No purge was forced for this review.

### Security

Risk: Merchant receives purchase outright; reserve is not escrow and future funding is optional. Registrar compromise can authorize false entitlement; administrator can appoint malicious roles or combine them; worker can pay valid entitlements up to funds/day cap. Combined compromised authority can drain reserve over calendar days. DB/provider admins can subvert offchain eligibility/data/availability despite normal runtime grants. Circle/Arc restrictions and schedules/cold starts can prevent payment/recovery. Model decisions can fail or consume budget without resolving cases.

Mitigation: Distinct current signer roles and isolated service credentials, immutable entitlement exact payee/amount, replay protection, SafeERC20/reentrancy protection, onchain daily cap, independent registrar canonical payment/output/stop checks, SQL disposition fences, twelve persisted calls and sixty-second invocation ceiling, deterministic uncertain-state retries. Current authority/pins/bytecode verified as described. No multisig/timelock; no full runtime-secret inventory or credential-absence probe was independently run in this subreview.

User escape / walkaway: A customer controls their own EOA and remaining wallet funds, but the settled purchase is merchant-held and the contract has no customer-callable refund or withdrawal. If operator/registrar/worker/provider disappears, purchased obligations can remain unresolved indefinitely; even existing entitlement is worker-gated. Admin can appoint replacements if available; this is operator recovery, not user escape. Download before expiry and preserve payment evidence; no guaranteed reimbursement/forced exit is offered.

Accepted compromises: Arc **testnet**, one **test USDC** purchase, ten **test USDC** UTC day cap, separately operator-funded reserve, centralized offchain eligibility and storage, EOA-only injected browser wallet/API checkout, no customer escrow/permissionless refund, free hosting scheduling delays, replaceable but presently hosted AI with deterministic fallback. Unidentified upstream model host, unverified remote artifact licensing/digests, future physical deletion timing and unsampled external telemetry are limitations, not inferred passes.

## Untested here

Fresh browser/keyboard/narrow-screen/SIWE flows, paid customer lifecycle, live model/tool decisions, deployed per-service secret isolation, scheduled receipt execution, physical deletion/backlog (covered separately by the linked release-QA receipt), remote provider artifacts and all shipped notices, chain outage/issuer freeze behavior, future funding, account compromise, real mobile wallets. No production-fund safety, full formal audit, full dependency vulnerability review or unconditional release approval is established by this subreview.

The companion [independent product QA](release-qa-2026-10-16.md) records fresh deployed browser/SIWE/keyboard/health, schema/schedule/trigger and storage absence checks. Checks marked untested in this trust subreview remain scoped to its own execution.
