# Arc technology stack research

Researched **2026-10-12**. This is a product-neutral selection guide for the Tameion agent hackathon, before implementation. Recommendations are engineering judgments; tables distinguish documented support from access actually tested.

## Fastest credible starting stack

### Mend selections — interview, 2026-10-12

The user confirmed this architecture and completed the stack interview on 2026-10-12. These project-specific decisions supersede the generic recommendations below. Product behavior remains defined by `SPEC.md`; untested integrations remain implementation gates.

- **Accepted:** TypeScript on Node.js for the API, execution worker, agent, and purchase client; Solidity for the refund reserve.
- **Accepted:** Neon PostgreSQL is the authoritative order/action store. Implement database-backed work claiming, retries, and reconciliation without a separate managed workflow engine.
- **Accepted constraint:** Use free hosting: Vercel for the Next.js application and Neon Functions for backend execution. Render Free is a backend-only fallback if required. An always-running paid worker is not authorized.
- **Accepted:** Dedicated testnet EOAs, administrator key excluded from deployed recovery services, and entitlement registration isolated from the recovery worker. See `docs/adr/0001-isolate-refund-authority.md`.
- **Accepted — 2026-10-13:** Route model inference through OpenRouter using Vercel AI SDK, with an interchangeable model. Keep Neon infrastructure on Free; model API usage is billed separately. OpenRouter was selected; its API key, exact model, and live inference verification remain pending.
- **Accepted:** EOA-only customer wallet support for the first release.
- **Accepted:** AI SDK supplies the agent loop using `@openrouter/ai-sdk-provider` and an explicit `createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })` provider instance. Neither Neon AI Gateway nor Vercel AI Gateway is required. Do not pass bare model strings that implicitly select the default gateway.
- **Accepted:** Keep backend infrastructure on the Free plan. `OPENROUTER_API_KEY` belongs only in the recovery agent environment. No Neon upgrade or automatic credit purchase is authorized.
- **Accepted:** Recovery after platform interruption may take several minutes. The original two-minute purchase deadline remains unchanged; delayed investigation never proves execution stopped or creates refund eligibility by itself. Persist and display overdue obligations until reconciled.
- **Accepted:** Next.js frontend deployed on Vercel, within the free-hosting constraint. Render is reserved for backend use if needed; the earlier React/Vite static-site proposal is rejected. Neon Functions remains the selected backend execution platform, subject to integration checks.
- **Accepted:** Private Neon Object Storage holds uploaded PDFs and generated text. The backend checks order ownership before granting downloads; scheduled deletion enforces seven-day retention.
- **Accepted:** Drizzle ORM for database access. The plain `pg`-without-ORM proposal is rejected. Use reviewed versioned migrations; exact driver and compatible package versions are implementation choices.
- **Accepted:** At most 12 model calls per recovery case, persisted across restarts, and 60 seconds per investigation invocation. Exhaustion escalates for review; deterministic reconciliation, deadline enforcement, and already-authorized pending refunds continue independently.
- **Accepted:** Test the order lifecycle through the public paid API and authenticated status/download surfaces, with a separate direct reserve-contract test boundary and live-model acceptance demonstrations.
- **Accepted:** Sign-In with Ethereum verified with viem and server-managed browser sessions for customers and the configured operator. Check the expected domain, single-use nonce, signature, and expiry; consume challenges atomically. Customer identity must match the paying EOA. [viem SIWE verification](https://viem.sh/docs/siwe/actions/verifySiweMessage).
- **Accepted:** Use Drizzle Kit for reviewed, versioned migrations. Delegate remaining library and compatible version choices to implementation-time documentation and integration checks, including the database driver, PDF extraction, wallet connection, and testing tools. Revisit decisions that change cost, product scope, or trust boundaries.

**Hosting selection:** Neon Functions runs backend execution and Vercel serves the Next.js application. Functions support Node.js 24 and scheduled invocation, including while compute is scaled to zero. Use bounded invocations over durable database jobs; the platform is not itself a durable job queue. Prove PDF execution cancellation and evidence preservation under eviction before committing to the execution implementation. Keep entitlement registration isolated from the recovery worker. [Functions](https://neon.com/docs/compute/functions/overview), [runtime limits](https://neon.com/docs/compute/functions/reference/runtime-limits), [triggers](https://neon.com/docs/compute/functions/triggers/overview).

**Cost decision — 2026-10-13:** The user approved direct model-provider access through AI SDK to avoid a paid Neon plan solely for AI Gateway. Neon PostgreSQL, Functions, and private Object Storage remain on Free within their allowances. Model usage remains separately billed by the selected provider. The direct provider API preserves the existing agent/tool boundary; a live tool-calling test and runtime compatibility check remain required. [AI SDK providers](https://ai-sdk.dev/docs/foundations/providers-and-models), [direct Anthropic provider](https://ai-sdk.dev/providers/ai-sdk-providers/anthropic).

**Implementation follow-through:** Select the scheduling cadence, model, PDF and session libraries, database driver, migration configuration, and package versions using current documentation and working integration checks. Verify direct provider account access and live inference, a real Arcus settlement and reserve refund, free-tier/account eligibility and capacity, and PDF cancellation/recovery. These checks are not completed by the architecture agreement. [Neon agent integration](https://neon.com/docs/compute/functions/agents).

### ETHSKILLS stack additions — 2026-10-12

Reviewed the ETHSKILLS [tooling](https://ethskills.com/tools/SKILL.md), [testing](https://ethskills.com/testing/SKILL.md), [security](https://ethskills.com/security/SKILL.md), and [shipping](https://ethskills.com/ship/SKILL.md) guidance against Mend. The following are concrete implementation selections under the delegated library/tool choices above; they do not introduce another hosted service.

| Selection | Purpose in Mend | Scope and integration checks |
|---|---|---|
| **Add `forge-std`** | Solidity test assertions, cheatcodes, and stateful invariant handlers for the refund reserve. | Development dependency alongside Arc Foundry. Pin a compatible revision. Test unauthorized registration/refunds, duplicate refunds, original-payer binding, full-price amounts, and the UTC daily cap across action sequences. Use Arc-aware integration tests for the actual USDC interface. [Official library](https://github.com/foundry-rs/forge-std). |
| **Add Slither (`slither-analyzer`)** | Static analysis of the reserve contract before deployment and in contract CI. | Python development/CI tooling only; the application stays TypeScript. Resolve high/medium findings or document reviewed false positives. Standard Foundry integration is documented; compatibility with the selected Arc Foundry compiler/build artifacts must be verified during setup. Static analysis does not validate Arc runtime behavior. [Official documentation](https://github.com/crytic/slither). |
| **Select `wagmi` + `@tanstack/react-query`** | Browser EOA connection and wallet state for the Next.js SIWE login flow, using the existing viem selection. | Start with an injected-wallet connector. Backend viem verification and server sessions remain authoritative. The approved inline checkout extension also uses this wallet state for a separate exact-payment signature; RainbowKit, WalletConnect infrastructure, and hosted wallets remain unnecessary. Pin mutually compatible versions. [Installation](https://wagmi.sh/react/getting-started), [wallet connection](https://wagmi.sh/react/guides/connect-wallet). |
| **Carry forward viem, Arc Foundry, and OpenZeppelin Contracts 5.x as Mend selections** | Typed chain access, Arc-aware build/test/deploy tooling, and reusable reserve security primitives. | Already present in the research baseline; explicitly selected for this project. Use `SafeERC20`, `AccessControl`, and `ReentrancyGuard` where applicable. Export ABI artifacts from the pinned contract build for backend/frontend consumption. No second contract framework is needed. |

Use the existing Arc Foundry toolchain for unit, fuzz, invariant, integration tests, and gas snapshots; a separate fuzzing platform is unnecessary for this MVP. Include at least 1,000 fuzz runs and stateful checks of refund uniqueness, recipient binding, and daily spending limits. Source verification and a recorded deployment manifest (chain ID, address, compiler/settings, ABI, deployment transaction) belong in the deployment workflow, using the verifier supported by Arc's current explorer. Verify exact CLI support when configuring the pinned toolchain.

**Not selected for this MVP:** Scaffold-ETH 2 or Hardhat alongside the existing Next.js/Arc Foundry stack; Safe/account-abstraction infrastructure for the accepted dedicated-testnet-EOA design; The Graph or Blockscout MCP without a demonstrated indexing need and Arc support; IPFS for private, expiring PDFs; or DeFi/oracle/math libraries for a fixed-price refund reserve. ETHSKILLS' x402 guidance reinforces the existing payment choice, but does not change the specified Arcus-first, direct-settlement `exact` flow into Circle Gateway batching. Select the runtime adapter only after checking Neon Functions compatibility.

These are documentation selections, not installed dependencies or completed integration/security checks. Keep the accepted Next.js/Vercel, Neon Free, Drizzle, and direct-provider AI SDK decisions.

### QA stack and release checks

**Select Playwright Test (`@playwright/test`)** for browser end-to-end and HTTP API lifecycle tests. This is our implementation choice for carrying out [ETHSKILLS QA](https://ethskills.com/qa/SKILL.md), not a package mandated by that skill. Drive paid orders through the programmatic purchaser and check authenticated status/download surfaces against real database-backed execution. Use isolated users and synthetic PDFs; retain useful failure traces/screenshots without publishing session credentials or private document contents. [Playwright API testing](https://playwright.dev/docs/api-testing), [traces](https://playwright.dev/docs/trace-viewer-intro).

| QA layer | Required evidence |
|---|---|
| Browser and authentication | Visible Connect/Sign-in actions; rejected signatures, wrong network, account changes, expired/replayed nonces and sessions; customer/operator authorization; another wallet cannot access an order or download. Check loading/error/empty states, keyboard operation, narrow screens, metadata, and readable failure messages. |
| Order lifecycle | All scenarios in `SPEC.md`: successful conversion, restoration, monitoring, one safe retry, eligible refund, uncertain evidence, exhausted reserve/allowance, pause/resume, deadline boundaries, retention, crash recovery, concurrency and replay. Controlled model fixtures make regressions reproducible. |
| Contract enforcement | Arc Foundry + `forge-std` tests and Slither from the preceding section. Application tests alone cannot prove onchain authority and spend restrictions. |
| Live integrations | Actual Arc testnet settlement and refund with successful receipts; unknown outcomes reconciled without blind resubmission; real model demonstrations of evidence-dependent tool selection. Fixtures and screenshots alone do not satisfy acceptance. |
| Deployment | Correct chain/address/ABI, verified reserve source on the Arc explorer, visible contract and transaction links, configured RPC access, server-only credentials, and working public purchase instructions. Test deployed hosting behavior, including delayed recovery after interruption. |

After the build, a **separate reviewer or fresh context** reads the source and exercises the deployed app. Produce `docs/qa/release-review.md` identifying the commit/deployment, PASS/FAIL per applicable check, reproduction steps and evidence, and a full CROPS review. Explicitly mark untested checks and explain inapplicable ones. The reviewer reports findings; implementation fixes are followed by targeted rechecks. Unresolved failures affecting money movement, authorization, privacy, or required acceptance behavior block release. No QA pass is claimed by this document.

Adapt the source checklist to our stack: browser wallet actions separate connection, SIWE login, and the approved exact-payment authorization; programmatic purchases remain supported. Approval UI, RainbowKit, Scaffold hooks/components, DaisyUI, and WalletConnect deep links are inapplicable unless later selected. Receipt-based pending states apply wherever transactions are exposed; do not copy fixed cooldowns as proof of confirmation. Label amounts as **test USDC**, without implying redeemable dollar value. Choose polling based on responsiveness and free-tier capacity; never expose the authenticated Canteen RPC URL to satisfy a generic browser-RPC recipe.

**CROPS architecture review baseline:** The chosen default remains Vercel/Neon hosting, dedicated testnet EOAs, direct merchant settlement, and a separately funded bounded reserve. These prioritize the accepted MVP scope and cost constraints; they leave the following concrete dependencies for release review. [CROPS guidance](https://ethskills.com/crops/SKILL.md).

| Pillar | Mend finding, mitigation, and user escape |
|---|---|
| Censorship resistance | Vercel, Neon, the payment facilitator, RPC provider, and operator can interrupt access or recovery. Persist obligations and document service configuration and alternate-provider procedures. Another RPC permits inspecting onchain receipts; it cannot restore private files or replace registrar authority. |
| Open / Free | Public source is required, but licensing and reproducible deployment are not yet established. Record dependency licenses, a project license, pinned build/deployment inputs, schema/migrations, ABIs, and setup instructions. Forking/self-hosting is an escape only once those instructions work; it does not grant access to the original deployment's data or keys. |
| Privacy | Hosts see request metadata; storage holds PDFs/text; payment addresses and amounts are public. Enforce ownership checks, private storage, seven-day deletion, and minimal logs/model evidence. Review actual model payloads and browser requests for leakage. Download before expiry; deletion cannot erase public chain history. |
| Security | Administrator, registrar, worker, merchant, and USDC issuer have distinct powers. Verify key separation, onchain entitlement/recipient/amount/replay/day-cap enforcement, reserve funding, and issuer restrictions. The merchant receives payment directly: users have no established permissionless refund escape if the operator/registrar disappears. Document that limitation rather than claiming the reserve guarantees autonomous exit. |

Accepted compromises are centralized free hosting, delayed recovery after interruption, testnet EOA administration, and operator-dependent service/refunds. Actual implementation, licensing, privacy behavior, and deployment evidence remain unverified.

### Required Ethereum skill supplement

At the user's direction, read and follow [ETHSKILLS](https://ethskills.com/SKILL.md) before writing Solidity or shipping anything onchain. The root skill was read on 2026-10-12. It is a task router: fetch and follow the relevant linked skills when doing that work, rather than treating the root summaries as complete implementation guidance.

- Before building the dApp, start with [Ship](https://ethskills.com/ship/SKILL.md) and follow its applicable phase guidance.
- Before writing Solidity, read [Standards](https://ethskills.com/standards/SKILL.md), [Building Blocks](https://ethskills.com/building-blocks/SKILL.md), [Addresses](https://ethskills.com/addresses/SKILL.md), and [Security](https://ethskills.com/security/SKILL.md).
- For contract tests, follow [Testing](https://ethskills.com/testing/SKILL.md), including relevant failure, fuzz, invariant, and external-integration tests.
- Before shipping onchain, apply the relevant wallet, deployment, and gas guidance and the [QA](https://ethskills.com/qa/SKILL.md) and [CROPS](https://ethskills.com/crops/SKILL.md) reviews. Use a separate reviewer or fresh context for the finished-build QA as directed by the root skill.

This supplements the accepted Mend stack and `SPEC.md`. Preserve the user's Arc-testnet-only scope, selected services, free-hosting constraints, and authorization boundaries. Generic Ethereum/mainnet/L2 defaults, Scaffold-ETH-specific recipes, example addresses, and historical gas estimates do not override those decisions. Verify chain-specific facts against current canonical Arc documentation and runtime evidence: native USDC uses 18 decimals, its ERC-20 interface uses 6, and Arc Foundry is the selected execution-aware contract tooling. Never infer Arc deployment support from an Ethereum example. A transaction hash alone is not confirmed success.

Read only the linked skills relevant to the actual phase; their future review and test requirements are not claims that those checks have already passed. ETHSKILLS also does not replace the project's Context7 library-documentation workflow.

### Generic research baseline (superseded by Mend selections above)

**Default:** TypeScript on Node.js 22.18+, **viem**, one agent SDK, **PostgreSQL/Supabase**, a small backend worker, and **Arc Testnet** through the already-installed Canteen RPC. Add Next.js only when a web interface is needed. For contracts, use **Arc Foundry + OpenZeppelin Contracts 5.x**. Pin the actual package versions selected during setup; sample versions below are observations, not latest-release recommendations.

| Layer | First choice | Change this choice when… |
|---|---|---|
| Chain access | viem public/wallet clients; Canteen RPC | A production provider's SLA, quotas, archive access or special APIs are required |
| Signing | Dedicated funded testnet EOA for the shortest setup; Circle developer-controlled wallet for managed custody | Passkeys, user custody, session permissions or account abstraction are necessary |
| Agent orchestration | Vercel AI SDK stable 6 for TypeScript/provider flexibility | OpenAI Agents SDK tracing/handoffs or LangGraph checkpointed branching materially simplify execution |
| Persistence | PostgreSQL, optionally managed by Supabase | Existing infrastructure already provides transactional persistence |
| Execution | One persisted DB worker for a small workflow; Inngest/Trigger.dev for durable orchestration | Recovery complexity exceeds the worker's explicit state machine |
| Contract tooling | Arc Foundry + pinned OpenZeppelin | Reusing an existing verified contract removes deployment work |
| Stablecoin transfer | Native USDC or ERC-20 USDC through viem | Crosschain liquidity, hosted wallets, swaps or payments require a Circle kit |
| Circle SDK | One standalone kit for one operation; unified App Kit for several | A direct protocol integration needs lower-level control |
| Indexing | RPC receipts/events with DB checkpoints | Long history, large volume or analytics justify a managed indexer |
| Frontend, if required | Next.js + React; wagmi for user-wallet interaction | A backend-only service needs no frontend framework |

Avoid installing every capability in this inventory. The shortest path is the smallest set with verified testnet access, available credentials, reproducible dependencies and a working receipt/reconciliation flow. An LLM prompt or hosted-wallet setting is not equivalent to contract-enforced spending limits.

The organizer's technical expectations include Arc/USDC execution, autonomous workflow evidence, contract-enforced budgets, a public repository and a short recorded demonstration. These make reliable transaction execution, limits and traceable outcomes higher priorities than stacking infrastructure services. See the [official hackathon requirements](https://tameion.thecanteenapp.com/).

## Research method and evidence

- Read the local `requirements.txt` in full, without carrying its proposed product into this document.
- Used installed `arc-canteen` **0.1.18** (`c04cfcb`), ran `context sync`, and inspected its documentation and eight installed sample repositories. Context snapshot: `1f345bf6528e5efc2df7d49c52c0ef144cb73602`, dated 2026-09-15. [Context source](https://github.com/the-canteen-dev/context-arc).
- Read [ethskills.com/SKILL.md](https://ethskills.com/SKILL.md) and relevant Ethereum tools, wallets, standards, security, testing, indexing and concepts guidance; reconciled generic Ethereum advice with Arc's current canonical documentation.
- Fetched current library documentation using the prescribed Context7 CLI library-first workflow. Indexed snippets were checked against current primary sources where addresses, chain configuration or API generations disagreed.
- Cross-checked live [Arc documentation index](https://docs.arc.io/llms.txt), Circle feature documentation and first-party repositories. Live docs currently describe capabilities beyond the Canteen snapshot.
- Performed read-only RPC probes. No transfers, deployments, wallet creation, paid-service onboarding, dependency installation or end-to-end provider integrations were performed.

| Check | Result and implication |
|---|---|
| Canteen `eth_chainId` | `0x4cef52` = **5042002**, confirming Arc Testnet access |
| Canteen `eth_blockNumber` | Returned a current block, confirming live reads |
| USDC `decimals()` | Returned **6**, confirming the ERC-20 interface's units |
| ERC-8004 Identity Registry `eth_getCode` | Nonempty proxy bytecode at the canonical testnet address; semantics not audited |
| ERC-8183 reference `eth_getCode` | Nonempty proxy bytecode; deployment alone does not establish production readiness |
| Canteen `eth_gasPrice` | Returned a fee quote; never hard-code that observation |
| Public RPC HTTP access from this machine | Requests returned HTTP 403; public endpoints are documented but not operationally verified here |
| Local tools | Node 24.10.0, Circle CLI 1.2.1 and stock Forge present; **Arc Foundry not installed** |

Canteen's authenticated RPC URL contains a credential. Keep it server-side; do not place it in `NEXT_PUBLIC_*`, logs, browser bundles or this document. Its RPC allowlist is not a replacement for signing/spending controls. The CLI wallet commands can expose signing material; they were deliberately unnecessary for these read-only checks.

## Network configuration and contract inventory

Use canonical live configuration and check `eth_chainId` before signing. Current docs list mainnet as well as testnet; **only testnet was tested in this research**. Built-in viem `arc`/`arcTestnet` definitions are documented; confirm the selected installed release includes them, otherwise define the chain explicitly with native USDC **18** decimals. [Connect to Arc](https://docs.arc.io/arc/references/connect-to-arc).

| Field | Arc Testnet | Arc Mainnet, documented only |
|---|---|---|
| Chain ID | 5042002 | 5042 |
| Public RPC | `https://rpc.testnet.arc.io` | `https://rpc.mainnet.arc.io` |
| Explorer | `https://explorer.testnet.arc.io` | `https://explorer.arc.io` |
| Native currency | USDC, 18 decimals | USDC, 18 decimals |
| CCTP/Gateway domain | 26; not the EVM chain ID | Discover from current protocol chain tables |

Legacy `.arc.network` RPC links and `testnet.arcscan.app` appear in older material. Prefer current canonical endpoints, except the working authenticated Canteen endpoint already available locally.

| Testnet component | Canonical address | Use and caveat |
|---|---|---|
| USDC ERC-20 interface | `0x3600000000000000000000000000000000000000` | Six decimals; same underlying funds as native USDC |
| EURC | `0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a` | Six decimals; still pay gas in USDC |
| CCTP V2 TokenMessenger | `0x8FE6B999Dc680CcFDD5Bf7EB0974218be2542DAA` | Verify token route and domain separately |
| CCTP V2 MessageTransmitter | `0xE737e5cEBEEBa77EFE34D4aa090756590b1CE275` | Receive attested messages |
| Gateway Wallet | `0x0077777d7EBA4688BDeF3E311b846F25870A19B9` | Not interchangeable with GatewayWalletBatched |
| Gateway Minter | `0x0022222ABE238Cc2C7Bb1f21003F0a260052475B` | Protocol-specific mint flow |
| ERC-8004 Identity | `0x8004A818BFB912233c491871b3d84c89A494BD9e` | Bytecode checked; optional discoverability |
| ERC-8004 Reputation | `0x8004B663056A597Dffe9eCcC1965A193B7388713` | Reputation is not authorization or verified truth |
| ERC-8004 Validation | `0x8004Cb1BF31DAf7788923b405b754f57acEB4272` | Validate exact ABI and lifecycle before use |
| ERC-8183 reference | `0x0747EEf0706327138c69792bF28Cd525089e4583` | Bytecode checked; draft-standard lifecycle primitive |
| Memo | `0x5294E9927c3306DcBaDb03fe70b92e01cCede505` | Receipt metadata; public data is not confidential |
| Multicall3From | `0x522fAf9A91c41c443c66765030741e4AaCe147D0` | Sender-preserving batching; audit target and approval scope |

Addresses come from [Arc's canonical contract table](https://docs.arc.io/arc/references/contract-addresses). Before sending funds, verify network, bytecode, ABI, proxy implementation and deployment provenance. This inventory is not an audit. [ERC-8004 specification](https://eips.ethereum.org/EIPS/eip-8004), [draft ERC-8183 specification](https://eips.ethereum.org/EIPS/eip-8183).

## Ethereum baseline adapted to Arc

### Tooling

- **TypeScript + viem** for backend chain access: typed ABI reads, wallet/public client separation, simulation before write, receipt status checks. `writeContract` returns a transaction hash, not successful execution; use `simulateContract`, write the returned request, await `waitForTransactionReceipt`, check status, track replaced transactions and timeouts. Simulation is an earlier-state check, not a promise about execution. [Viem simulation](https://viem.sh/docs/contract/simulateContract), [receipt tracking](https://viem.sh/docs/actions/public/waitForTransactionReceipt).
- **Arc Foundry** for Arc-specific Solidity development and local testing, retaining Foundry's Solidity-native fuzz/invariant/fork methodology. Current official docs explicitly recommend `arc-forge`, `arc-cast`, `arc-anvil`; standard Anvil does not reproduce Arc runtime semantics. Use `arc-anvil --network arc`. Stock Foundry remains valuable for generic Solidity tooling but must not be treated as faithful Arc execution. [Installation](https://docs.arc.io/arc/tutorials/install-arc-foundry.md), [differences](https://docs.arc.io/arc/references/evm-differences.md), [Foundry testing](https://getfoundry.sh/forge/tests/overview/).
- **OpenZeppelin Contracts 5.x** for reusable ERC standards and security modules when custom contracts are needed. SafeERC20 supports tokens returning false or no value; `forceApprove` handles tokens requiring a zero reset. Use appropriate AccessControl/ReentrancyGuard modules, pin dependencies, and avoid an unnecessary upgradeable proxy layer. OpenZeppelin reduces implementation burden, not the need for integration/security testing. [SafeERC20](https://docs.openzeppelin.com/contracts/5.x/api/token/ERC20), [access control](https://docs.openzeppelin.com/contracts/5.x/api/access), [utilities](https://docs.openzeppelin.com/contracts/5.x/api/utils).
- **Direct RPC reads first**, contract events plus durable persistence/checkpoints for a small history. Add a dedicated indexer if scale/history queries require it. Infrastructure support is chain-specific; never assume The Graph, a Blockscout MCP server, or an enhanced Alchemy API indexes Arc because it supports Ethereum. [Ethereum indexing guidance](https://ethskills.com/indexing/SKILL.md), [Arc indexing](https://docs.arc.io/integrate/infrastructure/indexing-events.md).
- **Scaffold-ETH 2** is an optional rapid contract/debug frontend scaffold; choose it if its bundled interface meaningfully saves setup time. A backend-only transaction service needs viem rather than the full scaffold. React wallet interaction may use wagmi with viem; hooks returning hashes still require receipt tracking. [Ethereum tool guide](https://ethskills.com/tools/SKILL.md), [Scaffold docs](https://docs.scaffoldeth.io/).

### Arc-specific guardrails overriding generic Ethereum assumptions

1. **Arc is an EVM-compatible L1**, with current documentation targeting **Osaka** and select later features. It supports EIP-7702. Do not describe it as an Ethereum L2 or blindly inherit Ethereum fork assumptions. [Canonical differences](https://docs.arc.io/arc/references/evm-differences.md).
2. **USDC pays native gas**. Native balances and transaction value use **18 decimals**, while USDC's ERC-20 interface uses **6 decimals**. They reference the same underlying balance: adding both double-counts funds. Native-to-ERC20 raw-unit conversion divides by 10^12; native-to-human display divides by 10^18. The ERC20 interface truncates fractions below 10^-6 USDC; preserve native precision for accounting where necessary. USDC's interface address is `0x3600000000000000000000000000000000000000`. [Differences](https://docs.arc.io/arc/references/evm-differences.md), [addresses](https://docs.arc.io/arc/references/contract-addresses.md).
3. **Native transfer indexing differs**: EIP-7708 system emitter `0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE` emits Transfer events in native 18-decimal units. ERC20 interface events use six; index without duplicate counting. Gas deductions do not emit these Transfer logs; derive gas cost from receipts. [USDC system events](https://docs.arc.io/arc/references/usdc-system-events.md).
4. **Fee floor**: current canonical body states maxFeePerGas below **20 Gwei** is silently dropped, producing no receipt. A receipt timeout must not be mistaken for a successful or definitely reverted transaction; store intent/hash and investigate before retrying. [Differences](https://docs.arc.io/arc/references/evm-differences.md).
5. **Deterministic finality on inclusion**: one confirmation is enough for Arc; no generic Ethereum multi-block waiting delay. [Differences](https://docs.arc.io/arc/references/evm-differences.md).
6. **Value transfers may revert** due to blocklists, forbidden native burns, zero-address nonzero value transfers, and selfdestruct restrictions. PREVRANDAO is always zero. Block timestamps are non-decreasing, not strictly increasing; sort with block/transaction/log position. [Differences](https://docs.arc.io/arc/references/evm-differences.md).
7. **Source inconsistency**: repeated Arc page agent-preface text says blocklist reverts consume gas without receipt, while canonical body only states included blocklist-reverting transactions consume gas; do not generalize missing-receipt behavior to blocklist failures without an actual test. Clearly verified missing-receipt case is below-floor transactions silently dropped from the mempool.
8. Current docs list **mainnet and testnet**, with distinct addresses for ERC-8004 registries. Generic ethskills examples use mainnet identity address and must not be copied onto Arc testnet. Canonical testnet IdentityRegistry is `0x8004A818BFB912233c491871b3d84c89A494BD9e`, ReputationRegistry `0x8004B663056A597Dffe9eCcC1965A193B7388713`. [Arc contract addresses](https://docs.arc.io/arc/references/contract-addresses.md).
9. Canonical docs now expose a **unified App Kit SDK** with bridge, swap, unified balance, onramp, earn, borrow. Older ethskills/Canteen entries may only mention Bridge Kit/Gateway. Treat network support, gated access, package versions and operation capabilities as implementation-time checks. [Current documentation index](https://docs.arc.io/llms.txt).

### Agent architecture and wallet controls

Use an offchain scheduler/worker for background activity: contracts only execute when called. Separate reasoning from bounded typed execution tools. Validate chain ID, checksummed destination, verified contract/address, token decimals, amount, approval scope and fee budget. Persist intent state and hashes; serialize signing or otherwise coordinate nonces per signer. Keep secrets server-side, outside source/logs; use dedicated limited-balance wallets and encrypted/managed signing. [Ethereum concepts](https://ethskills.com/concepts/SKILL.md), [wallet skill](https://ethskills.com/wallets/SKILL.md).

For autonomous low-value writes, scoped developer-controlled wallets or session/permission mechanisms can reduce operational setup. Human signatures/multisig may suit administrative or high-value actions; verify provider deployment, EntryPoint, bundler/paymaster support and USDC gas support specifically on Arc. A multisig requiring a human on every operation changes autonomy. ERC-8004 establishes discoverable identity/reputation; it is not authorization, custody or proof of truth. x402 supplies payment middleware; network/facilitator support is separate from EVM compatibility. [Standards skill](https://ethskills.com/standards/SKILL.md), [Arc AA docs](https://docs.arc.io/arc/tools/account-abstraction.md), [Arc agent registries](https://docs.arc.io/arc/references/contract-addresses.md).


## Circle capability inventory

### Capability matrix

| Capability | Arc Testnet evidence | SDK / integration | Credentials, restrictions and costs |
|---|---|---|---|
| Send | App Kit uses Arc_Testnet; native USDC and ERC-20 assets | @circle-fin/app-kit; viem adapter | EOA signer or Circle Wallet credentials; native USDC pays gas. USDC native units are 18 decimals, ERC-20 facade 6. |
| Bridge/CCTP V2 | Arc domain 26 supports Standard, upfront fees and destination forwarding; source Fast Transfer is N/A because finality is already fast | @circle-fin/app-kit or @circle-fin/bridge-kit; direct contracts + Iris attestation API for low-level backend control | Wallet signer, source and destination funding; Circle Wallet adapter needs API key + entity secret. Standard protocol fee currently 0 bps; gas still applies; source-chain Fast fees apply when bridging INTO Arc from eligible chains. Estimate forwarding and custom fees. EURC and expanded-asset routes must be verified separately: current CCTP support page token section lists USDC and USYC although AppKit bridge advertises EURC/cirBTC/WETH/CCTPx. |
| Swap | Explicit Arc Testnet example swaps USDC to EURC; Arc supports USDC, EURC, cirBTC. Other testnets unsupported | @circle-fin/app-kit or @circle-fin/swap-kit | Optional environment-specific Circle API key raises rate limits; kitKey is legacy. Quote-dependent provider fees and optional custom integrator fees; price/slippage and available liquidity matter. |
| Unified Balance / Gateway | Arc_Testnet supported; Gateway domain 26 and arcTestnet API identifier, approximately 0.5 second deposit confirmation | @circle-fin/app-kit or @circle-fin/unified-balance-kit; Gateway contracts/REST | Owner signs deposit and spend authorization; delegate support. USDC only. Depositing costs chain gas; current Gateway crosschain transfer fee 0.005%, Arc burn gas fee $0.0035. Forwarding adds $0.05 service plus destination gas. Same-chain spend has no percentage fee. Fees are published current values, not guaranteed testnet charges; estimate per transfer. |
| Gateway nanopayments / x402 | Current quickstart explicitly uses an Arc Testnet EOA and GatewayWalletBatched discovery | @circle-fin/x402-batching, viem; sellers additionally @x402/express or @x402/evm | EOA only, SCA unsupported because EIP-3009 authorizations use ecrecover. Local private-key path avoids Circle Wallet credentials; hosted Wallet path needs API key/entity secret. $0.000001 minimum; offchain payments have zero per-payment gas, but deposits and withdrawals/bridging have costs. Supported Gateway chains except Solana. Do not treat standard GatewayWallet as identical to GatewayWalletBatched; discover supported contract from /v1/x402/supported. |
| Earn | Explicit Arc_Testnet vault exploration and deposit quickstart | @circle-fin/app-kit or @circle-fin/earn-kit | Optional API key, server-side only (browser key rejected), App Kits permission for restricted keys. USDC/EURC vault discovery; protocol fees vary by vault. Same-chain deposit fee zero; crosschain deposit CCTP fees; withdrawal currently zero subject to change. Morpho performance fee 0–50%, management fee 0–5% annual configurable; actual available vault/underlying protocol must be discovered, APY is not guaranteed. |
| Borrow | Explicit Arc_Testnet loan example, but overview's marketId is all-ones placeholder | @circle-fin/app-kit or @circle-fin/borrow-kit | cirBTC collateral, USDC debt; atomic-batch writes require Viem or Circle Wallets (not Ethers). Optional API key for limits; integrator fee configuration requires API key. Circle origination fee currently 0% subject to change; custom fee max 10,000 bps, split 90% integrator / 10% Arc. Discover a real market and obtain cirBTC; never copy placeholder marketId. Loan interest/liquidation risks are protocol dependent. |
| Onramp | Sandbox explicitly sends testnet tokens; sandbox widget documentation is available | @circle-fin/app-kit or @circle-fin/onramp-kit; no wallet adapter needed | Environment-specific server-only API key, backend creates 30-minute session. Debit/Apple Pay/Google Pay requires KYB and referrerDomain; country/payment restrictions apply; credit cards unsupported. Sandbox dummy data/no real money; only DEPOSIT_SUBMITTED fires, settlementExpected=false, DEPOSIT_SETTLED is not emitted. Verify destination balance. Provider/payment quote supplies fees. |
| StableFX | Arc Testnet contract/address tables and API sandbox quickstart available | RFQ REST API and Permit2 escrow settlement | Permissioned institutional service; Circle representative supplies StableFX key. Maker/taker access and quoted fees. AppKit Swap is the simpler separate capability; owning EURC does not grant institutional StableFX access. |
| USYC | Explicit Arc Testnet token 0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C and Teller 0x9fdF14c5B14173D74C08Af27AebFf39240dC105A | Teller contract and USYC portal | Wallet allowlisting required even on testnet; official restriction: qualified entities outside US, eligibility onboarding. 6 decimals. Yield-bearing fund shares, separate from Earn vaults. USYC CCTP currently only Ethereum/BNB, so an Arc USYC token address does not imply Arc USYC bridging. |
| EURC | Explicit faucet access and token 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a | ERC-20 / AppKit Swap | 6 decimals; gas remains native USDC. |
| xReserve | Explicit Arc Testnet source contract 0x008888878f94C0d87defdf0B07f46B93C1934442 | Deposit contract + attestation APIs + remote-chain integration | Arc source domain 26; remote destinations Canton, Aleo, Stacks, Cardano, Movement. USDC-backed remote tokens are USDCx, distinct from native USDC. More integration steps than ordinary CCTP; verify remote chain and fee/API requirements before choosing. |
| Circle Mint | Live supported-chains table lists ARC USD/EUR/CIRBTC | Institutional Mint REST API | Account onboarding and environment-specific key; Arc Testnet end-to-end banking support not proved by production chain table. Treat bank transfer/minting as institutional integration, not permissionless faucet. |
| Circle Payments Network | Current chain table lists Arc ONLY on Transactions V2 | OFI/BFI REST APIs | Financial institution participation, compliance onboarding and recipient-country coverage; no public self-serve Arc Testnet evidence in chain table. Quotes determine fees. |
| Circle permissionless Paymaster | NOT listed for Arc | ERC-4337 v0.7 / v0.8 contracts | Current v0.7 chains Arbitrum/Base; v0.8 Arbitrum/Avalanche/Base/Ethereum/Optimism/Polygon/Unichain. No API key, 10% surcharge only Arbitrum/Base + testnets. Arc already uses USDC native gas, so don't import these foreign-chain deployments. Arc ERC-4337 sponsorship requires separately supported provider/self-deployed paymaster; Arc docs describe funding EntryPoint in 18-decimal native USDC. |

### Exact packages

Unified package: `@circle-fin/app-kit`. Standalone packages: `@circle-fin/bridge-kit`, `@circle-fin/swap-kit`, `@circle-fin/unified-balance-kit`, `@circle-fin/onramp-kit`, `@circle-fin/earn-kit`, `@circle-fin/borrow-kit`. Adapters: `@circle-fin/adapter-viem-v2` + `viem`, `@circle-fin/adapter-ethers-v6` + `ethers`, `@circle-fin/adapter-circle-wallets` (server only), `@circle-fin/adapter-solana-kit` + `@solana/kit` + `@solana/web3.js`. Nanopayments: `@circle-fin/x402-batching`; Circle-hosted wallets: `@circle-fin/developer-controlled-wallets`.

Use one AppKit when several capabilities are needed, one standalone kit when only a single capability matters. New integrations should prefer the current unified SDK guidance over older separate Bridge/Swap-only snapshots. Verify published npm versions and chain discovery at implementation time; no packages were installed in this research.

### Live-vs-cache discrepancies

Live docs now advertise Mainnet, Osaka EVM, Arc Foundry, seven AppKit capabilities and cirBTC. Cached context is older. Gateway fee cache omits Arc and quotes Ethereum burn gas $2; live lists Arc $0.0035 and Ethereum $1. Live Gateway chain table's Solana row has dash API identifiers although overview includes Solana support; nanopayments explicitly excludes Solana. CCTP intro/header advertises EURC expanded-asset support while token support section lists only USDC/USYC: resolve exact token route from live API and addresses. Broad documentation header claims all APIs need keys, but feature-specific exceptions include local wallet/CCTP, nanopayment private-key, optional Swap/Earn keys and permissionless Paymaster. Follow feature pages.

### Circle primary sources

- [AppKit install/packages](https://docs.arc.io/app-kit/tutorials/installation)
- [AppKit chain/token matrix](https://docs.arc.io/app-kit/references/supported-blockchains)
- [Swap](https://docs.arc.io/app-kit/swap)
- [Earn](https://docs.arc.io/app-kit/earn), [Earn fees](https://docs.arc.io/app-kit/concepts/earn-fees)
- [Borrow](https://docs.arc.io/app-kit/borrow), [Borrow fees](https://docs.arc.io/app-kit/concepts/borrow-fees)
- [Onramp](https://docs.arc.io/app-kit/onramp), [sandbox/hosting](https://docs.arc.io/app-kit/references/onramp-hosting-requirements)
- [Gateway chains](https://developers.circle.com/gateway/references/supported-blockchains), [Gateway fees](https://developers.circle.com/gateway/references/fees)
- [Nanopayments buyer](https://developers.circle.com/gateway/nanopayments/quickstarts/buyer), [nanopayments](https://developers.circle.com/gateway/nanopayments)
- [CCTP chains/domains](https://developers.circle.com/cctp/concepts/supported-chains-and-domains), [CCTP fees](https://developers.circle.com/cctp/concepts/fees)
- [StableFX](https://developers.circle.com/stablefx), [sandbox quickstart](https://developers.circle.com/stablefx/quickstarts/fx-trade-taker)
- [Arc addresses incl USYC, EURC and cirBTC](https://docs.arc.io/arc/references/contract-addresses), [USYC eligibility](https://developers.circle.com/tokenized/usyc/overview)
- [xReserve domains/deployments](https://developers.circle.com/xreserve/references/supported-blockchains-and-domains)
- [Mint currencies/chains](https://developers.circle.com/circle-mint/supported-chains-and-currencies)
- [CPN chains](https://developers.circle.com/cpn/references/blockchains/supported-blockchains)
- [Circle Paymaster supported chains](https://developers.circle.com/paymaster)

## Agent runtimes and reusable code

## Minimal runtime selection

Recommendation (engineering inference): TypeScript on Node.js 22+, a single agent library, viem, Zod, PostgreSQL, and one execution strategy. Use Next.js App Router if a web interface is required; a plain Node.js worker avoids frontend scaffolding if only background execution is required. Keep transaction adapters independent of the LLM library. Most installed Arc examples already use Next.js/Supabase/viem, so this combination offers the greatest concrete code reuse. An ORM is optional: using existing Supabase migrations/client avoids introducing Drizzle and a second schema workflow solely for familiarity.

| Choice | Verified capabilities | Selection inference |
|---|---|---|
| Vercel AI SDK stable 6 | `ToolLoopAgent`, schema-defined tools, `stepCountIs`, streaming/provider abstraction; normal ToolLoopAgent is an in-memory loop | Strong default when UI streaming and model flexibility matter. Use version-specific docs: stable 6 uses `stepCountIs`; indexed main currently shows `isStepCount` and newer harness/workflow APIs. Do not copy main APIs into a stable 6 installation. |
| OpenAI Agents SDK TS | Agent loop, tools, handoffs, guardrails, tracing, serializable RunState for approvals/resume; runs within your own application | Prefer if OpenAI-centric orchestration and built-in tracing shorten development. State serialization and conversation persistence do not independently prove exactly-once payment execution. |
| LangGraph.js | Explicit graph/functional workflows, persistent checkpointers, interrupt/resume, replay of completed task results | Prefer when graph state, branches, and recovery are central. Adds checkpoint/graph configuration; avoid adopting alongside another agent orchestrator without a concrete need. |

Sources: [AI SDK stable 6 loop control](https://github.com/vercel/ai/blob/ai@6.0.0/content/docs/03-agents/04-loop-control.mdx), [AI SDK main WorkflowAgent durability discussion](https://github.com/vercel/ai/blob/main/content/docs/03-agents/07-workflow-agent.mdx), [official OpenAI SDK overview](https://developers.openai.com/api/docs/guides/agents/sdk), [OpenAI SDK RunState example](https://github.com/openai/openai-agents-js/blob/main/examples/agent-patterns/human-in-the-loop.ts), [LangGraph functional API](https://docs.langchain.com/oss/javascript/langgraph/functional-api).

## Durable execution versus payment safety

| Runtime | What it supplies | Remaining obligations |
|---|---|---|
| Inngest | Persisted `step.run` results; retries and event-driven durable functions; completed steps restored on replay | Incomplete steps may execute again. Every financial API call needs stable provider idempotency and reconciliation. Good fit for an existing Next.js app. |
| Trigger.dev | Tasks, queues/retries, checkpoint-resume, task trigger deduplication | Trigger idempotency stops duplicate triggers, not repeat execution of `run()` during retry. Provider idempotency is still essential. Good fit for separate Node.js background tasks. |
| Plain DB worker | Full control with no orchestration vendor; persisted operations/jobs and explicit polling | You implement claiming/leases, crash recovery, backoff, terminal states, deduplication and observability. Fewest services, more application reliability code. |

Sources: [Inngest retry/idempotency guide](https://github.com/inngest/website/blob/main/pages/docs/guides/error-handling.mdx), [Trigger.dev idempotency](https://trigger.dev/docs/idempotency), [LangGraph idempotency](https://docs.langchain.com/oss/javascript/langgraph/functional-api).

Required architecture (inference from replay semantics): generate a stable operation ID outside retryable execution; persist approved intent and canonical parameters before submission; unique-index operation ID and webhook event ID; pass the same Circle/provider idempotency key for all attempts; record provider transaction ID/hash; distinguish submitted/pending/confirmed/failed/unknown; reconcile status after timeouts before generating a new transaction. A crash after an external provider accepts a payment but before local checkpointing remains possible in all runtimes. Database transactions cannot atomically commit a remote chain/API effect. A `performed=true` DB flag alone is insufficient. For EOA transactions also serialize nonce assignment and persist signed transaction/hash before broadcast; rebroadcasting the same signed bytes is distinct from signing a new payment. Never let a fresh LLM tool-call ID substitute for the stable operation ID when the same operation is replanned.

Drizzle offers PostgreSQL unique indexes and transaction APIs; use an SQL migration workflow if adding it. Sources: [Drizzle indexes](https://github.com/drizzle-team/drizzle-orm-docs/blob/main/src/content/docs/pg/indexes-constraints.mdx), [Drizzle transactions](https://orm.drizzle.team/docs/transactions). Next.js Node.js route runtime is appropriate for SDKs. `after()` runs only within platform duration limits; treat it as response-lifecycle work, not a durable payment queue. Sources: [Next.js after](https://github.com/vercel/next.js/blob/canary/docs/01-app/03-api-reference/04-functions/after.mdx), [runtime configuration](https://nextjs.org/docs/app/api-reference/file-conventions/route-segment-config).

## Installed sample dependency audit

| Sample identifier | Observed lock versions (selected) | Reusable integration modules | Setup/copy caveats |
|---|---|---|---|
| arc-fintech | Next16.1.6, React19.2.4, viem2.46.3, DCW10.1.0, Bridge Kit1.6.0, wallet adapter1.2.0, Supabase2.97.0 | `lib/circle/developer-controlled-wallets-client.ts`, `gateway-sdk.ts`, `create-gateway-eoa-wallets.ts` | Circle API key + registered entity secret; Supabase project or local Docker; fund testnet wallets. |
| arc-prediction-markets | Next16.2.0, React19.2.4, viem2.47.6, wagmi3.6.0, modular-wallets-core1.0.13 | `lib/circle.ts`, wallet abstraction/hooks, Hardhat deployment scripts | Custom contract and mock oracle infrastructure deployment; this does not establish native production UMA availability on Arc. EOA deployer required; passkey wallet does not expose deployer key. |
| arc-commerce | Next16.1.6, React19.2.4, viem2.45.0, wagmi2.19.5, **DCW8.4.1** | `lib/circle/developer-controlled-wallets-client.ts`, `permit.ts`, webhook routes | **Manifest declares DCW^10.0.1 while lock resolves8.4.1**: reconcile before relying on npm ci. Circle webhook HTTPS tunnel; Supabase auth configuration. |
| arc-p2p-payments | Next16.1.6, React19.2.4, viem2.46.3, openai6.25.0, modular-wallets-core1.0.13 | Circle modular/passkey setup, webhook receiver | Circle client key/URL, browser WebAuthn, Supabase; README's DCW prerequisites may not match passkey user flow. |
| arc-multichain-wallet | Next16.1.6, React19.2.4, viem2.45.1, wagmi2.19.5, **DCW9.6.0** | `lib/circle/sdk.ts`, `permit.ts`, `gateway-sdk.ts`, wallet provisioning | **Manifest declares DCW^10.0.1 while lock resolves9.6.0**. Extra chains require native gas besides USDC; Supabase + Circle credentials. |
| arc-nanopayments | Next16.1.6, React19.2.4, viem2.47.1, x402-batching2.0.4, x402 core/evm2.6.0, Supabase2.99.0 | `lib/x402.ts`, buyer agent/scripts, Gateway withdrawal integration | Seller/buyer EOA keys, funded Gateway balance/testnetUSDC; OpenAI key optional mock mode; Supabase. Clearly isolate private keys. |
| arc-stablecoin-fx | Next16.2.4, React19.2.4, viem2.52.2, DCW10.3.1, adapter1.3.2, App Kit1.7.0, Supabase2.105.1 | `src/lib/circle/client.ts`, `wallets.ts`, `src/lib/appkit/swap.ts`, webhook receiver | Circle App Kit KIT_KEY + registered entity secret + Supabase; no LICENSE file in local checkout; do not assume blanket sample license. |
| arc-escrow | **Next14.2.15**, React18.2.0, openai6.22.0, **DCW4.6.0**, Supabase2.45.4 | amount conversion, `executeContract.ts`, SDK initialization and webhook-signature handling | Next manifest says latest but lock remains14.2.15; older SDK surface, contract deployment/SCP, OpenAI, ngrok. Extract individual modules after updating APIs. |

Seven installed samples have Apache-2.0 LICENSE files; arc-stablecoin-fx has none in the installed root. Package `license` fields are absent, so the LICENSE files are the evidence. Preserve notices when reusing code. These are examples with README testnet-only/nonproduction cautions, not security-audited templates. Most manifests use ranges or latest; lockfiles are more precise, and an npm ci compatibility check is required before selecting a base. This audit did not install or build sample dependencies.

Local references: each sample's `README.md`, `package.json`, `package-lock.json`, `LICENSE` in `~/.arc-canteen/context/samples/`. First-party online sources: [Circle sample repositories](https://github.com/orgs/circlefin/repositories), [arc-commerce](https://github.com/circlefin/arc-commerce), [arc-multichain-wallet](https://github.com/circlefin/arc-multichain-wallet), [arc-prediction-markets](https://github.com/circlefin/arc-prediction-markets). Local installed contents are the source of version claims; do not imply their remote branches remain identical.

## Additional official repository checks

[arc-x402-circle-wallets](https://github.com/circlefin/arc-x402-circle-wallets) currently has a README description only in the recursively inspected master tree, no package.json and no declared GitHub license. Treat as a placeholder, not runnable starter. Verified through GitHub API `repos/circlefin/arc-x402-circle-wallets/git/trees/master?recursive=1`.

[arc-ecommerce-payments](https://github.com/circlefin/arc-ecommerce-payments) is Apache-2.0 and has concrete reusable payment intent/escrow setup modules. Inspected master package declares Next16.2.7, React19.2.4, viem^2.52.2, wagmi^2.19.5, DCW/SCP^10.6.0, Supabase^2.108.0. These are manifest values, not installed lock verification. README supplies `npm run setup` provisioning/deployment, ERC-3009 collection and authorize/capture/charge/void/reclaim/refund paths. Requires Circle credentials/entity-secret registration, funded deployer/operator, Supabase; optional WalletConnect project ID. Its protocol contracts are not Arc-native default deployments; pinned deployment source is an additional setup step. Read contract provenance and verify addresses before reuse; only include this stack when authorization/capture semantics are actually needed.

## Contract deployment service

Circle Contracts is an optional managed deployment/interaction/monitoring service, with Arc listed in its current chain matrix. Use its SDK/API when existing Circle credentials and managed deployment save time; Arc Foundry plus viem remains the lower-dependency path for custom Solidity. Confirm ARC-TESTNET operation support, supported compiler settings, entity-secret registration, wallet funding and the deployed artifact before choosing it. Do not assume generic Arc listing proves every API operation. [Circle Contracts chain support](https://developers.circle.com/contracts/supported-blockchains).

## Wallet choice, control boundaries and credentials

| Path | Setup burden | Control boundary |
|---|---|---|
| Local EOA + viem | Lowest; dedicated testnet key and funding | Key can sign arbitrary transactions; place limits in contracts or a rigorously bounded signer service |
| Circle developer-controlled wallets | API key, registered entity secret, wallet set and funding | Managed signing; business policy and contract limits still required |
| Circle Agent Wallet CLI | Email OTP login; separate mainnet/testnet sessions | **Custom recipient/contract and spend policies are mainnet-only**; do not claim testnet enforcement |
| User-controlled/passkey or modular wallet | Client configuration, WebAuthn/onboarding, supported chain/account setup | Useful for user custody; verify session automation, bundler and EntryPoint deployment |
| Other embedded/AA providers | Provider account, chain-specific deployment and quota verification | Vendor listing does not prove every permission/paymaster API works on Arc Testnet |

Current Circle Wallets tables list EOA/SCA support on ARC and ARC-TESTNET for developer/user-controlled wallets, and modular wallet support. The developer-controlled quickstart requires Node 22.18+; the Agent Wallet CLI requires Node 20.18.2+. The CLI's authenticated sessions are documented as lasting 28 days. Email access is administrative authority: do not hand the agent unrestricted inbox access merely to automate OTP. [Wallet chain matrix](https://developers.circle.com/wallets/supported-blockchains), [developer-controlled setup](https://developers.circle.com/wallets/dev-controlled/create-your-first-wallet), [Agent Wallet custom policies](https://developers.circle.com/agent-stack/agent-wallets/wallet-operations/custom-policies).

Agent Wallet gas sponsorship currently advertises zero gas charges under fair-use terms; that is not universal free gas across Circle APIs. Its current fee schedule also lists swap 2 bps, Gateway crosschain 0.5 bps, and forwarding $0.05 plus destination gas. Check the chosen service's actual quote and terms. [Agent Wallet fees](https://developers.circle.com/agent-stack/agent-wallets/fees).

For contract-enforced bounds, compare a small custom vault/allowance contract with verified account/session permissions. Validate amount, cumulative budget, recipient, approved selectors, expiry, nonce/replay rules and revocation onchain. Do not let the same unrestricted signer both authorize a budget and bypass it by transferring directly from the budgeted account. Keep admin authority separate from routine execution. Treat this as an architecture requirement, not proof that any named wallet SDK supplies it automatically.

## Arc infrastructure and developer accelerators

The following are **official-directory discovery leads**, not tested provider integrations. Verify exact Arc Testnet API coverage, credentials, limits, deployed contracts and price before selecting one.

| Category | Listed ecosystem options | Fast-path judgment |
|---|---|---|
| RPC/node providers | Alchemy, Blockdaemon, dRPC, Goldsky, QuickNode | Working Canteen RPC first; second provider when quotas or production reliability require it |
| Indexers | Alchemy, Envio HyperIndex, Goldsky Turbo/Subgraphs, Pinax Firehose/Substreams, The Graph, Thirdweb Insight, Zerion | Persist receipts/events first; choose managed historical indexing only for needed queries |
| Wallet/AA | Alchemy, Biconomy, Blockradar, Circle, Crossmint, Dynamic, MetaMask Embedded, Para, Pimlico, Privy, Thirdweb, Turnkey, ZeroDev | Choose one custody model; verify session/bundler/paymaster support independently |
| Oracles | Chainlink, Chronicle, Pyth, RedStone, Stork | Add only for external-price/data dependence; verify per-feed deployment, decimals, freshness and confidence bounds |
| Compliance | Chainalysis, Elliptic, TRM Labs | Commercial onboarding; USDC blocklist handling does not replace a compliance program |

Sources: [nodes](https://docs.arc.io/arc/tools/node-providers), [indexers](https://docs.arc.io/arc/tools/data-indexers), [AA/wallets](https://docs.arc.io/arc/tools/account-abstraction), [oracles](https://docs.arc.io/arc/tools/oracles), [compliance](https://docs.arc.io/arc/tools/compliance-vendors).

**Arc Studio CLI** (`@circle-fin/arc-studio-cli`, Node 20+) is a remote build/deploy accelerator with server-side Vite/Foundry sandbox and login/run/pull workflow. Current docs limit deployment to testnet. It is optional development tooling, not a durable transaction executor. Verify generated code, deployed bytecode and receipts yourself. [Arc Studio CLI](https://docs.arc.io/ai/arc-studio-cli).

**Arc docs MCP** (`https://docs.arc.io/mcp`) supplies documentation search/retrieval; **Circle MCP** (`https://api.circle.com/v1/codegen/mcp`) supplies documentation/code generation. Neither substitutes for authenticated wallet or payment APIs. Canteen's synchronized context is useful offline discovery, but live primary docs win when capabilities differ. [Arc MCP](https://docs.arc.io/ai/mcp), [Circle MCP](https://developers.circle.com/ai/mcp).

**Privacy:** Arc's opt-in privacy system is documented as forthcoming, not currently available. Solidity `private` does not hide chain data. Keep confidential records offchain and put only suitable references/hashes onchain; a hash can still reveal low-entropy inputs. [Privacy status](https://docs.arc.io/arc/concepts/opt-in-privacy).

## Accounting, fees and documentation traps

Use integer `bigint` values with explicit asset/unit context. One USDC is `10^18` native units or `10^6` ERC-20 units. Do not add native balance and ERC-20 balance, and do not use an ERC-20 conversion for a native transaction's `value`.

For indexing, native system Transfer logs cover native and ERC-20 movement in 18-decimal units; ERC-20 movement also emits six-decimal logs at the USDC facade. Choose one canonical movement stream or deduplicate explicitly. Gas charges are separate: `gasUsed × effectiveGasPrice`, in native units. Historical event sources changed across Arc upgrades; consult node changelogs before backfilling older ranges. [USDC events](https://docs.arc.io/arc/references/usdc-system-events).

Current Arc docs describe an approximately $0.001 ERC-20-transfer fee under normal conditions, and a testnet gas-price floor of 20 Gwei. These are documentation values, not a promise of constant fees. Quote gas, reserve a fee budget and inspect receipts. Arc inclusion finality does not remove source-chain confirmation, attestation or liquidity delays in a crosschain operation. [Gas and fees](https://docs.arc.io/arc/references/gas-and-fees), [CCTP chain support](https://developers.circle.com/cctp/concepts/supported-chains-and-domains).

Resolve these observed conflicts before copying examples:

- Context7 indexed chain snippets contained an incorrect testnet hex ID and native-decimals configuration. Canonical docs plus runtime chain ID override them.
- A live gas example used six-decimal parsing for native `value`, contradicting the documented 18-decimal native balance. Follow the unit model.
- Older cached CCTP and Memo addresses differ from the current deployment table. Use the canonical network-specific addresses above.
- Live docs describe Osaka, mainnet, Arc Foundry, cirBTC and expanded App Kit capabilities beyond older Canteen material.
- Repeated documentation prefaces and canonical bodies disagree about receipts for blocklist failures. A below-floor dropped transaction clearly has no receipt; do not generalize that behavior to every revert.
- Capability headers, token matrices and per-route support sometimes differ. API discovery and an actual test transaction are the final integration checks.

## Selection and verification gates before implementation

1. **Choose custody and execution first:** EOA versus managed signer; autonomous permissions versus human approvals. Confirm any required limits can actually be enforced on the selected network.
2. **Check setup blockers:** secrets/accounts, institutional onboarding, allowlisting, API quota, testnet faucet/funding, licenses and available token/market routes.
3. **Pin dependencies:** reconcile starter manifests and lockfiles; use release-specific SDK documentation and one package-manager lockfile.
4. **Smoke-test the chain path:** chain ID, native/asset balance, decimals, contract bytecode, gas estimate, simulation, submission and successful receipt. Test a failure and an unknown/timeout case too.
5. **Prove retry safety:** interrupt after submission but before DB confirmation; recovery must reconcile the existing operation without sending another payment. Test concurrent nonce use and duplicate webhooks.
6. **Verify contract bounds:** rejected overspend, incorrect recipient/selector, replay, expiry and unauthorized administration; use Arc Foundry fuzz/invariant tests where applicable.
7. **Only then add optional capabilities:** crosschain, nanopayments, swaps, indexers, identity registries or yield. Each must have a demonstrated benefit that outweighs its setup cost.

The strongest default is therefore a small TypeScript/viem/PostgreSQL stack with one agent runtime and one signer path, expanded only with Circle capabilities whose testnet access has been confirmed. This conclusion is a speed/reliability judgment, not a benchmark of every vendor. Credential-gated services, new SDK installations and deployed-contract security remain unverified until the implementation checks above are performed.
