# Issues #2 and #3 review fixes

The final spec review reported no findings. The two standards findings were addressed in one isolated implementation pass:

- Live primary/secondary controls use weight 500 and the live wordmark uses 600, within `brand.md`'s allowed weights. The archived prototype's selectors remain unchanged. Browser computed styles confirmed live button 500 and wordmark 600.
- Four identical asynchronous sign-out error callbacks now share a stable `reportSignOutFailure` callback. The revocation queue, generation guards and visible failure copy retain their behavior.

`npm run typecheck`, `npm run build` and `git diff --check` passed. Four focused real injected-wallet browser regressions passed: account switching hides private data and revokes the previous session; switching during a held signature cannot restore the previous identity; returning focus from a wallet prompt preserves the current signature; narrow layouts and keyboard sign-in remain usable. No new tests were needed for these style and callback-refactoring fixes.

The deployed in-flight-download check initially failed because its request tracker compared every request with hardcoded local port 3022. Protected-preview API requests to port 3033 therefore counted as external downloads. A diagnostic exposing origins only confirmed that all tracked requests went to the preview proxy, with no private-storage request. The tracker now compares requests with the exact issued grant URL kept only in memory. The corrected case passed against the deployed preview; no production access-control change was needed.
