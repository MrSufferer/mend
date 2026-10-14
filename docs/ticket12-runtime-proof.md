# Ticket 12 runtime proof

Reviewed runtime source: `3c34df2c3e768f4df21b300c458a6ca583400339`, based on main `9844fa7a3085e7919fe47eb543348ec6aa42810d`. Independent Standards and Spec reviews found no remaining ticket 12 findings at this exact clean head. The following documentation commit does not change deployed source.

## Controlled acceptance

All 14 isolated database-backed Playwright lifecycle checks passed together in 32.6 seconds. Purchase HTTP checks used order capabilities; actual SIWE sessions exercised downloads and the private Recovery desk at 375, 768 and 1280 pixels. Tests covered the three-confirmed-attempt threshold, five-minute window, attempt deduplication, actual AI SDK earlier-pause selection, expired authority and blocked-lock revalidation, both third-failure/admission interleavings, receipt reconciliation after a lost settlement response, replay of durable admission before settlement, and existing paid recovery while paused.

Valid synthetic PDFs ran the real parser and conversion, including interrupted prepared-output restoration and authenticated payer downloads while paused. Original payer, purchased terms, paid time and receipt-derived deadline remained intact. Controlled RPC receipts and local storage are fixtures; these are not new chain-live payments. The pre-settlement crash case simulates the durable boundary rather than killing a process at that instruction. Separately, an actual owned web process restart followed by fresh SIWE verified persisted incident and availability state.

Typecheck, six deployment-completion tests, deployment script syntax and diff whitespace checks passed. The webpack production build passed. The default Turbopack build encounters the external node_modules symlink layout limitation in these worktrees; no default-build success is claimed. An earlier browser run was interrupted by concurrent dev/build compilation; after the build finished and the owned dev process restarted, the unchanged full suite passed sequentially.

## Main migrations and deployed authority

At `2026-10-14T18:50:55.646Z`, the main `neondb` owner applied append-only migrations 0034 through 0040 in one transaction with a locked journal and immutable-history precondition. All original 34 SQL hashes and journal timestamps matched. The final 41 hashes and timestamps matched the reviewed source. Main availability remained open, generation 0 and failure generation 0. No synthetic main pause was performed.

At `2026-10-14T18:51:18.491Z`, the reviewed source deployed agent `mendagent7` version 7 and conversion `mendconversion6` version 20. Independent management readback at `2026-10-14T18:51:37.264Z` confirmed each exact requested version was both current and active with completed status. The existing operator address, approved direct OpenRouter free model `nvidia/nemotron-3.5-lightning:free`, and disabled synthetic interruption experiment were preserved. Registrar and refund signer services were not redeployed.

Unauthenticated runtime probes returned 401; authenticated probes returned 200. Agent identity was `mend_worker`, with session reads, payment writes, result writes, stop writes and restoration writes denied; storage reads and writes were denied, storage credentials disabled and signing credentials absent. Conversion identity was `mend_conversion`, with session access and payment writes denied and signing credentials absent. Main privilege readback found no direct availability-update authority or incident/failure insert authority for web, worker, conversion, registrar, refund-worker or payment-reconciler roles.

The original agent, conversion, receipt and refund trigger IDs remained enabled at `*/15 * * * *` UTC. Readback observed completed agent and conversion sweeps at 18:45 UTC, before this rollout; those ticks do not demonstrate the new artifact's scheduled execution. New-artifact authenticated probes establish the deployed authority checks. The authorized refund queue was empty. No additional signing, customer payment, reserve funding or refund experiment was performed.

## Live-provider limitation and release follow-up

Genuine early-pause tool selection remains **unverified**. A bounded authorized free-provider attempt returned HTTP 429 (`free-models-per-day`), selected no tool and left availability open below the deterministic threshold. Controlled actual-SDK early-pause behavior passed. Independent Spec review found no explicit per-tool live demonstration requirement for ticket 12; existing genuine evidence-driven agent demonstrations from tickets 7 and 8 support the parent requirement, but do not constitute a fresh release regression. Carry this precise limitation into ticket 18 and parent release review. Do not report a live early-pause PASS, retry exhausted quota repeatedly, buy credits, use a paid fallback or reset durable model budgets.

Ticket 12 adds durable pause and incident visibility; deliberate verified reopening is ticket 14. Existing paid obligations and reconciliation remain independent of sales availability.
