# Issue 6: durable interruption recovery

Verified on Arc testnet and the existing Neon Free branch on 2026-10-14. No reserve payout, retry authority, production deployment, or paid upgrade was used. Original payment timestamps and purchased policy snapshots remain immutable.

## Behavior and authority

Stop requests are monotonic requests. Parser exit, trusted parent publication completion, publication fencing, and final private output checks are separate durable facts. A lease, deadline, deployment change, or hard process exit never supplies missing termination evidence. Unknown generations remain unresolved; a deployment switch does not retire them by inference.

Migrations 0007–0012 introduce these facts and narrow privileges. Old conversion isolates cannot directly update order result/delivered_at or attempt publication/terminal facts. The conversion authority uses `mend_prepare_output`, `mend_finish_execution`, and `mend_restore_output` with an order-before-attempt lock order. Restoration and future refund disposition must share the order disposition fence. Delivered disposition is immutable. The worker can call `mend_request_stop`; it cannot author payment, policy, completion, or absence evidence. These functions trust the isolated conversion verifier; PostgreSQL does not independently inspect storage bytes.

The conversion verifier checks the deterministic private output key, actual bytes/hash/size/nonempty text, and independent seven-day output retention. Only a genuine private 404 establishes absence. Storage failures and incomplete publication remain unknown. Prepared objects survive a database-finalization failure and can be restored without a new execution generation.

A receipt-only function reuses the existing canonical Arc receipt algorithm: chain 5042002, the configured USDC token, this authorization nonce/payer, successful receipt, exact payer-to-merchant 1,000,000-unit transfer, and block timestamp. It scans at most 2,000 blocks per item, keeps the scan cursor monotonic, and rotates durable observations. It cannot sign, settle again, access sessions, or read/write files. Both injected database URLs are overridden; injected AWS credentials are explicitly overridden with nonfunctional values. Confirmed paid orders without an attempt are picked up by conversion only while the original deadline and upload remain valid; older obligations stay overdue. Customer polling is not the durable payment recovery mechanism.

## Actual interruption and payment evidence

Each fresh acceptance order paid 1 test USDC with a genuine receipt; completed prior orders were not rewritten.

| Case | Order | Arc receipt | Fixed deadline | Observed result |
| --- | --- | --- | --- | --- |
| Cooperative SIGINT | 70416aef-c250-46de-aa30-cd5be751f9f2 | 0xc2ad83379d81186a834b70d93b00de6bfdfd32835f74be2737a23bb7b16e5e09 | 00:37:09Z | Parser exited 00:35:13.743Z; parent finished/fenced 00:35:13.755Z; absent output; stopped. |
| Hard process exit 77 | f38c2ea3-5fbf-4bd5-9418-043e9fd2661a | 0x83dff68e232bc12bc8b1275c5e3b92cf783693be847c1749ff0e03617003bfec | 00:39:43Z | No parser/parent terminal acknowledgement. Genuine schedule requested stop at 00:41:00.543Z; still unknown and overdue. |
| Publication finalization interruption | 34e1a522-2388-4211-a6cf-cbe49f80b74f | 0x3898aaffeab245252ad1f1b611f7e40eb03059174170cbf307f7146e84f95c3c | 00:41:19Z | Controlled exception after actual private PUT/GET, before manifest finalization; trusted terminal check unknown. Genuine schedule restored verified output at 00:41:00.809Z, one generation. |

The publication case restored **before** its original deadline; it is not evidence of late restoration. The hard-exit case demonstrates conservative uncertainty, not cancellation success. The original shutdown acceptance deployed before the additional independent private-404 recheck; subsequent reconciliation verifies absence privately. Purchased deadlines and terms are compared with the cached original receipt in tests. Authenticated customer download returned the actual acceptance text. The local official x402 facilitator was used for the hard-exit purchase after Arcus settlement failed; the same cached signed authorization and immutable merchant/chain/token/amount were reused. Production Arcus default is unchanged; the facilitator signer stayed local.

## Durable scheduler and free-hosting limits

Authentic platform invocations persisted through restart:

| Scheduled UTC | Invocation ID | Completed UTC | Orders observed |
| --- | --- | --- | --- |
| 00:40:00 | V8tT9hdbAuYTVTbWQmD4rA0hYGVAsflxnDLAG3ljJ-0 | 00:40:00.622 | 3 |
| 00:41:00 | 2FJrw3f3tg31IwEOeFW9DGipDx5Q3qWa35a_JPfwhaQ | 00:41:00.830 | 3 |
| 00:42:00 | 3xJH8Qi4-VVSkT6_ellgGE-I4VMnfy0kLByUNuvXORA | 00:42:00.495 | 3 |
| 01:30:00 | 1O4iaOE-skVqIPBXd1VL9p-4n7Q2-lwlyqJwh6u1be4 | 01:30:00.939 | 3 |

The final two schedules are synchronized `*/15 * * * *`: conversion trigger `trigger-ed102c55-a3a1-4d8c-9223-12c74908312c` and receipt trigger `trigger-890d1c13-f393-41bc-8d69-8f574dd37159`. They were enabled at 01:28:59–01:29:00Z with next_run_at 01:30Z. After the actual idle window, the final deployment persisted its genuine 01:30 sweep. The receipt-only scheduler independently advanced reconciled_at for existing uncertain payment attempt 7b3c1d39-5315-4bf2-8e6f-4eaebe74a3f6 at 01:30:02.403Z; no manual receipt reconciliation was invoked during this observation. This proves scheduled observation, not a new payment or newly confirmed receipt. Scheduling validates the Neon-stripped invocation header, envelope, and expected trigger; externally spoofed schedule headers returned 403 in both services.

Conversion claims invocation IDs durably, observes up to three oldest unchecked obligations, and persists per-item failures so one bad order cannot permanently starve later orders. Unknown payment rows with durable settlement attempts are included. Receipt reconciliation rotates one pending attempt per tick. A 30-second admission budget stops starting another conversion item; it is **not** a hard 30-second invocation limit. An already admitted initial execution retains its original remaining two-minute deadline. Parser, storage requests (3/8 seconds), HTTP database queries (10 seconds), and RPC requests (10 seconds) are separately bounded; admitted work can finish after the admission budget. No permanent keepalive loop is used.

Management observed the endpoint genuinely idle at 01:26:20.952032Z, with last_active 00:43:12Z, min/max 0.25 CU, after the announced no-query interval began at 00:43:58.875Z. The API still reported suspend_timeout_seconds=0. Actual idle was observed 42m22s after that start; the exact documented five-minute suspension threshold was not measured. No DB/web/function probes were made by the collaborating agents during this interval; original user server 3022 was untouched.

At the documented five-minute idle threshold, synchronized 15-minute catch-up has an estimated baseline 62 CU-hours per 31-day month at 0.25 CU, versus 186 CU-hours for every-minute DB touching. This is a budget model, not measured future usage or an unlimited Free guarantee. Free has 100 CU-hours monthly plus separate Functions limits (10 active/400 waiting compute-hours and 1M invocations). Existing management counters remained 621 CU-seconds/2468 active seconds and may lag. Actual traffic, backlog, retries and additional services consume the same allowance. Operator must monitor usage and disable schedules before the free allowance is exhausted. Capacity exhaustion or host delay leaves obligations unresolved rather than changing deadlines. Customers see the original overdue state and honest catch-up delays of 15 minutes or longer; a backlog can require multiple sweeps.

References: [Neon schedules](https://neon.com/docs/compute/functions/triggers/schedule), [environment overrides](https://neon.com/docs/compute/functions/environment-variables), [scale to zero](https://neon.com/docs/connect/connection-latency), [driver timeout configuration](https://github.com/neondatabase/serverless/blob/main/CONFIG.md). Current documentation was retrieved through Context7 library-first queries.

## Verification and remaining budget

Final active deployments: `mendconversion6` deployment 6 and `mendreceipts` deployment 5, active identity equals completed current identity. Experiment allowlist explicitly cleared. Live probes reported conversion role `mend_conversion`, no sessions/payment-write/signing credentials; receipt role `mend_payment_reconciler`, no sessions/output-write, actual storage read/write 403, no functional storage/signing/model/session credentials.

Eight real lifecycle/API tests passed (5.0 seconds): parser-vs-parent distinction, monotonic concurrent stop, concurrent uncertainty preservation, cooperative-vs-hard interruption, spoof denial, old-role direct write denials (Postgres 42501), scheduled restoration without another generation, and authenticated customer uncertainty/download. `npm run typecheck`, `npm run build -- --webpack`, and diff whitespace checks passed. Build retains existing optional wallet connector warnings.

At Arc block 67075827 (00:44:49.197Z), reserve balance remained **9 test USDC**, UTC daily allowance **10 test USDC**, purchaser **12.989205 test USDC**. No #6 refunds or reserve funds were spent. These are dated observations, not future balances. Private signatures, credentials, raw environments, and paid-order caches remain outside git; generated bundles are ignored.
