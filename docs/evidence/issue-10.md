# Issue #10 — bounded test-USDC refund reserve

Approved seam: direct reserve authorization, separate from order-lifecycle tests. Current ETHSKILLS root, standards, building-blocks, addresses, security, testing, ship, QA, CROPS, and wallets guidance were retrieved before Solidity work. Current Context7 library-first OpenZeppelin, Foundry, and viem documentation and Arc EVM differences/deployment/address references were checked. Arc-specific units, toolchain and approved non-proxy/isolated-role architecture override generic Ethereum/scaffold recommendations.

## Contract and live evidence

The [verified reserve](https://explorer.testnet.arc.io/address/0x76b29d6a6eab98b32415b8a6adf5d587d991e082?tab=contract) uses immutable ERC-20 USDC and a 10 test USDC UTC-calendar-day cap. Blockscout returned terminal **Pass - Verified** (GUID recorded in deployment manifest). Constructor inputs, chain, roles, compiler/build settings, ABI, and successful receipt details are in `contracts/deployment/arc-testnet.json` and `RefundReserve.abi.json`.

- [Deployment](https://explorer.testnet.arc.io/tx/0x35725ca74ecc3451080d2f38cc02b7bbb9f7a0d38b6a38945caaa52b826be009): successful receipt, block 67022270.
- [Fund](https://explorer.testnet.arc.io/tx/0xb62f618db078a68e311005f8b0457e3afe0b5c751162539ae16b2df07cccaf47): successful receipt, block 67022434.
- [Register](https://explorer.testnet.arc.io/tx/0xbf5c3c126b39b05a358ec3f25c6f2d94bd7c66f797790c3d3da305bd470dd1d4): successful receipt, block 67022464.
- [Refund](https://explorer.testnet.arc.io/tx/0x58fa5813ffcaa8299c8b75f6b27c4afac081ea956395ba2eb3c6dc11a7d67a4e): successful receipt, block 67022565.

Funded **10 test USDC**, registered one clearly synthetic independent entitlement, and refunded **1 test USDC** to the designated test purchaser. The payer's ERC-20 balance increased by exactly 1,000,000 units. **9 test USDC remains in the reserve; 9 test USDC remains available for this UTC day** at the recorded check. This is a direct contract demonstration, not evidence of a real failed customer order or recovery-agent execution. Future tickets consume the shared manifest and ABI.

## Verification

The tracer test failed because the contract was absent before implementation, then passed with receipt-equivalent balance effects. Arc Foundry v0.8.0-2 `--network arc` tests exercise role rejection, wrong payer/amount, missing entitlement, irreversible entitlement/replay rejection, cumulative cap, UTC midnight reset, balance-shortfall atomicity, and invalid inputs. Eight direct tests pass, including **1,000 fuzz runs**. Two stateful invariants each pass **1,000 runs × 64 calls**, covering conservation/original recipient and daily spending across repeated registration/refund/time changes; zero handler reverts. Gas snapshot is `contracts/.gas-snapshot`. Slither **0.11.5** consumed Arc Foundry build-info (Solidity 0.8.30) and analyzed 42 contracts with 101 detectors: **zero findings**, no high/medium exclusions or false-positive waivers. Dependency/test paths were filtered from report output, not from compilation. Application typecheck passes after adding local JavaScript administration tooling.

Read-only live rejection checks and native/ERC-20 reserve-balance reconciliation are recorded in the manifest; no rejection probe broadcasts a spending transaction. No privileged keys were deployed or committed. Administrator, registrar and worker credentials were read by isolated local subprocesses, one signing role per invocation, using authenticated Canteen RPC.

## Bounds and reproducibility

See `contracts/README.md` for tool/dependency pins, reproduction commands, funding/administration procedure, licenses, and precise role/provider powers. The contract cannot independently establish offchain failure and customers have **no permissionless refund escape** if the operator disappears. Administrator role reassignment can change who is trusted; initial separation is enforced but ongoing local admin custody and registrar/worker service/database separation must be preserved by later tickets. The daily cap cannot be changed and entitlement recipients/amounts cannot be rewritten. There is no withdrawal, proxy, arbitrary-call, or merchant-wallet authority.
