# Issue #2 verification — 2026-10-13

- Test-driven public seam: initial valid submission failed HTTP 404, then passed against real Neon PostgreSQL plus private Neon storage. No database/storage mocks.
- Mixed scanned-page tracer: acceptance initially returned 201; after validation fix returns 422. Blank pages in a text-based PDF remain supported.
- Policy tracer: changing future policy during staged upload initially changed 120-second disclosed terms to 60; snapshot-at-disclosure fix preserves 120 while a new submission receives 60.
- Final Playwright run: **9 passed**, including real exact 10 MiB PDF upload, both password and empty-password encrypted fixtures, invalid/scan/51-page rejection, hash mismatch, concurrent request recovery, cross-capability denial, anonymous private-storage denial, and accepted-object immutability after staging overwrite. No payment/processing starts.
- `npm run typecheck`: PASS.
- `npm run build`: PASS; Next.js 16.4.0 production build emits the four dynamic order/submission routes.
- Production-server runnable client: PASS; submitting then rerunning the same private state recovered order `0dd737fc-e3e3-4fab-86f6-97ee9afc62a8`, still unpaid. Recovery-state file mode verified 0600. Capability and signed grants were not printed.
- `npm audit --omit=dev`: zero runtime advisories. Drizzle Kit carries development-only transitive moderate advisories from its existing esbuild tooling; migration tooling is local only.
- Two versioned Drizzle migrations applied to the real Neon branch. Runtime uses `mend_web`; migration-owner environment loaded only by migration/policy setup commands.
- Staging purge command: PASS (no eligible expired objects in the first invocation). Full scheduled retention and independent output clock are ticket #15, not established by this manual command.

Local HTTP execution with real providers is established. Deployed Vercel HTTP evidence is a separate integration-branch check; this report does not claim payment, wallet authentication, Neon processing Functions, or model integration.

## Hosted artifact follow-through

The first Vercel Preview of integration `883f7c6` exposed a deployment-only PDF.js packaging defect: hosted lifecycle checks reported seven failures, one pass and one policy-fixture skip; valid and encrypted documents incorrectly returned `invalid_pdf`. The local production route trace contained `pdfjs-dist/legacy/build/pdf.mjs` but omitted the library's dynamically imported `pdf.worker.mjs`, so local execution with a full node_modules tree had concealed the missing runtime file.

The fix loads the worker through a literal module import and explicitly includes it in Next.js output tracing for the finalization route. The rebuilt `complete/route.js.nft.json` now contains the worker and its traced path resolves to a file. Infrastructure/worker load errors return retryable 503 rather than rejecting the customer's staged document; genuine unsupported/invalid document errors retain 422. Production build passed and all nine real-provider HTTP lifecycle tests passed again (22.5 seconds). Hosted redeployment verification remains an integration-branch acceptance check.
