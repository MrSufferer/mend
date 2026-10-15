# Public acceptance observations, 2026-10-15 UTC

The [public app](https://mend-3hvszzylk-gadillacers-projects.vercel.app) was READY and passed the checks below on **2026-10-15**. Runtime source is [`96e05307dc6dcfa469eae69d1f95b043fdd42a6a`](https://github.com/MrSufferer/mend/commit/96e05307dc6dcfa469eae69d1f95b043fdd42a6a). This evidence documentation is a later source-only change; it does not claim a new deployment. Independent release QA in [#18](https://github.com/MrSufferer/mend/issues/18) remains outstanding.

## Runtime identity

The clean source archive SHA-256 was `3830fffe2b80dccebe3df066d676953db0d56574f8e2bbc4f8c40563ed37add3`. Vercel preview deployment `dpl_Agt3HdySS2828i31Mfv6rpbw31RQ` used `npm run build -- --webpack`. It belongs to project `prj_kxV9vCU6WSADn5BbRmGdhDRX3vSI`, team `team_YqQOxoqIXZLtwGdjXoF27rRD`. The provider-generated preview origin is publicly accessible without a protection bypass; this is a preview-target release, not a claim about a separate production target. See the [web receipt](evidence/release-2026-10-15/preview17-deployment.json) and [reproduction instructions](release.md).

At **18:47:58 UTC**, provider readback showed each function's current and active deployment IDs equal and completed:

| Responsibility | Function | Deployment | Source/artifact |
| --- | --- | --- | --- |
| Conversion | `mendconversion6` | 23 | Source96; ZIP `ca00ac57f19437bf766bfaa23aaaa50962107b3a9044a412a4919012fd9d2f1d` |
| Registrar | `mendregistrar11` | 8 | Source96; ZIP `2f9a1e4da5b024d7cae02407e9c552fb342bb2bcac28b1e3788935aeb8607886` |
| Agent | `mendagent7` | 9 | Source96; ZIP `03bdf24ae0bf195b170cb92495810da01610420179cfc284f06014e7c36abaf1` |
| Receipt reconciliation | `mendreceipts` | 5 | Existing deployment carried forward; not redeployed from source96 |
| Refund worker | `mendrefund11` | 4 | Existing deployment carried forward; not redeployed from source96 |

“Source96” means the full commit above. [Conversion](evidence/release-2026-10-15/deployed17-conversion.json), [registrar](evidence/release-2026-10-15/deployed17-registrar.json), [agent](evidence/release-2026-10-15/deployed17-agent.json) and [five-function readback](evidence/release-2026-10-15/functions17-readback.json) retain exact identities. Submitted ZIP digests and provider IDs are recorded; remote artifact byte digests were not independently downloaded/verified. Existing environments and signing authorities were preserved.

## Schema, authority and ordinary work

The [18:48:25 UTC readback](evidence/release-2026-10-15/schema-receipt.json) records all **47 ordered migration hashes/timestamps**, six runtime role flags/effective table grants and the main destination: project `morning-bar-76751353`, branch `br-patient-wave-azrhhl2v`, database `neondb`. Each runtime role had no superuser, role creation, database creation or RLS bypass. Main sales remained unpaused, generation0.

Four ordinary `/scheduled` triggers remained enabled at `*/15 * * * *`; their trigger IDs and versions are in that receipt. Conversion, agent and refund sweeps completed around **18:45 UTC**. Retention readback showed **200 deleted and one pending among201 due records**. The deleted total was already200 before this window; no new backlog deletion is demonstrated. The remaining record is an overdue staging object with `storage_unknown`, expiry2026-10-14T00:31 UTC and last check2026-10-15T17:45 UTC. It does not establish absence or complete clearance. Receipt reconciliation had no eligible attempts; its latest reconciliation was on2026-10-14T01:30 UTC. Its enabled trigger is recorded, but a fresh ordinary receipt invocation was not independently observed.

Twelve [deployed binding probes](evidence/release-2026-10-15/runtime-bindings17.json) passed. They exercised independently scoped `WEB_*` aliases, wrong credentials and wrong endpoint authority. Correctly authenticated malformed requests reached validation; these probes alone do not prove successful business execution. The agent alias cannot authorize `/scheduled` (403), and `/investigate` retains mandatory durable operator-request validation. No model call or financial action was requested by these probes.

## Public and authenticated checks

The [public check receipt](evidence/release-2026-10-15/public17-verification.json) passed anonymous HTTP200 for `/`, `/orders` and `/recovery`; a real browser observed title “Mend · Private orders” with authenticated data hidden at **18:47:20 UTC**. SIWE challenge/verification passed for customer and operator on Arc5042002. Unauthenticated orders returned401, another owner's order404, and a customer accessing operator authority403.

The original payer retrieved an existing historical purchase: HTTP200,37 bytes, `private, no-store`, SHA-256 `8758c5f05eb8c2c2782d1ceb958481e643fd7f55c7e63256b0618009239609e9`. No private content or session is published. The current deployment's generated-PDF synthetic health run passed validation, parser, storage, payment, capacity and retrieval between **18:46:39–18:46:50 UTC**, producing45 result bytes. This exercises actual parser/storage and current runtime paths with synthetic health authority; it creates no new paid purchase or charge.

The exact-source isolated lifecycle suite passed **28 tests**, including four web-alias/early-pause HTTP integration tests; [check summary](evidence/release-2026-10-15/checks.json). It uses controlled external providers and is distinct from live chain/model evidence.

## Live-model early pause

At **18:39:43–18:40:15 UTC**, the clean source96 default agent used real OpenRouter inference with model ID `nvidia/nemotron-3.5-lightning:free` in the isolated lifecycle database. The upstream inference provider identity was not independently recorded; the NVIDIA-branded model ID does not establish that identity. Two **synthetic canonical conversion failures** were below the deterministic three-failure pause threshold. Production evidence-dependent tools inspected order, execution, output and related failures; the model chose `request_pause`, which persisted paused=true, generation1, failure_generation2. The [sanitized live receipt](evidence/release-2026-10-15/live-pause17.json) records **7 persisted calls**, within the unchanged12-call case budget and60-second investigation deadline, finishing in about32 seconds.

This passes the bounded early-pause observation. Payment facts were synthetic, external chain/storage effects were controlled, and the main merchant was never paused. A preceding `request_refund` was refused with `payment_unknown`; the overall invocation ended **`insufficient_evidence`**, not completed recovery or a refund. Charges, refunds and registrations were all zero. No budget reset, paid fallback or additional purchase was used. The initial driver attempt failed before inference because an immutable parser field was updated after stop; the source96 fix seeds that evidence atomically, and the original failure report was retained privately.

## Contract and historical scenarios

[Fresh contract verification](contract-verification.md) records pinned toolchain tests, gas/ABI/static checks, canonical read-only receipt/role checks and exact verified-input bytecode equality at block67371576. Default auto-remapping compilation changes metadata, so exact byte reproduction requires the checked-in verified standard input. This involved no new chain broadcast or funding.

[Demonstrations](release-demonstrations.md) links the historical live restoration, monitoring, one retry, genuine failed-obligation refund, deterministic pause and deliberate authenticated healthy resume. Their recorded source/runtime and injected faults remain explicit. Fresh canonical readback does not turn those historical actions into new source96 payments or demonstrations. The genuine repayment was1 test USDC to the original payer; the separate synthetic contract exercise remains labeled.

These observations support issue17's public evidence and handoff. They do not assert independent full-release QA approval, future availability, a new live customer purchase/refund, or complete retention backlog clearance. Customer/trust terms, authority limitations and third-party notices remain in [release documentation](release.md), [trust](release-trust.md), [customer guidance](release-customer.md) and [licenses](release-licenses.md).
