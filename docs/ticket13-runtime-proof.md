# Ticket 13 runtime proof

Deployed code identity: `9c439e1c37419fa1f7cc82a424b5121b0a76b20c`, based on `734f27d24c8d6c789f90382a19f00867832cfc39`. This documentation commit does not change the identity of the deployed artifacts. Evidence below was recorded on 2026-10-15 UTC and includes a fresh canonical capacity observation from the ordinary 06:45 UTC refund schedule.

## Controlled acceptance and final review

The implementation accounts for the complete authorized backlog at a canonical block, verifies refund receipts before releasing debt, commits observations against the liability version, and pauses new purchases on aggregate funding or allowance deficits. Individual affordable refunds can continue. Customer projections retain actual submitted, receipt-unknown and registration-pending stages. The private operator projection exposes observed amounts, block/hash, time, allowance reset and liability version, with explicit stale/unknown states. The bounded agent tool supplies only its live durable invocation ID; registrar authority derives and checks the order independently.

An empty isolated database replayed the exact final 45 SQL migrations with their journal hashes and timestamps. The preexisting 41-migration prefix remained unchanged. Controlled integration fixtures exercised real database roles and worker/registrar HTTP lifecycle boundaries; only external chain, signer and model effects were controlled. Coverage includes aggregate balance/allowance deficits, canonical receipt accounting, stale observations and UTC reset, role grants, strict JSON/null evidence shapes, customer stage precedence, and pending or unavailable registration that cannot starve capacity observation. Pending or failed registration never authorizes a payout.

Recorded checks:

- Initial agent/capacity/authority/worker suite: 10 passed; capacity and existing authority/chain/restart/reverted/HTTP regression: 15 passed.
- Customer presentation and authenticated HTTP: 9 passed. Private operator browser checks passed at 375, 768 and 1280 pixels without horizontal overflow.
- Final correction: observed the new pending-registration regression fail before the fix, then pass. The final affected suite passed all 13 tests, including four scheduled HTTP cases crossing pending/unavailable registration with funding/allowance deficits.
- Type checking, all three Node.js 24 ESM backend bundles, deployment script syntax and whitespace checks passed. The production Next.js webpack build passed with existing optional wagmi connector dependency warnings. The backend-only final correction required rebuilt backend bundles; it changed no SQL, frontend or dependencies. This records the webpack build, not a default Turbopack build.

Independent final Standards and Spec reviews inspected exact clean source `9c439e1` and reported no unresolved findings. Reviewers inspected the reported test evidence without independently rerunning those tests. Controlled fixtures establish behavior under their stated boundaries; they do not establish live model execution, a real refund payout, or on-chain signing acceptance.

## Applied migrations and deployed artifacts

The applied receipt and subsequent main database readback identify source `9c439e1` and exactly 45 journal entries. All applied SQL hashes match the candidate files; runtime readback reports `journalExactMatch=true`. Privilege readback confirms that only `mend_registrar` has capacity-commit, backlog and agent-dispatch capabilities. All five runtime roles lack direct capacity-table update, entitlement creation and output update grants.

| Function | Current and active deployment | Created at UTC | Runtime |
| --- | --- | --- | --- |
| `mendregistrar11` | 5 | 2026-10-15 06:33:13 | Node.js 24 |
| `mendrefund11` | 4 | 2026-10-15 06:33:39 | Node.js 24 |
| `mendagent7` | 8 | 2026-10-15 06:34:03 | Node.js 24 |
| `mendconversion6` | 20, unchanged | 2026-10-14 18:51:16 | Node.js 24 |
| `mendreceipts` | 5, unchanged | 2026-10-14 01:28:05 | Node.js 24 |

All are completed, current and active, with 2048 MiB memory. Deployment receipts identify the reviewed SHA and preservation of existing environment values. Only the new `AGENT_REGISTRAR_SECRET` was added to registrar; agent received that binding and `AGENT_REGISTRAR_URL`. Existing write-only credentials were carried forward without rotation or replacement from stale local files. Sanitized deployment receipts alone cannot establish secret equality.

The four original enabled schedules are unchanged, including trigger IDs and versions. Agent, refund, receipts and conversion still invoke `/scheduled` on `*/15 * * * *`; no synthetic schedule or signing request was added for acceptance.

## Authentication and protected preview

Unauthenticated registrar and refund probes returned 401. The new agent/registrar binding also returned 401 without its key; with its configured key, an empty malformed request reached validation and returned 503 before SQL dispatch. That probe created no entitlement, signing transaction or model invocation; it establishes binding authentication, not successful tool execution.

Protected preview `https://mend-fno10e9rt-gadillacers-projects.vercel.app`, deployment `dpl_HkmFtgb4RM3Bwej73h2V6csKvkkc`, was built from the exact reviewed source archive. Readback records ready status and HTTP 200 rendering Mend through an authenticated CLI protection bypass. A real current operator SIWE challenge and verification both returned 200, followed by private operator service retrieval returning 200 with `availability`, `incidents` and `capacity` projections. No pause/resume, payment, signing transaction or model action was performed by those probes. Vercel preview protection remains enabled. The verification script requires successful logout during cleanup.

Export of the existing `ARC_RPC_URL` credential remains pending approval; it authenticates an RPC endpoint and is not a signer binding. Broader legacy frontend service bindings are independently incomplete. This protected preview establishes ticket 13 rendering and operator authentication; it does not establish full release deployment acceptance for tickets 17/18 or parent 19.

## Ordinary scheduled canonical observation

The unchanged ordinary refund schedule fired for `2026-10-15T06:45:00+00:00`. Its durable sweep invocation `Sci0WAvqf5gHXUkUtKHh8NpM8nxglouEMCbizeEPfzY` was created at `2026-10-15T06:45:01.579008+00:00` and selected no order. Despite an empty refund queue, the worker recorded aggregate canonical capacity:

| Field | Observed value |
| --- | --- |
| Observation time | `2026-10-15T06:45:04.662156+00:00` |
| Liability / observed version | `0` / `0` |
| Freshness / status at readback | `true` / `sufficient` |
| Canonical block | `67289176` |
| Block hash | `0xc0a91d9b412cacb78dfa8cf7f9ef6aa09bdaebc1056318a61603c79137983453` |
| Chain timestamp | `2026-10-15T06:45:03.000Z` |
| Observed allowance reset | `2026-10-16T00:00:00.000Z` |
| Balance | `8000000` atomic units (8 test USDC) |
| Remaining daily allowance | `10000000` atomic units (10 test USDC) |
| Authorized debt / orders | `0` atomic units / `0` orders |

The same readback found merchant admission open at generation 0/failure generation 0 and no refund queue entries. The observation is bounded by the implementation's 120-second freshness window and liability-version check. It proves that an ordinary deployed worker invocation persisted current canonical capacity even with no selected refund; it is not a future capacity guarantee or evidence of an actual financial refund. The observed next UTC reset is chain-derived metadata, not proof that a later reset has happened. No synthetic signing or payout request was needed for this check.

## Evidence receipts

Sanitized receipts are retained outside the repository in `/private/tmp/mend-recovery-context/`: `applied-ticket13.json`, `deployed-registrar.json`, `deployed-refund.json`, `deployed-agent.json`, `readback-ticket13.json`, `auth-readback13.json`, `preview13-readback.json` and `preview13-siwe.json`. Local verification details are in `candidate13-notes.md` and `candidate13-fix-report.md`; final independent source reviews are `review13-standards-final.md` and `review13-spec-final.md`. These receipts contain no credentials; private environment files and authenticated request headers are excluded from this proof.
