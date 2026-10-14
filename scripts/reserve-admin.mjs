/** Local-only reserve deployment/exercise tool. Load exactly one signer role per invocation.
 * Never run in the web/worker deployment. Credentials and RPC URL are never logged.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createPublicClient, createWalletClient, defineChain, http, keccak256, toHex, erc20Abi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
const chain = defineChain({ id: 5042002, name: "Arc Testnet", nativeCurrency: { name: "test USDC", symbol: "USDC", decimals: 18 }, rpcUrls: { default: { http: ["https://rpc.testnet.arc.io"] } } });
const rpc = process.env.ARC_RPC_URL;
if (!rpc) throw new Error("ARC_RPC_URL required");
const publicClient = createPublicClient({ chain, transport: http(rpc) });
const [command] = process.argv.slice(2);
const keyName = command === "register" ? "REGISTRAR_PRIVATE_KEY" : command === "refund" ? "RECOVERY_WORKER_PRIVATE_KEY" : "ADMIN_PRIVATE_KEY";
const key = process.env[keyName];
if (!key) throw new Error(`${keyName} required in isolated local process`);
const account = privateKeyToAccount(key);
const wallet = createWalletClient({ account, chain, transport: http(rpc) });
const artifact = JSON.parse(readFileSync("contracts/out/RefundReserve.sol/RefundReserve.json", "utf8"));
mkdirSync("contracts/deployment", { recursive: true });
const manifestPath = "contracts/deployment/arc-testnet.json";
const token = "0x3600000000000000000000000000000000000000";
const fees = { maxFeePerGas: 50_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n };
if (await publicClient.getChainId() !== chain.id) throw new Error("Wrong chain");
if (await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }) !== 6) throw new Error("Wrong token decimals");
async function confirm(hash) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error("Transaction reverted");
  return { hash, status: receipt.status, blockNumber: receipt.blockNumber.toString(), gasUsed: receipt.gasUsed.toString(), effectiveGasPrice: receipt.effectiveGasPrice.toString(), explorer: `https://explorer.testnet.arc.io/tx/${hash}` };
}
async function write(address, abi, functionName, args) {
  const { request } = await publicClient.simulateContract({ address, abi, functionName, args, account, ...fees });
  return confirm(await wallet.writeContract(request));
}
if (command === "deploy") {
  const registrar = process.env.REGISTRAR_ADDRESS;
  const worker = process.env.RECOVERY_WORKER_ADDRESS;
  if (!registrar || !worker || account.address === registrar || account.address === worker || registrar === worker) throw new Error("Separate role addresses required");
  const args = [token, account.address, registrar, worker];
  const hash = await wallet.deployContract({ abi: artifact.abi, bytecode: artifact.bytecode.object, args, ...fees });
  const deployment = await confirm(hash);
  const receipt = await publicClient.getTransactionReceipt({ hash });
  if (!receipt.contractAddress || await publicClient.getCode({ address: receipt.contractAddress }) === "0x") throw new Error("Missing deployed code");
  const manifest = { chainId: chain.id, network: "Arc testnet", token, tokenDecimals: 6, nativeDecimals: 18, address: receipt.contractAddress, explorer: `https://explorer.testnet.arc.io/address/${receipt.contractAddress}`, compiler: "0.8.30+commit.73712a01", evmVersion: "prague", optimizer: { enabled: true, runs: 200 }, arcFoundryRelease: "v0.8.0-2", openZeppelinVersion: "5.4.0", constructorArguments: args, roles: { administrator: account.address, registrar, worker }, dailyLimit: "10000000", unit: "test USDC (6-decimal ERC-20 units)", deployment, exercise: [] };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ address: manifest.address, deployment }));
} else {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const expectedRole = command === "register" ? "registrar" : command === "refund" ? "worker" : "administrator";
  if (account.address.toLowerCase() !== manifest.roles[expectedRole].toLowerCase()) throw new Error("Signer does not match manifest role");
  const address = manifest.address;
  let transaction;
  const orderId = keccak256(toHex("mend-issue-10-independent-reserve-exercise-v1"));
  const payer = process.env.TEST_PURCHASER_ADDRESS;
  if (!payer) throw new Error("TEST_PURCHASER_ADDRESS required");
  if (command === "fund") transaction = await write(token, erc20Abi, "transfer", [address, 10_000_000n]);
  else if (command === "register") transaction = await write(address, artifact.abi, "registerEntitlement", [orderId, payer, 1_000_000n]);
  else if (command === "refund") {
    const before = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [payer] });
    transaction = await write(address, artifact.abi, "refund", [orderId, payer, 1_000_000n]);
    const after = await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [payer] });
    if (after - before !== 1_000_000n) throw new Error("Payer did not receive exact refund");
  } else throw new Error("Use deploy, fund, register, or refund");
  manifest.exercise.push({ command, orderId, payer, transaction });
  manifest.remainingReserve = (await publicClient.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [address] })).toString();
  manifest.remainingDailyAllowance = (await publicClient.readContract({ address, abi: artifact.abi, functionName: "remainingDailyAllowance" })).toString();
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(JSON.stringify({ command, transaction, remainingReserve: manifest.remainingReserve, remainingDailyAllowance: manifest.remainingDailyAllowance }));
}
