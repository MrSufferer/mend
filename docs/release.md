# Reproduce and assess the release

Mend uses Next.js on Vercel Free, Neon PostgreSQL/Functions/private Object Storage, Arc testnet and direct OpenRouter inference with an OpenRouter-selected inference provider. Neon AI Gateway was superseded by the approved direct-provider choice. The final public release remains subject to the gates below.

## Source and build inputs

Use the exact reviewed commit recorded by a completed release receipt, a clean worktree, and `package-lock.json`. Capture the commit, `git archive` SHA-256, lockfile SHA-256, Node/npm versions, platform/architecture and build command with the result. The reproduction environment used during preparation is Node **24.10.0**, npm **11.6.1**; package engines allow Node22.13+, but that range alone is not exact reproduction. Runtime backends target Node24 ESM. Major direct pins include Next16.4.0, React19.3.0, TypeScript7.0.2, PDF.js6.4.299, AI SDK7.0.139, OpenRouter provider3.1.0, viem2.57.5 and Playwright1.64.0; the complete dependency graph is the lockfile.

```sh
npm ci
npm run typecheck
npm run build -- --webpack
node --test tests/deployment-completion.test.mjs tests/deployment-cli.test.mjs
```

Webpack is the recorded build mode, pinned for hosted builds in `vercel.json`; this guide does not assert a default Turbopack build passed. Commands describe reproduction, not a new run receipt. Run browser/HTTP lifecycle checks only with the isolated credentials and database described in [recovery lifecycle](recovery-lifecycle.md). That suite makes real process/SQL/browser calls and controls external chain/model/storage effects. No CI success is asserted.

## Schema and configuration

The checked-in `drizzle/meta/_journal.json` and ordered SQL files are authoritative. The current prefix contains **47** migrations, ending `0046_private_retention`; record every ordered SHA-256 and timestamp, rather than just the count. Replay the full prefix against an empty isolated database before applying an append-only delta to the enrolled main database. Preserve the original migration prefix. Use the migration-owner `DATABASE_URL_UNPOOLED` only in a local migration process for `npm run db:migrate`; never place it in a runtime. Do not use schema push. Runtime role grants are part of the migrations and require effective privilege readback.

| Process | Configuration names and boundary |
| --- | --- |
| Web | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` for `mend_web`; web-only `AWS_ENDPOINT_URL_S3`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`; `UPLOAD_BUCKET`, `OUTPUT_BUCKET`; `SESSION_SECRET`; `OPERATOR_WALLET_ADDRESS`, `MERCHANT_ADDRESS`, `ARC_CHAIN_ID`, `X402_FACILITATOR_URL`; server-only `ARC_RPC_URL`; optional `APP_ORIGIN` matching the actual origin. |
| Web execution/operations | `CONVERSION_FUNCTION_URL`, `CONVERSION_SERVICE_SECRET`; `RECOVERY_AGENT_URL`, `RECOVERY_AGENT_SECRET`; `OPERATOR_CONVERSION_URL`, `OPERATOR_CONVERSION_SECRET`; `OPERATOR_REGISTRAR_URL`, `OPERATOR_REGISTRAR_SECRET`. These are distinct authorities; verify the enrolled runtime counterpart before binding. |
| Web health | `HEALTH_CONVERSION_URL`, `HEALTH_CONVERSION_SECRET`, `HEALTH_REGISTRAR_URL`, `HEALTH_REGISTRAR_SECRET`; synthetic health authority does not grant purchase or operator execution. |
| Conversion | Conversion-role database and private storage, buckets, `CONVERSION_SERVICE_SECRET`, `AGENT_CONVERSION_SECRET`, `OPERATOR_CONVERSION_SECRET`, `REGISTRAR_CONVERSION_SECRET`, `HEALTH_CONVERSION_SECRET`, `OPERATOR_WALLET_ADDRESS`, `RECONCILIATION_TRIGGER_ID`. No signer, model or web-session authority. |
| Agent | Worker-role database, `AGENT_SERVICE_SECRET`, `AGENT_CONVERSION_URL`, `AGENT_CONVERSION_SECRET`, `AGENT_REGISTRAR_URL`, `AGENT_REGISTRAR_SECRET`, `AGENT_TRIGGER_ID`, `OPERATOR_WALLET_ADDRESS`, `OPENROUTER_API_KEY`, `RECOVERY_MODEL_ID`. No usable signing, document storage or session credentials. |
| Receipt reconciliation | Payment-reconciler database, `ARC_RPC_URL`, `RECEIPT_SERVICE_SECRET`, `RECEIPT_TRIGGER_ID`; no document storage/signing authority. |
| Registrar | Registrar-role database, `ARC_RPC_URL`, isolated `REGISTRAR_PRIVATE_KEY`, `REGISTRAR_SERVICE_SECRET`, `AGENT_REGISTRAR_SECRET`, `OPERATOR_REGISTRAR_SECRET`, `HEALTH_REGISTRAR_SECRET`, `OPERATOR_WALLET_ADDRESS`, `CONVERSION_FUNCTION_URL`, `REGISTRAR_CONVERSION_SECRET`, `MERCHANT_ADDRESS`, `X402_FACILITATOR_URL`. No refund-worker or administrator signer. |
| Refund worker | Refund-worker-role database, `ARC_RPC_URL`, isolated `REFUND_PRIVATE_KEY`, `REFUND_SERVICE_SECRET`, `REFUND_TRIGGER_ID`, `REGISTRAR_SERVICE_URL`, `REGISTRAR_SERVICE_SECRET`; no registrar/admin/model/document-storage authority. |

Existing deployments explicitly disable some provider-injected sensitive names. A name-only environment inventory cannot establish that a key is usable or absent: validate role-specific authority with narrowly scoped runtime probes. Keep all secrets server-side and out of archives, issue attachments, browser bundles and logs. Preserve session secrets and existing peer/schedule bindings when adding configuration.

## Deployment identity and order

Deployment management is separate from runtime. Enroll an explicit function slug and private service environment file, with its destination/role identity sidecar, for each deployment; peer bindings require their own explicit enrollment. `docs/agents/workflow.md` in the development workspace specifies this guard. Never infer a service destination or replace a missing credential by generating a secret that disconnects existing callers.

For initial provisioning with a complete enrolled credential inventory, the role scripts are `scripts/deploy-conversion.mjs`, `scripts/deploy-agent.mjs`, `scripts/deploy-receipts.mjs` and `scripts/deploy-refund.mjs`; inspect each role's required private inputs before use. There is no checked-in standalone registrar provisioning script. These full-environment provisioning paths are not the preservation rollout path for an existing runtime with write-only values.

Use `scripts/deploy-release.mjs` for existing-service rollout. It requires `MEND_REVIEWED_SHA`, the role's explicit `*_FUNCTION_SLUG` and enrolled `*_SERVICE_ENV`; default mode builds only. With `--deploy`, it additionally requires `MEND_PREVIOUS_DEPLOYMENT_ID` and `MEND_SCHEMA_RECEIPT` pointing at `{ "sha": "<reviewed full SHA>", "project": "<project>", "branch": "<branch>", "journal": [{ "hash": "<SQL SHA-256>", "when": 0 }] }` with the complete ordered actual journal values. The receipt must follow verified application/readback, not merely a local generated hash list. The rollout sends only the role's new narrow `WEB_*` aliases and preserves old environment values by omission. `conversion` needs independent `WEB_CONVERSION_SECRET` and `WEB_OPERATOR_CONVERSION_SECRET`; `agent` needs `WEB_OPERATOR_AGENT_SECRET`; `registrar` needs `WEB_OPERATOR_REGISTRAR_SECRET`; receipt/refund rollout has no new environment delta. Bind the web's existing caller names to these independently scoped credentials only after backend support and authority tests pass.

```sh
# Run from the exact clean reviewed checkout with enrolled private inputs loaded.
node scripts/deploy-release.mjs conversion
# After independently verified schema receipt and predeployment ID readback:
node scripts/deploy-release.mjs conversion --deploy
```

Repeat for the reviewed dependency order using `conversion`, `registrar`, `agent`, `receipts` or `refund` as appropriate; do not reroll unchanged responsibilities just to generate newer IDs. Preserve signing authority and schedules. The exact-clean-source check intentionally rejects an edited worktree.

The canonical database destination is project `morning-bar-76751353`, branch `br-patient-wave-azrhhl2v`. Vercel project is `mend`, project ID `prj_kxV9vCU6WSADn5BbRmGdhDRX3vSI`, team `team_YqQOxoqIXZLtwGdjXoF27rRD` (`gadillacers-projects`). Use provider-generated URLs on the approved free plans. No custom domain or purchased plan is required.

After isolated schema/checks and independent review, record the exact clean SHA and migration receipt. Apply only the reviewed schema delta, deploy compatible backend dependencies before callers, then deploy web from the exact clean source archive with the correct target's server-only environment. Preserve old write-only backend values by reviewed environment carry-forward; do not replace their whole environment from incomplete local files. Recheck clean HEAD after asynchronous bundling. Record bundle/archive digests and exact deployment IDs, and poll the newly created ID until it is both completed and current/active. Provider metadata ties the submitted artifact to an ID; it does not prove an independently downloaded remote byte digest.

Record all current functions and actual schedules with their IDs, versions, cron, enabled state and target. There are five current backend responsibilities; an obsolete function may still exist and must not be mistaken for the active conversion destination. Preserve ordinary reconciliation, agent, receipt and refund schedules; retention is integrated into the conversion sweep. Observe a completed ordinary scheduled run after deployment, including bounded backlog progress. A successful manual invocation does not establish scheduled execution.

Prove normal anonymous access to public entry routes without a provider protection bypass, then authenticated SIWE/private result and operator health paths. Keep customer/operator identity checks intact. A preview-scoped environment export does not establish production configuration. Retain sanitized receipts with source, exact provider hostname/ID, schema hashes, role grants, schedules, contract identity, checks, timestamps and remaining gates. Raw environment inventories stay private.

## Contract reproduction

The [reserve manifest](../contracts/deployment/arc-testnet.json) records Arc testnet5042002, reserve `0x76b29d6a6eab98b32415b8a6adf5d587d991e082`, token facade `0x3600000000000000000000000000000000000000`, constructor arguments, roles, receipts and terminal Blockscout verification. The [shared ABI](../contracts/deployment/RefundReserve.abi.json) is the application interface. Its daily contract cap is10 test USDC, in six-decimal units. Manifest balances are historical observations.

Use Arc Foundry **v0.8.0-2**, reported1.7.1-dev commit `d497beea7096ff2a8e583c8b307941f24a61b06b`, Solidity **0.8.30+commit.73712a01**, Prague, optimizer200. Initialize pinned submodules: OpenZeppelin5.4.0 commit `c64a1edb67b6e3f4a15cca8909c9482ad33a02b0`, forge-std1.9.7 commit `77041d2ce690e692d6e03cc812b57d1ddaa4d505`. Follow [contract tooling](../contracts/README.md), run the checked-in1000 fuzz/stateful invariant settings and gas snapshot **check**, and use Slither0.11.5. Do not overwrite the snapshot or committed ABI to hide drift. Record exact tool/compiler/build inputs and compare generated ABI to the committed interface.

Routine reproduction needs no deployment, funding or refund transaction. `scripts/reserve-admin.mjs` signs/broadcasts and is not a setup command. The historical `scripts/reserve-check.mjs` also rewrites the tracked manifest; use an inspected independent read-only snapshot for fresh observations. Read chain/code/roles/reserve/allowance and canonical receipts at a recorded block; do not reinterpret old synthetic contract exercises as a genuine failed-customer refund.

### Fresh contract verification observation

At **2026-10-15T18:26:01.540048Z**, block **67371576**, a separate clean checkout at `2fb585d6d36a1e44beca0a81b296e7717af47147` reproduced the contract with the pinned tools/dependencies. Two test runs passed8 direct tests and2 invariants; fuzz1000, each invariant1000×depth64 with0 reverts; the explicit second seed was `0x17`. Gas snapshot check and committed/generated ABI equality passed. Slither0.11.5 analyzed42 contracts with101 detectors and0 findings, filtering only library/test paths.

Read-only Arc/explorer checks confirmed all six historical deployment/funding/synthetic and genuine obligation registration/refund receipts remained canonical successful, expected roles for the three named manifest accounts, correct token/cap, reserve **8 test USDC**, and remaining UTC allowance **10 test USDC**. These are dated observations, not future funding guarantees or an enumeration of all role holders.

The default Foundry auto-remapping build currently adds `erc4626-tests/` and `halmos-cheatcodes/` metadata absent from the original verified build, so its complete bytecode differs. Using the explorer's exact verified Solidity standard JSON source/settings resolves this: **full runtime bytecode including CBOR and immutable token equals deployment, and full original creation bytecode plus constructor arguments equals the verified compilation**. Every explorer source/dependency matched the pinned files, and the normalized ABI matched the committed interface. This is a compiler-input reproduction difference, not a contract logic defect. To reproduce exact bytes, use the checked-in [exact public standard input](../contracts/deployment/verified-standard-input.json), bound to the [verified source response](https://explorer.testnet.arc.io/api?module=contract&action=getsourcecode&address=0x76b29d6a6eab98b32415b8a6adf5d587d991e082), preserve its source/settings and run the pinned solc0.8.30 `--standard-json`; do not substitute auto-detected remappings. Preserve constructor arguments from the manifest. Rerun if contract source/pins change. This contract check is not independent product release QA.

## Browser checkout extension

[Implement approved inline browser checkout and durable purchase recovery](https://github.com/MrSufferer/mend/issues/33) adds browser submission and payment to the existing lifecycle. Its source review and isolated browser checks must be recorded separately from the historical source96 deployment below. Checkout human acceptance in [Independent customer and operator acceptance](https://github.com/MrSufferer/mend/issues/32) requires a verified deployment containing the exact reviewed checkout commit. Keep its human checklist unchecked until the human runs it. An old preview URL is not evidence that the new purchase flow is deployed.

## Acceptance status

The [2026-10-15 public acceptance observations](release-acceptance-2026-10-15.md) identify exact runtime source96, the public preview origin, completed/current backend IDs, schema/authority readback, authenticated privacy/health checks and the bounded real-provider early-pause demonstration. Its sanitized receipts are checked in alongside the report. Historical paid/model/refund scenarios remain separately dated in [demonstrations](release-demonstrations.md); fresh contract reproduction is summarized in [contract verification](contract-verification.md).

The [2026-10-16 independent release review](release-qa-2026-10-16.md) and [trust/CROPS/contract review](release-trust-review-2026-10-16.md) record fresh source, deployed browser/HTTP/health, lifecycle, canonical receipt and verified-bytecode checks with explicit untested gates. Fresh inventory and independent HEAD observations found all201 due staging objects absent, zero pending/unknown, resolving the dated retention backlog limitation. Fresh receipt-function platform invocations are observed; no eligible work or receipt business effect is claimed, and ordinary-trigger attribution remains circumstantial. OpenRouter-selected upstream inference-host identity remains UNKNOWN, an open disclosure gate. No new live purchase/refund/model investigation or main resume was run. The historical live pause remains a synthetic isolated-failure observation ending `insufficient_evidence`, with its refund request refused. Independent review completion is conditional evidence, not unconditional production release approval.

No new paid plan, credits, production funds, extra test purchase, budget reset or repeated model-quota probing is implied by these reproduction commands. When live access is unavailable, retain the exact failed gate and next useful retry condition instead of claiming completion.
