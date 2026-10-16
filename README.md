# Mend

Mend converts a paid text PDF into private plain text, tracks interrupted execution, and recovers from durable evidence. Purchases use x402 on Arc testnet; the recovery desk uses paying-wallet SIWE authentication. All amounts are **test USDC**.

- [Release setup, deployment inputs and remaining acceptance gates](docs/release.md)
- [Browser purchase, durable recovery and private tracking](docs/release-customer.md)
- [Programmatic x402 purchase](docs/x402-purchases.md)
- [Labeled recovery demonstrations and evidence](docs/release-demonstrations.md)
- [Provider exposure, retention and authority](docs/release-trust.md)
- [Licensing and dependency inventory](docs/release-licenses.md)
- [Isolated process-crash and concurrency suite](docs/recovery-lifecycle.md)

The source implements paid conversion, recovery, isolated refund registration and repayment, service health, and independent upload/output retention. Historical provider proofs remain dated observations. A protected preview or a passing fixture suite does not establish a publicly accepted release; the [release status](docs/release.md#acceptance-status) lists the remaining gates.

Project code is [MIT licensed](LICENSE). Dependencies retain their own licenses.
