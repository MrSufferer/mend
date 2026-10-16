# Data, retention and authority

Mend is an Arc **testnet** demonstration. It charges1 test USDC for a bounded text-PDF conversion. Direct payer-to-merchant settlement does not escrow the purchase in the refund reserve. The120-second delivery deadline begins only at receipt-confirmed payment. An elapsed deadline makes unresolved work overdue; it does not prove a refund entitlement or guarantee prompt recovery.

## Providers and document exposure

Vercel runs the web API and can access document bytes during validation. Uploads travel directly to private Neon Object Storage using short-lived signed grants. Neon stores uploads/plain text and authoritative order, policy, execution and recovery records; Neon Functions execute the bounded parser/reconciliation services. PDF.js performs local text extraction. Documents and plain text are not placed onchain, and an external model is not used to extract the PDF.

Recovery uses the AI SDK with direct OpenRouter access; the configured model is `nvidia/nemotron-3.5-lightning:free`. OpenRouter selects the upstream inference provider; the current implementation does not pin a named provider. The actual upstream host in the dated live demonstration was not independently recorded and remains UNKNOWN. NVIDIA-branded model identity does not establish NVIDIA-hosted inference. OpenRouter and the selected inference provider see minimized order/execution metadata and tool-selection messages. Document contents, credentials, signed storage grants and private object paths are excluded from model prompts. A release receipt must distinguish the configured model from the observed upstream provider; until a provider receipt exists, that disclosure check remains untested. See the [independent trust review](release-trust-review-2026-10-16.md). Their infrastructure can observe requests/metadata; no stronger confidentiality or zero-retention promise is made here.

Arc/Circle, the facilitator, RPC and explorer providers can observe wallet/transaction metadata. Canteen RPC authentication remains server-only. Entitlement IDs, payer addresses, amounts and contract events are public. Operational metadata may remain after content expiry. Infrastructure administrators and a compromised provider can affect availability or access server-held data; private storage and role isolation do not remove provider trust.

## Retention and access

An upload expires seven days after upload; an output expires seven days after its own creation. Restoration, retry and download do not restart an existing object's clock. Authenticated retrieval checks original-payer ownership and expiry; signed upload retrieval grants last at most60seconds and never beyond expiry. A signed grant is a bearer capability during its validity.

Access cutoff and physical deletion are separate. Scheduled bounded sweeps delete expired bytes and verify absence; free-tier scheduling, cold starts, outages and storage uncertainty may delay deletion. A successful sweep can leave a backlog. Pending/failed deletion is observable and retried, without promising physical deletion at the exact deadline. A late recreated object is subject to another sweep. Content removal does not erase purchased obligations, immutable delivery history, policy, audit or receipt evidence. An expired previously delivered file is not a conversion failure or a new refund entitlement.

The browser purchase journal stores the submission capability, order ID, payer identity and exact signed payment authorization in IndexedDB at the purchase origin. It does not store PDF bytes or a wallet private key. Browser origin access is part of the trust boundary: same-origin code and someone with access to the browser profile may access that material. Hiding another account's pending purchase is a UI privacy guard, not encryption. Sign-out removes active private query/download state while retaining recovery material for the original payer. Clearing site data can destroy unsettled recovery; authentication alone does not reconstruct it. See the [browser recovery contract](browser-purchase-recovery.md).

## Who can do what

| Authority | Powers and limitations |
| --- | --- |
| Paying EOA | Signs payment and SIWE; can inspect/retrieve its own order. Connection alone proves no identity. Another wallet or unpaid capability cannot retrieve claimed private content. |
| Merchant | Receives the purchase directly. Its signing key is not required in the web or recovery services. Refund reserve funding is a separate operator responsibility. |
| Web | Validates submissions and sessions, forwards scoped execution/operator requests and serves ownership-gated results. No purchaser, merchant, administrator, registrar, refund-worker or model signing authority belongs here. |
| Conversion | Reads private upload, extracts text and publishes under durable generation/disposition fences. It cannot sign refunds or rewrite purchased terms. Parser exit does not establish whole-execution termination. |
| Recovery agent | Selects bounded tools from durable metadata; cannot create its own entitlement, rewrite evidence/policy or spend reserve funds. At most12 model calls per case and60seconds per investigation; deterministic reconciliation survives model failure. |
| Registrar | Separately validates original payment, stopped execution, recovery exhaustion and no valid output before registering immutable original-payer/amount entitlement. Its isolated signing key is trusted: a compromised registrar can authorize false entitlements. |
| Refund worker | Pays only registered entitlement to its recorded original payer/amount, once, within the contract cap. Cannot register entitlement or grant roles. A compromised worker can spend eligible entitlements up to available funding/cap. |
| Administrator | Can grant/revoke contract roles, appoint a malicious registrar or combine roles. Keep the administrator key local, outside deployed recovery services. The reserve has no proxy, withdrawal, arbitrary-call, entitlement-edit or cap-change function. |
| Operator/infrastructure owner | Can change future policies, provision/deploy services, fund reserve and manage provider access. Purchased policy snapshots remain immutable in normal application authority. A database/provider administrator remains a trusted infrastructure authority. |

## Refund and availability terms

Eligible refunds return the full purchase price to the **original payer**; network gas is excluded. There is no unconditional timeout refund or permissionless refund path if the operator, registrar or worker disappears. Correct offchain eligibility depends on the registrar and durable evidence. Circle transfer restrictions or infrastructure outages can prevent settlement even for an eligible entitlement.

The reserve has an immutable10 test USDC UTC-calendar-day cap. Aggregate reserve balance, allowance, unmined/signed debt and successful canonical receipts determine available capacity. Pending receipts, exhausted allowance and reserve shortage remain visible unresolved obligations, with deterministic retries and UTC rechecks; they do not promise a completion time. A historical balance is not a funding guarantee.

Free hosting can delay conversion, cancellation observation, model investigation and scheduled recovery. Unknown execution/publication remains unknown until evidence resolves it; a hard kill or lease expiry is not proof of stopped work. Sales can pause after related failures or deterministic thresholds while existing paid recovery continues. Reopening requires explicit authenticated operator action and current health/capacity checks. There is no force-refund or mark-resolved shortcut for uncertain evidence.
