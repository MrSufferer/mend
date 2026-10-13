# Review of tickets #2 and #3

Fixed point: `origin/main` (`b7339e744097770f7b4276207bd6b4fb04f12c27`). Reviewed integration: `6a78a79e519eba04a6377abaf16733498495f29a`. Two independent reviewers read the diff and documented standards/specification.

## Standards

Two low-severity findings; no blocking authorization/privacy or architecture breach.

1. Live buttons inherited weight 550 and the wordmark 650, outside brand.md's 400/500/600 range. Apply scoped live weights 500 and 600.
2. Four wallet revocation paths repeated the same user-facing catch callback. Possible Duplicated Code (heuristic): share the error handler while retaining the revocation queue.

## Spec

Zero findings against the requested #2 and #3 slices. Validation, durable recovery, immutable terms, private access, SIWE, atomic wallet claims, customer isolation and operator restrictions match those tickets. Payment/conversion/recovery/scheduled deletion belong to later tickets.

## Independent deployed checks

Preview `https://mend-byp8sj9fl-gadillacers-projects.vercel.app`, source integration above: PASS anonymous customer/operator/session rejection, foreign/missing private-download rejection, attacker-Origin challenge rejection, safe error DTOs and private/no-store responses. PASS signed-out pages show no private orders/claim form, 375px without overflow, keyboard skip-link focus. Review used temporary protected-preview forwarding; no application secrets were printed. Authenticated lifecycle evidence is recorded separately. Forced-expiry and disposable operator fixtures are local only.

Both standards findings were resolved in `604dbf4`, merged as `5e09439`, and the standards reviewer confirmed both fixes with no new blocking finding. The deployment-independent private-download assertion was corrected in `c517fe3` (integration `1c508cc`); a focused reviewer recheck found no new blocking issue. See [review-fix evidence](../review-fix-evidence.md). This report does not claim remaining parent-spec tickets or release acceptance for money movement.
