/** Read-only, credential-free role checks; authenticated RPC URL is the only secret. */
import { readFileSync, writeFileSync } from "node:fs";
import { createPublicClient, defineChain, http, erc20Abi, keccak256, toHex, ContractFunctionRevertedError } from "viem";
const path = "contracts/deployment/arc-testnet.json";
const manifest = JSON.parse(readFileSync(path, "utf8"));
const abi = JSON.parse(readFileSync("contracts/deployment/RefundReserve.abi.json", "utf8"));
if (!process.env.ARC_RPC_URL) throw new Error("ARC_RPC_URL required");
const chain = defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "test USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } });
const client = createPublicClient({ chain, transport: http(process.env.ARC_RPC_URL) });
if (await client.getChainId() !== 5042002) throw new Error("Wrong chain");
const { address, token, roles } = manifest;
const orderId = manifest.exercise.find(e => e.command === "register").orderId;
const payer = manifest.exercise.find(e => e.command === "register").payer;
const workerRole = keccak256(toHex("WORKER_ROLE"));
const registrarRole = keccak256(toHex("REGISTRAR_ROLE"));
const negatives = [
  ["worker cannot register entitlement", roles.worker, "registerEntitlement", [keccak256(toHex("unauthorized-check")), payer, 1_000_000n], "AccessControlUnauthorizedAccount"],
  ["worker cannot grant registrar authority", roles.worker, "grantRole", [registrarRole, roles.worker], "AccessControlUnauthorizedAccount"],
  ["registrar cannot refund", roles.registrar, "refund", [orderId, payer, 1_000_000n], "AccessControlUnauthorizedAccount"],
  ["wrong payer rejected", roles.worker, "refund", [orderId, roles.administrator, 1_000_000n], "InvalidEntitlement"],
  ["wrong amount rejected", roles.worker, "refund", [orderId, payer, 2_000_000n], "InvalidEntitlement"],
  ["refund replay rejected", roles.worker, "refund", [orderId, payer, 1_000_000n], "AlreadyRefunded"],
];
const checks = [];
for (const [name, account, functionName, args, expected] of negatives) {
  let errorName;
  try { await client.simulateContract({ address, abi, functionName, args, account }); }
  catch (error) { const revert = error.walk?.(e => e instanceof ContractFunctionRevertedError); errorName = revert?.data?.errorName; }
  if (errorName !== expected) throw new Error(`Expected rejection was not established: ${name}`);
  checks.push({ name, status: "pass", error: errorName });
}
for (const [role, account] of [[registrarRole, roles.worker], [workerRole, roles.registrar]]) {
  if (await client.readContract({ address, abi, functionName: "hasRole", args: [role, account] })) throw new Error("Roles overlap");
}
const erc20Balance = await client.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] });
const nativeBalance = await client.getBalance({ address });
if (nativeBalance / 1_000_000_000_000n !== erc20Balance) throw new Error("Arc unit reconciliation failed");
manifest.remainingReserve = erc20Balance.toString();
manifest.remainingReserveNative = nativeBalance.toString();
manifest.remainingDailyAllowance = (await client.readContract({ address, abi, functionName: "remainingDailyAllowance" })).toString();
manifest.readOnlyChecks = { blockNumber: (await client.getBlockNumber()).toString(), checks, nativeAndErc20SameUnderlyingFunds: true };
writeFileSync(path, JSON.stringify(manifest, null, 2) + "\n");
console.log(JSON.stringify(manifest.readOnlyChecks));
