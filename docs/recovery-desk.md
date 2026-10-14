# Recovery desk

The private operator desk defaults to unresolved obligations. Its server projection puts cases with persisted escalation first, then overdue obligations ordered by their original delivery deadline. Unpaid, processing and completed views expose other records without changing obligations. File expiry never settles an order.

Selected cases show canonical receipt, delivery, execution and disposition facts separately from model-selected tool observations. Action evidence and durable invocation deadlines remain visible across reloads. Late delivery is explicitly labeled. Operator access does not grant customer document downloads.

`RECOVERY_AGENT_URL` is the backend invocation base URL, including its existing path prefix. `RECOVERY_AGENT_SECRET` is a narrow service bearer token matching the backend's `AGENT_SERVICE_SECRET`. These are server-only web configuration. The web must never receive `OPENROUTER_API_KEY`, merchant, administrator or registrar signing keys. The POST operator endpoint requires an operator session and the configured same origin; it rejects upstream redirects and returns a fresh database projection rather than forwarding provider output.

The UI displays the persisted 12-call case allowance and 60-second invocation bound. Exhaustion prevents further UI requests; handlers remain authoritative. A browser/request timeout leaves the investigation history visible for refresh. Existing deterministic reconciliation and separately authorized refund obligations continue when model execution fails. This slice does not implement retry/spending authority or refund registration.

Validation: `TEST_BASE_URL=http://127.0.0.1:3033 node node_modules/@playwright/test/cli.js test tests/recovery-desk.spec.ts` against an isolated server with the disposable `44` EOA as local operator verifies unsigned access denial, signed filters and genuine SIWE browser display. The fixture is synthetic; these UI checks are not live-model or payment acceptance evidence.

The five checks also verify that signed customers receive 403, invalid UUIDs receive 404, cross-origin investigation receives 403, and the existing paid-order projection orders intervention before overdue deadlines. Queue validation uses existing paid cases and narrow-worker escalations; no new payment histories were fabricated. An optional privileged remote-fixture setup was rejected by automatic approval review and was abandoned; read-only validation covers the behavior instead.
