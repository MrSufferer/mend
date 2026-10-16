# Mend brand

Status: selected palette and typography; inline purchase layout approved for issue #33.

Mend recovers paid document-processing orders whose delivery remains unresolved.

The user selected **Signal Teal**, then **Geist + Geist Mono**, and requested `emil-design-eng` for design judgment. The palette's exact light and dark tokens are in `app/globals.css`; the accepted source is `.brand-preview/selected-palette.json`. The palette preview passed 168 foreground/background checks across six palettes, including both Signal Teal themes, recorded in `.brand-preview/contrast-report.json`.

Use Geist for headings, labels, and body text. Use Geist Mono with tabular numerals for amounts, identifiers, timestamps, and code. Fonts load through `next/font/google`. Use 30px page headings, 20px section headings, 14px body, and 12px metadata. Keep weights to 400, 500, and 600.

Use teal for primary actions and selected states. Keep neutral surfaces quiet; use semantic warning/error colors only to communicate status, always with text. No decorative gradients are introduced. The approved A inline purchase layout keeps the product guide beside the purchase task on desktop and before it on mobile. See [issue #33](https://github.com/MrSufferer/mend/issues/33) and `docs/browser-purchase-recovery.md` for the implementation scope and recovery contract.

Speak plainly: say what is known, what is unresolved, and what happens next. Distinguish confirmed payment, delivery, actual download, refund eligibility, and confirmed refund. Always label amounts as test USDC; do not imply a dollar value. No celebratory copy while an obligation remains unresolved.

Keep keyboard navigation immediate. Use restrained pointer press feedback, reduced-motion support, visible focus, and readable narrow layouts. No decorative entrances, bouncing financial amounts, or simulated activity presented as live.
