# Interrupted recovery lifecycle proof

Issue [#16](https://github.com/MrSufferer/mend/issues/16) adds a deliberately separate Playwright suite. It runs the real Next HTTP routes, SIWE verification, conversion/parser processes, agent SDK dispatch, registrar and refund services against real PostgreSQL. External storage, settlement, chain and model effects are controlled fixtures. This supplements each slice's tests.

## Run in an isolated database

Install the pinned dependencies and Playwright Chromium. Provision a disposable PostgreSQL database named **`mend_ticket16_lifecycle`**, apply the complete 47-migration prefix through `0046_private_retention`, and supply the restricted roles established by those migrations. The migrations require the normal migration owner's privileges; see [credential setup](credential-setup.md). Never use a database containing customer orders.

Create a private directory with these seven env files. Each contains only its own `DATABASE_URL` (or `DATABASE_URL_UNPOOLED`) pointing to that disposable database. Keep the directory owner-only and the files mode `0600`.

| File | Required `current_user` |
| --- | --- |
| `migration.env` | `neondb_owner` |
| `database-web.env` | `mend_web` |
| `database-conversion.env` | `mend_conversion` |
| `database-worker.env` | `mend_worker` |
| `database-registrar.env` | `mend_registrar` |
| `database-refund-worker.env` | `mend_refund_worker` |
| `database-payment-reconciler.env` | `mend_ticket16_receipts` |

The receipt login is a test-only role inheriting `mend_payment_reconciler`. Create it with a fresh private password; grant membership without changing an existing runtime role's password. The harness checks the actual database and role for **all seven connections before writing any fixture**. It also checks the migration prefix and an ownership marker before reset. Reset truncates fixture data in this database, preserving migration metadata and restoring baseline policy/configuration. Run only one suite against this database at a time.

```sh
RECOVERY_ENV_DIR=/absolute/private/test-env npx playwright test --config playwright.recovery.config.ts
```

The explicit config collects only `tests/recovery` and runs one worker without retries. It does not load historical purchase/operator fixtures or the default suites. No live provider credentials, RPC access, model key, wallet key, service secret or storage credentials are needed. Child processes receive an allowlist of the isolated role credentials and generated loopback fixture settings, rather than the invoking shell's environment.

The harness starts its own Next server and backend processes on random loopback ports. It kills only process groups it created. The independent external-effects process atomically records effects to disk before acknowledging a crash barrier, and can itself be killed and restarted. Assertions distinguish a lost response from an absent effect. Chain blocks, nonces and receipts are synthetic identities with canonicality controlled by the fixture.

## Coverage

| Boundary | Observable assertion |
| --- | --- |
| Settlement response lost after charging | Web and fixture restart; replay keeps one charge and the original confirmation time. |
| Successful receipt from an orphan block | Customer payment remains unconfirmed until numbered-block canonicality agrees. |
| Parser or publisher killed without whole-execution stop | Duplicate execution/stop/reconcile calls retain unknown state, one attempt and no fabricated delivery/refund. |
| Cooperative shutdown and prepared output recovery | Actual parser stop is recorded; verified output is restored with the original purchased deadline and retention clock. |
| Model invocation killed and restarted | Twelve real SDK dispatch claims persist; the actual 60-second deadline expires; another dispatch is denied and deterministic repayment continues. |
| Registrar signed bytes and refund inclusion | Kill/restart reuses durable operation/nonce; missing receipts stay unresolved; concurrent replay pays the original payer once. |
| Operator and agent request the purchased retry | Concurrent HTTP requests claim only the single permitted retry generation. |
| Late publication and entitlement disposition | A verified late result prevents entitlement; after entitlement the same conversion-role status write accepted by an unfenced terminal control fails specifically with `refund_disposition_fenced`, and repayment completes once. |
| Aggregate debt, reserve and allowance | Signed unbroadcast and submitted unmined refunds remain debt; a pending operation prevents competing overspend across restart; affordable refunds progress during a deficit; refill and fresh UTC observations permit deterministic continuation. |
| Purchase policy and incident pause | Later policy changes preserve purchased terms; pausing new purchases leaves paid recovery and the purchased retry available. |
| Retention deletion interrupted | Real object absence survives restart while an uncertain paid obligation stays visible. |
| Health retrieval and resume proof | Retrieval interrupted before persistence cannot invent a pass; later real conversion failure invalidates old proofs across restart. |
| Browser wallet identity and private results | Real SIWE rejection/expiry/retry; account switch removes private data and prevents an in-flight result download; another wallet receives 404. |
| Narrow keyboard flow | Tab and Enter reach authentication, private result download and sign-out at 375px without horizontal overflow; unknown execution and refund remain readable. |

## Evidence boundaries

These tests prove application recovery, concurrency and privacy behavior under controlled external effects. Synthetic authorization signatures exercise the real HTTP payment path; persisted signed refund bytes exercise the actual transaction ledger and replay driver through a test-only signer adapter. They do not prove live Arc settlement, reserve deployment, provider cancellation guarantees or live-model access. Those remain separate integration evidence from their implementation slices.

Financial outbox scenarios use explicitly labeled synthetic paid/stopped order seeds to isolate replay behavior. The payment crash scenarios establish their orders through the real submission, settlement and receipt routes. Hard process death preserves unknown execution/publication unless durable stopping evidence exists; physical object deletion alone cannot settle that uncertainty.

Trace, screenshot and video capture are disabled. Diagnostics, effect state and generated synthetic documents stay in owner-only local temporary artifacts; do not attach raw logs, session state or fixture dumps to a public issue or PR. Publish sanitized test names, counts, source SHA and PASS/FAIL evidence instead.
