# Bounded refund reserve

The direct reserve authorization seam was approved in SPEC.md. This non-upgradeable contract holds separately funded **test USDC**, uses its 6-decimal ERC-20 interface, and permits an isolated worker to pay only an immutable registrar-recorded entitlement's original payer and exact amount once. Every refund counts against the immutable 10 test USDC UTC-calendar-day limit; insufficient funding or allowance reverts atomically and preserves the entitlement for later retry. It has no withdrawal, arbitrary-call, proxy, entitlement-edit, or limit-change function.

The local administrator can grant/revoke roles, including appointing a malicious registrar or combining roles after deployment. Initial administrator, registrar, and worker addresses must differ. The registrar is trusted to establish offchain job failure and original payment evidence. The worker cannot register entitlements, assign roles, alter amounts, or redirect a registered refund. A compromised worker can spend valid entitlements up to the daily cap; a compromised registrar can authorize false entitlements. Customers have no permissionless refund escape if the merchant/registrar/worker disappears. Gas is excluded from refunds. The merchant receives purchases directly; the reserve never has spending authority over that wallet.

Arc/Circle can blocklist transfers and Arc infrastructure/RPC/explorer providers can interrupt access or expose wallet metadata. Entitlement IDs, recipients, amounts, and events are public; document contents stay offchain. Canteen RPC credentials remain server-side. The web process receives no administrator, registrar, worker, or purchaser signing key. Keep the administrator local and deploy registrar and worker independently with separate database authority. The isolated registrar now registers eligible purchased obligations only after durable original-payment, stopping, recovery and output checks; the independent refund worker reconciles canonical repayment. The historical direct-contract exercise in the manifest remains an explicitly labeled synthetic entitlement, distinct from the later genuine purchased-obligation refund.

## Reproduce

Install **Arc Foundry v0.8.0-2** using the official [installation guide](https://docs.arc.io/arc/tutorials/install-arc-foundry). The inspected binary reports 1.7.1-dev, commit d497beea7096ff2a8e583c8b307941f24a61b06b. Initialize pinned dependencies with `git submodule update --init --recursive`. OpenZeppelin Contracts **5.4.0**, commit c64a1edb67b6e3f4a15cca8909c9482ad33a02b0; forge-std **1.9.7**, commit 77041d2ce690e692d6e03cc812b57d1ddaa4d505. Dependencies retain upstream MIT licenses. Solidity **0.8.30**, optimizer 200, Prague target works on Arc's Osaka runtime. All tests use Arc Foundry `--network arc`; no stock-Anvil fidelity claim.

From `contracts/`:

```sh
arc-forge test --network arc
arc-forge snapshot --network arc --match-contract RefundReserveTest --check
arc-forge build --build-info
uv venv /tmp/mend-slither
uv pip install --python /tmp/mend-slither/bin/python slither-analyzer==0.11.5
# crytic-compile invokes the name "forge". Point that name to the Arc binary.
PATH=/path/to/arc-forge-alias:$PATH /tmp/mend-slither/bin/slither . \
  --compile-force-framework foundry --foundry-compile-all --filter-paths 'lib/|test/'
arc-forge inspect RefundReserve abi --json > /private/tmp/mend-generated-reserve-abi.json
# Compare the generated ABI to deployment/RefundReserve.abi.json; do not overwrite it.
```

`scripts/reserve-check.mjs` performs nonfinancial live checks but also rewrites the tracked manifest. Do not run it as a read-only reproduction command. Use an inspected independent RPC reader writing a separate dated snapshot, with only `ARC_RPC_URL`; no signing key is required. Do not rerun deployment/funding/exercise commands for freshness.

`deployment/RefundReserve.abi.json` is the shared ABI, and `deployment/arc-testnet.json` records deployment inputs, successful receipts, explorer links, funding, and the independent exercise. Use `scripts/reserve-admin.mjs` from the repo root **only locally**, with `ARC_RPC_URL` and exactly one role's private key supplied to each separate invocation. `deploy` needs `ADMIN_PRIVATE_KEY`, `REGISTRAR_ADDRESS`, and `RECOVERY_WORKER_ADDRESS`; `fund` needs only the administrator signing key; `register` needs only `REGISTRAR_PRIVATE_KEY`; `refund` needs only `RECOVERY_WORKER_PRIVATE_KEY`. Exercise commands also require the public `TEST_PURCHASER_ADDRESS`. Never copy all signing keys into one process or hosted web environment. These are deliberate one-time demonstration commands, not production recovery handlers. Inspect receipts and manifest before rerunning any command after an interrupted response; do not blindly repeat a funding/deployment transaction.

Source verification uses the exact build inputs and encoded constructor arguments with `arc-forge verify-contract ADDRESS src/RefundReserve.sol:RefundReserve --chain-id 5042002 --verifier blockscout --verifier-url https://explorer.testnet.arc.io/api/ --constructor-args ENCODED_ARGS --watch`. Verification must reach a successful terminal result; submission alone is insufficient.

## Exact verified compiler input

[verified-standard-input.json](deployment/verified-standard-input.json) contains only public source/settings from the verified explorer response, with pinned dependency contents. Compile with Solidity `0.8.30+commit.73712a01`:

```sh
solc-0.8.30 --standard-json < deployment/verified-standard-input.json > /private/tmp/mend-verified-standard-output.json
```

Use the `RefundReserve` output and constructor arguments in the manifest. Default Foundry auto-remappings currently add nested test/dependency remappings absent the original compiler metadata. Executable source behavior is unchanged, but complete CBOR metadata differs. The checked-in exact verified input reproduces full runtime (after immutable token substitution) and original creation bytecode plus constructor arguments, freshly checked at block67371576 on2026-10-15. See [fresh release observation](../docs/release.md#fresh-contract-verification-observation) for the local tests, ABI, Slither and canonical receipt limits. This is not a full product QA pass.
