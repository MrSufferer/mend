# Controlled provider restoration

Approved direction: stop waiting for BlockRun to develop provider integration. Independent adoption remains unproven and issue #44 remains open.

Deliver a runnable reference integration between two separately served components: a JSON-to-CSV provider and Mend's restoration API. This is controlled evidence, including a local payment ledger; it is not an independent x402 integration or production-money readiness. Preserve the existing PDF flow and accepted UI.

The provider persists a request ID and immutable input before purchase. A controlled confirmed receipt binds that request to its payer and purchased terms. Execute CSV conversion at most once per request and consume each receipt once. Commit the purchased result before attempting delivery or registration. Retrying after an interrupted response or failed registration restores the original bytes without charging, executing, or extending retention.

Mend accepts retained results only from a configured provider credential. Verify payment through a configured authority adapter; derive payer/request/merchant/network/amount from that evidence, never trust caller claims alone. This iteration implements only a controlled local ledger adapter, enabled explicitly by the demo. Store immutable provider identity, payment correlation, purchased expiry, validated result bytes and digest. Conflicting registrations fail closed. Provider enrollment is static, explicit configuration; no public enrollment or arbitrary URL fetches.

A buyer retrieves results through a short-lived, single-use challenge signed by the original paying EOA wallet. Bind the signature to Mend's configured audience, request identity, wallet and nonce. Private identifiers alone grant no access. Unauthorized, missing and expired results do not disclose their contents. Restoration exposes no execution, retry or refund action.

Use durable local SQLite on Node 24 for this standalone reference deployment. Do not run on an ephemeral filesystem or present it as the existing hosted Next.js application. Bound payloads, retention and challenge storage; fail closed on unavailable or contradictory evidence. No secrets, private results or wallet signatures in logs. No live purchases, provider outreach or deployments.

Acceptance: public HTTP tests prove lost original response, service restart, concurrent recovery, replay protection, wrong wallet, conflicting registration, payment mismatch, failed-registration reconciliation, expiry, and reuse of a payment receipt across requests. Demonstrate two separate HTTP services with a documented command. Provide check results and separate remaining independent-provider and live-payment gates.
