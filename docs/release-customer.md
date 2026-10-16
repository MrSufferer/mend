# Purchase and retrieve a document

The browser checkout approved in [Implement approved inline browser checkout and durable purchase recovery](https://github.com/MrSufferer/mend/issues/33) extends the earlier programmatic purchase release. The [2026-10-15 preview observations](release-acceptance-2026-10-15.md) describe an older deployment without this checkout. They do not verify the new browser flow. Human acceptance remains pending in [Independent customer and operator acceptance](https://github.com/MrSufferer/mend/issues/32) until its exact reviewed commit and deployment are recorded.

## Browser purchase

Open `/` or `/orders` at the verified deployment origin. The inline purchase card sits above the customer workspace. Choose a text-based PDF or use the supplied sample PDF; the sample follows the same real upload, validation and **1 test USDC** purchase path. Keep the original PDF and compare downloaded text with its contents. Supported documents are at most 10 MiB and 50 pages. Encrypted PDFs (including empty-password encryption), image-only PDFs and mixed scanned/text documents are rejected. Blank pages within a text document are allowed.

Read the provider disclosure and purchased terms before uploading. Connect an EOA, switch to Arc testnet if requested, then sign in with a separate SIWE signature. Connection alone does not authenticate an account. Review the exact chain, token, amount and trusted merchant before approving payment. The price is **1 test USDC**, represented as `1000000` six-decimal ERC-20 units on Arc testnet **5042002**, token `0x3600000000000000000000000000000000000000`, merchant `0x60a34E5d6DAE6226BC0788BBf5f5bc9103558896`. The payer also needs native test USDC for gas. Gas is separate and excluded from refunds. No private key belongs in this browser flow.

Keep the same browser profile and origin while a purchase is unsettled. Before sending a payment, Mend saves the original submission capability and exact signed authorization in an IndexedDB purchase journal. If the request loses its response, refresh or sign in again with the original wallet and check that existing payment. Recovery replays the saved authorization; it must not ask for another payment to resolve an unknown outcome. If the browser cannot durably save the attempt, payment is blocked. See the [browser recovery contract](browser-purchase-recovery.md) for storage boundaries and interruption behavior.

Clearing site data, using another browser/device, private browsing expiry or losing the browser profile can remove the pending recovery material. SIWE recovers confirmed orders belonging to the payer, but cannot reconstruct every unsubmitted or unsettled authorization. Keep the original PDF; do not start a replacement purchase while the previous payment outcome is unknown. If signing is unavailable, an already saved authorization can still be checked. Use the recovery desk for confirmed orders, and preserve the order ID and observed wallet transaction for support when browser recovery material is missing.

After receipt-confirmed payment, track the order in the customer workspace and download the verified text when ready. Signing out or switching accounts hides private details and pending downloads immediately. Only the original paying wallet can retrieve claimed content.

## Programmatic purchase

Install the pinned dependencies with `npm ci`. Prepare a supported PDF as described above.

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
