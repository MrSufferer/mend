# Outcome showcase and customer workflow

The selected Outcome direction leads with an explicitly illustrative recovered PDF order. The public overview does not fetch customer orders or present the sample as a live recovery or confirmed download.

- `/`: recovery story and optional sample evidence.
- `/convert`: actual PDF purchase, contextual wallet access, purchase consent and private browser recovery journal.
- `/orders`: authenticated customer orders, current outcome and download first. Purchased terms, upload retention, refund evidence, attempts and history are expandable.
- `/recovery`: separate authenticated operator workspace; intervention controls remain available.

A receipt-confirmed purchase leads to its order. An uncertain signed purchase continues to offer Check existing payment, including when sale configuration is unavailable. This reuses the saved authorization. A delivered result without a refund case does not display a misleading refund-unresolved warning. File expiry does not establish refund eligibility or reverse delivery.

No backend, schema, payment authority or refund policy changes are included. The sample PDF button follows the actual purchase path and costs 1 test USDC plus gas on Arc testnet. Production wallet actions and human acceptance are separate from automated fixtures.

Validation uses `npm run typecheck`, `npm run build -- --webpack`, `tests/outcome-browser.spec.ts`, and the isolated destination-verified recovery browser/checkout suites. Run long checks through `scripts/check-log.mjs`. Recovery tests require the dedicated `RECOVERY_ENV_DIR`; never substitute production credentials. Human QA issue 32 remains unchecked until a human executes it.
