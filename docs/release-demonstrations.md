# Labeled recovery demonstrations

Every demonstration must identify its source/deployment, time, injected fault, controlled external effects and persisted observation. Customer deadlines and model budgets are immutable. Never reset a paid case or write canonical main tables to produce a presentation. Historical demonstrations remain historical; they do not prove the final deployment.

## Repeatable isolated demonstrations

Follow the database-role setup in [recovery lifecycle](recovery-lifecycle.md), using only disposable database `mend_ticket16_lifecycle` and its isolated role files. The harness refuses another database, checks all roles/migrations and owns its processes. It resets fixture data: run only one suite at a time.

```sh
RECOVERY_ENV_DIR=/absolute/private/test-env npm run test:recovery
```

The following focused runs use that same private directory. They invoke real application routes, parser/workers, SDK dispatch, PostgreSQL and SIWE; external chain, model and object-storage services are controlled fixtures. Refund outbox cases explicitly seed synthetic financial evidence. These are **injected controlled demonstrations**, not live-provider incidents.

| Demonstration | Focused test selection (`--grep`) | Fault and observable result |
| --- | --- | --- |
| Restoration | `cooperatively stopped publication restores` | Interrupt a prepared publication; stop is confirmed, existing private bytes restore once, original deadline/expiry remain. |
| Monitoring uncertainty | `hard kill after output PUT` | Kill after storage effect but before committed output; replay preserves unknown publication, without inventing delivery or refund. |
| One retry | `concurrent real operator and model retry` | Race operator and model requests; durable authority admits only the single purchased generation. |
| Refund | `refund inclusion survives` | Kill worker and external-effects process after inclusion; missing receipt stays unresolved, canonical replay pays once to the original payer. |
| Pause while recovery continues | `purchase policy survives` | Change future policy and pause sales; existing purchased terms/recovery remain. |
| Stale resume rejected | `a real conversion failure invalidates` | Invalidate prior health evidence with a later failure; stale resume fails and sales remain paused. This does not demonstrate successful reopening. |
| Retention | `retention worker death` | Interrupt after actual object deletion; durable absence persists without erasing an unresolved obligation. |

For example:

```sh
RECOVERY_ENV_DIR=/absolute/private/test-env npx playwright test \
  --config playwright.recovery.config.ts \
  --grep 'cooperatively stopped publication restores'
```

Observe assertions and sanitized counts, rather than exporting raw fixtures or traces. Private artifact directories can contain capabilities, signatures and sessions. Recording a parser exit alone does not establish whole-execution stop. Expired lease, deleted object, missing receipt or elapsed120seconds alone cannot establish refundable failure.

## Historical live-provider evidence

| Evidence | What it demonstrates and its limit |
| --- | --- |
| [Restoration and monitoring](ticket7-runtime-proof.md), [restore record](ticket7-evidence/live-restoration.json), [monitor record](ticket7-evidence/live-monitor.json) | Actual evidence-dependent live-model tool choices and paying-owner download at the recorded historical source/runtime. Preserve the distinct tool evidence and clocks. |
| [One-retry runtime proof](ticket8-runtime-proof.md), [live retry record](evidence/ticket8-live-retry.json), [independent owner observation](evidence/ticket8-owner-independent.json) | Labeled injected failure followed by a live-model-selected bounded retry and owner retrieval. Replaying the guide does not authorize a second paid live failure. |
| [Contract exercise](evidence/issue-10.md) and [reserve manifest](../contracts/deployment/arc-testnet.json) | Verified reserve and labeled synthetic direct-contract refund. This differs from a genuine purchased-obligation refund. |
| [Genuine obligation refund](ticket11-runtime-proof.md) and [capacity proof](ticket13-runtime-proof.md) | Historical isolated authority, genuine obligation and capacity observations; consult original dated receipts rather than inferring current solvency. |
| [Pause and operator controls](ticket12-runtime-proof.md) | Historical deterministic pause and operator controls; the controlled isolated scenario above demonstrates stale resume rejection, not successful reopening. The separately dated source96 early-pause observation below uses real inference with synthetic isolated failures. |
| [Interrupted lifecycle suite](recovery-lifecycle.md) | Current-source process/effect/concurrency/privacy regression design using controlled external providers. It is not live Arc/model evidence. |

The genuine failed-obligation registration receipt is [0x11216ebe…1125](https://explorer.testnet.arc.io/tx/0x11216ebe7a2d66581a4ca7bb429934ef2ed2455d2870d0c673d782f31efc1125); repayment receipt is [0x3e85d67d…f4bad](https://explorer.testnet.arc.io/tx/0x3e85d67de67b3b09100f64a893816ac4003f0846b48045ad72250864d6ef4bad), for1 test USDC to the original payer. Revalidate canonical successful matching receipts before treating these historical links as fresh chain observations. A transaction hash alone is insufficient.

## Live gates

Final acceptance must identify the exact live model/provider, immutable case call count, investigation deadline, observed evidence and actual tool choice. The case limit is12 calls; each investigation lasts at most60seconds. Quota429s can consume durable calls even without useful output. The [2026-10-15 source96 observation](release-acceptance-2026-10-15.md#live-model-early-pause) demonstrates an actual live-model early pause after two synthetic canonical failures:7 persisted calls in about32seconds, no financial effects or main-merchant pause. Its refund request was refused (`payment_unknown`), and the invocation ended `insufficient_evidence`; the passing observation is the early pause, not full recovery or repayment. Deterministic pause/health tests remain a separate evidence class.

After independently verified free-quota availability, any approved fresh live investigation must use a bounded isolated nonfinancial scenario, minimized metadata and the existing call budget. Do not repeatedly probe exhausted quota, buy credits, switch to a paid fallback, reset budgets or create paid orders to evade exhaustion. If a gate is unavailable, record the failed condition and next useful retry time. Never pause the main merchant merely to stage the demonstration.

Resume requires the authorized operator's SIWE session, current complete health evidence, capacity revalidation and explicit intent. It cannot be inferred from a lease expiring, a later successful request or an old health snapshot. Recovery for already paid obligations continues while sales are paused. A live demonstration must retain sanitized audit/evidence references with source and timestamp; independent release QA remains separate.

Positive authenticated resume has a separate controlled test, [service-health.spec.ts](../tests/service-health.spec.ts), named `resume deliberately repeats actual execution and atomically opens only after fresh authenticated retrieval`, plus a browser test. It requires its dedicated `mend_ticket14_health` fixture and `PROVISIONING_ENV_DIR`; do not run it against the lifecycle or main database. A [fresh source96 controlled receipt](evidence/release-2026-10-15/controlled-resume17.json) records both positive health/retrieval and deliberate resume tests passing at2026-10-15T18:54 UTC, with no model/financial calls or main availability change. This legacy isolated fixture has45 journal entries, health schema already present and retention migration0046 appended; it is not a full ordered journal replay. No deployed-main successful resume is asserted.
