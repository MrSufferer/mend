# Mend prototype review

Updated 2026-10-12. Prototype and specification work only.

## Question and accepted choices

Which information hierarchy best supports Mend recovery: a focused order queue, a shared incident, or a compact ledger? The user approved exploring all three, including customer sign-in, order tracking, private results, operator reserve capacity, and pause/resume.

**Accepted:** A — Recovery desk as the layout direction; Signal Teal; Geist and Geist Mono; Emil design engineering guidance for quiet surfaces, immediate navigation, and restrained press feedback. The exact palette is in `.brand-preview/selected-palette.json` and `app/globals.css`. Brand guidance is in `brand.md`.

**Layout verdict:** The user selected A — Recovery desk. Use the order queue with focused case detail as the baseline for the next iteration. A is already the default when no variant is specified; B and C remain available as comparison artifacts.

**Specification interview complete:** the user accepted rounds 1 and 2 and confirmed shared understanding in Q12. Prototype alignment and visual revalidation remain outstanding. No prototype shortcut changes production architecture or financial policy. Ticket creation/publication and production implementation remain paused.

## Review artifact

Run `npm run prototype`. Open http://127.0.0.1:3000/prototype/mend?variant=A. Floating arrows and left/right keys switch A Recovery desk, B Incident room, and C Order ledger without resetting in-memory state. Use the audience toggle for customer flows. Scenario controls inject edge cases and expose simulated financial actions. Refresh resets all fixtures.

The prototype lives under `app/prototype/mend`, is explicitly synthetic, and returns not-found in production builds. It has no backend or credentials. Local capture branch: `prototype/mend-ui`. No issue tracker or remote is configured; this file is the implementation context pointer until ticket publication resumes.

## Validation

- TypeScript check and Next.js production build passed.
- Browser checked all three variants at 375px; no page overflow after fixing the ledger table's positioned hidden heading. The ledger scrolls within its table container.
- Inspected desktop Recovery desk, Incident room, dark Order ledger, and mobile Incident room screenshots.
- Exercised reserve-capacity block, funding, refund submission, separate receipt confirmation, existing-output restoration, state preservation across layout changes, two-step simulated sign-in, and sample download.
- Keyboard variant switching and light/dark toggles worked.

These checks validate the prototype's presentation and simulated transitions only, not real authentication, recovery, data privacy, financial enforcement, or integrations. No automated test suite was added to throwaway code.

## Findings to discuss

1. A keeps the selected obligation and evidence together. B explains shared failure before individual action. C prioritizes scanning many orders.
2. Refund capacity and purchase availability need separate controls: funding does not reset the daily allowance, and passing health checks does not resolve blocked refunds.
3. Submission, confirmation, result availability, and actual download need separate visible states.
4. Customer screens should lead with outcome and next step; operational evidence can remain secondary.

The layout selection is accepted and recorded in SPEC.md. Round 1 decisions below now supplement the layout selection. Continue the remaining interaction review within Recovery desk, then reconsider the provisional ticket dependencies. Do not publish tickets until explicitly resumed.


## Accepted interaction review — round 1

The user accepted all six recommendations: autonomous recovery plus guarded operator actions; customer outcome-first summaries with private operational diagnostics; an unresolved-first queue prioritizing intervention and overdue obligations; late-result restoration only before refund entitlement registration; seven-day retention per file from its creation; and aggregate authorized-refund capacity plus a health check after the latest pause before resuming sales. See SPEC.md, “Accepted interaction decisions — grill round 1,” for the authoritative behavior.

Prototype gaps remain: customer/operator evidence is shared; operator actions simulate direct transitions; the queue starts with all orders; expired files imply resolved status; retention examples use payment time; and resume checks only one refund’s capacity. These are documented shortcuts, not implementations of the accepted decisions. No prototype code was changed during this interview.


## Accepted interaction review — round 2

The user accepted all five follow-up recommendations: deterministic operator review after model-budget exhaustion without resetting the budget; execution-time revalidation and actor/outcome audit history; continued obligations and normal refund assessment after file expiry; a real synthetic-document health check with payment-availability and aggregate-capacity checks, invalidated by subsequent confirmed processing failure; and customer explanations for funding, allowance, or receipt delays without promises of uncertain completion times.

SPEC.md records the behavior and future acceptance checks. The user confirmed shared understanding in Q12; this specification interview is complete. The prototype has not been updated or revalidated against either interview round. Ticket publication and production implementation remain paused.


## Ticket publication follow-up

After closing this interview, the user resumed to-tickets, approved the revised 18-ticket breakdown, and selected GitHub repository MrSufferer/mend. All tickets are now published; earlier publication-hold and unconfigured-tracker statements above are historical. See the research and ticket plan for issue links. The prototype remains synthetic and has not been revalidated against the interview decisions. Production implementation has not begun.
