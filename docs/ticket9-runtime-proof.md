# Ticket9 guarded operator recovery

Base `ebb9df0030de641a0dd7797e4168e44baac068c7`, isolated `ticket/9` worktree. The authenticated operator lifecycle now supports request-bound investigation and individually permitted deterministic checks, verified output restoration and purchased retry. Actor derives from the server SIWE session. Actor/request/evidence/outcome remain durable and private. No model budget reset, force-refund, mark-resolved override or ticket11 implementation was added.

## Trust and execution checks

Append-only migrations0022–24 add durable requests, separate deterministic invocation purpose and narrow role functions. Request admission/dispatch and existing mutation admission take locks in order→invocation→request order, then recheck session/deadline/policy with the real clock. No transaction holds locks across storage or inference. The unique invocation lookup and order/history index support request-bound checks and cleanup. Generated snapshots include structural SQL checks/indexes; subsequent generation reports no changes.

The worker cannot select sessions or requests, cannot dispatch deterministic actions and cannot claim model calls for deterministic invocations. Conversion uses a distinct operator credential and the DB-recorded action rather than a caller-provided action or actor. Deferred operator investigation admission validates session/actor/order and records the actual invocation. Customer projections exclude raw audit, actor, session hashes and private object paths.

Independent root live role audit: web alone admits/reads requests; conversion alone asserts/dispatches deterministic requests; web and conversion finish; worker has only request-bound investigation admission and narrow completion. No service has direct request UPDATE; worker/conversion/registrar cannot SELECT sessions. The sanitized independent report is kept outside the repo at `/private/tmp/mend-ticket9-root-role-audit.md` for review.

## Acceptance sources

Existing genuine paid order72557542 remains overdue with unknown whole-parent stopping; no false stopping or output absence is inferred. The handoff's earlier12-call assumption for that order was corrected using persisted evidence: its model budget is not exhausted. No investigation or budget change was made to establish exhaustion. Existing delivered genuine retry1e29d2bc rejects a stale operator retry and refreshes canonical delivery/attempt history.

Owned, explicitly labeled copied-receipt fixtures exercise12-call exhaustion without another payment or model call. Prepared-output restoration borrows existing valid publication metadata at fixture creation; it is fixture evidence, not a new genuine paid recovery. Retry fixtures run the actual conversion/storage path, retain the purchased deadline, and clean generated objects and SQL rows. A fixture-scoped database failure after retry admission establishes the red regression: generation1 existed but the audit incorrectly said skipped. The corrected deployed handler records uncertain. Denials before dispatch are skipped only when authority failure is proven.

Lifecycle checks cover unsigned/customer denial, invalid action rejection, exhausted-budget fresh check/investigation denial, actor audit privacy, one-generation concurrent retry, revoked-session execution revalidation, deterministic/model trust separation, valid prepared-output restoration, stale refreshed action, automatic-investigation lease races, private owner delivery summaries, and durable browser controls/history at narrow mobile width. Automatic lease fixtures use trusted worker admission without a provider call; this does not claim a live-model race.

The restart script stops and starts actual owned local web processes while retaining a copied-receipt12-call fixture and authenticated session. It verifies persisted check audit and budget, then rejects model investigation after restart. This is an actual web-process restart; it does not claim a production host-kill or live inference restart. Owned3035 is used; user3022 is untouched.

The final restart rerun also passed after bounding readiness fetches and process shutdown. Cleanup checks already-exited children, waits three seconds for SIGTERM before SIGKILL of only the owned process group, and preserves fixture cleanup if shutdown fails.

## Deployment and verification

Existing approved Neon project/branch only. Conversion `mendconversion6` deployment18; worker `mendagent7` deployment6. Both preserve their original scheduled trigger IDs. No broader destinations, signing authority, legacy deployment or infrastructure was changed. Migrations0022–24 are applied; applied SQL was not rewritten.

Final checks and sanitized restart output are recorded in [ticket9 evidence](evidence/ticket9-checks.json). No signatures, private credentials, bearer tokens, result grants or provider traces are included. Free-host outages/storage uncertainty can still keep obligations unresolved; unknown evidence is never treated as safe retry admission.
