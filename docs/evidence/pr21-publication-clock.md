# PR #21 publication-clock review correction

The spec review found that initial publication used PostgreSQL transaction-start time after blocking order/attempt locks. This could describe late availability as on time. Migration `0019_publication_availability` preserves the existing manifest, disposition and terminal fences, records delivery and terminal publication with a single real clock read after both locks, and checks expiry at that point. An expired candidate establishes no delivery and ends with unknown output evidence; expiry does not establish output absence.

## Controlled database regression

`scripts/verify-publication-clock.mjs` calls the actual lifecycle RPC as the existing conversion database role. Its disposable fixtures copy owned order/result metadata from `8e3851eb-47a0-4ef3-8017-474338706762`. Copied receipt metadata is not a new live payment. The expiry case supplies controlled SQL candidate metadata; it does not claim to alter or verify the underlying S3 object's expiry. Both fixtures are deleted after the assertions.

Before migration 0019, a three-second attempt-row lock spanning the fixture deadline produced a delivery timestamp before the deadline. The assertion requiring actual late availability failed. After applying the append-only migration through the migration journal:

- Publication began at `2026-10-14T03:18:36.087Z`, before deadline `2026-10-14T03:18:37.814Z`. Availability was established at `2026-10-14T03:18:38.934Z`, after lock release. Delivery, publisher-finished and publication-fenced timestamps agreed.
- A candidate expiring at `2026-10-14T03:18:41.160Z` was submitted at `2026-10-14T03:18:39.325Z` and blocked across that boundary. Publication returned false, result and delivery remained null, and final output evidence was unknown.

## Customer availability label

The shared customer/Recovery desk view displayed object verification time rather than canonical authenticated availability. The browser regression first failed with expected delivery `2026-10-14T00:41:00.809Z` and displayed verification `2026-10-14T00:41:00.804Z`. The label now reads `delivery.establishedAt` from the existing authenticated API projection. All six Recovery desk browser regressions passed on isolated localhost port 3037; no investigation/model calls were made. Typecheck and the webpack production build passed (existing optional wallet-connector warnings remain). The current conversion guide now names the actual deployment and documents implemented interruption recovery while preserving later retry/refund scope.
