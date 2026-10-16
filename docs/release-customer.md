# Purchase and retrieve a document

The [public preview origin](https://mend-3hvszzylk-gadillacers-projects.vercel.app) and its exact source96 deployment passed anonymous and authenticated checks on2026-10-15; see the [acceptance observations](release-acceptance-2026-10-15.md). Independent release QA remains outstanding in#18. Historical protected previews remain separately dated evidence.

Install the pinned dependencies with `npm ci`. Prepare a small text-based PDF: maximum 10 MiB and 50 pages; encrypted PDFs (including empty-password encryption), image-only PDFs and mixed scanned/text documents are rejected. Blank pages within a text document are allowed. Browser checkout is outside this release's scope.

Set `MEND_ORIGIN` to the recorded HTTPS origin. In a dedicated purchaser process, load `TEST_PURCHASER_PRIVATE_KEY` and the trusted public `MERCHANT_ADDRESS`; the merchant is `0x60a34E5d6DAE6226BC0788BBf5f5bc9103558896`. Never copy the purchaser key into the web service or a frontend variable. The payer needs test USDC plus native test USDC for gas.

```sh
npm run submit -- "$MEND_ORIGIN" document.pdf private-state.json
npm run purchase -- "$MEND_ORIGIN" private-state.json
```

The submission client saves a private mode0600 state file before the request and uploads directly to private storage. Read the returned terms before paying. The price is **1 test USDC**, represented as `1000000` six-decimal ERC-20 units on Arc testnet chain **5042002**. The native gas interface uses 18 decimals for the same underlying funds. Gas is separate from the purchase price and is excluded from refunds.

Keep the original PDF and state file. After an interruption, timeout or unknown settlement, rerun the same commands with the same file. The purchase client persists the signed authorization before submitting and reconciles that authorization; creating another state file or signing another payment to recover an unknown outcome risks paying for another order.

The HTTP exchange is `POST /api/orders/:id/payment` without a signature → HTTP402 with `PAYMENT-REQUIRED` v2 exact → the saved signed `PAYMENT-SIGNATURE` → HTTP200 with receipt-confirmed payment or HTTP202 pending. A hash or a facilitator response alone cannot confirm payment. Different authorizations for an existing attempt and cross-order reuse return409. Details are in [x402 purchases](x402-purchases.md).

Open the recovery desk at the same origin, connect the original paying EOA on Arc testnet and sign the SIWE challenge. Connection alone is not authentication. The verified payer can inspect their order and download available text; another wallet cannot claim the paid order or retrieve its files. An account switch removes private browser state. The unpaid capability supports original payment reconciliation; it does not authorize claimed-order downloads. See [wallet authentication](wallet-auth.md) for the programmatic challenge/verify flow.

The 120-second delivery clock starts at the successful payment block timestamp. An overdue order remains unresolved while execution or output is uncertain. Recovery may restore existing output, monitor, perform the single purchased retry, or establish an eligible refund. No additional purchase is required. A full-price refund goes only to the original payer after independent eligibility and receipt checks; it excludes network gas. Refunds depend on reserve funding, allowance, registrar and worker availability.

Each upload expires seven days after its own upload; each output expires seven days after its own creation. Download or restoration never extends either clock. Expired output returns410 even if a physical deletion retry is delayed; earlier delivery remains historical evidence. Do not treat an expired download as proof of conversion failure or refund entitlement. [Provider and trust terms](release-trust.md) apply before submitting a document.
