# Mend credential setup — issue #1

Researched 2026-10-13 against [issue #1](https://github.com/MrSufferer/mend/issues/1), the local specification, Context7, and current provider documentation. This guide records completed prerequisite provisioning; production integrations remain dependent-ticket work. The local application workspace contains a synthetic UI prototype with no production environment loader. Mend-specific names below are proposed configuration contracts for downstream tickets; provider-standard names are identified explicitly.

## 1. Check the account gates first

1. Confirm you can administer `MrSufferer/mend` on GitHub.
2. Sign in to [Vercel](https://vercel.com/dashboard) and confirm a usable free/Hobby account and permission to connect the repository.
3. Sign in to [Neon](https://console.neon.tech) and confirm a Free organization for PostgreSQL, Functions, and Object Storage.
4. Choose the direct model-provider account for the recovery agent. Model API usage is billed separately; keep Neon infrastructure on Free. The user approved this architecture on 2026-10-13.
5. Verify account/API access with a bounded live inference test. Free models can work with zero purchased credits. Do not upgrade Neon or purchase credits automatically.

AI SDK supports direct provider integrations without requiring a gateway. Use an explicit provider instance so model selection does not implicitly route through Vercel AI Gateway. [AI SDK providers](https://ai-sdk.dev/docs/foundations/providers-and-models).

## 2. Prepare GitHub and Vercel access

1. In GitHub, confirm repository access through Settings and collaborators/organization permissions as applicable. If the source repository is still empty, connect it after the first approved source push; an empty repository cannot provide a deployable application.
2. In Vercel, choose Add New → Project, connect GitHub, and allow access to `MrSufferer/mend`. Select the Next.js project once deployable source exists. Stay on the approved free plan; record any account eligibility gate.
3. Record the Vercel project/account identifier. Once a production deployment exists, record its generated HTTPS URL as proposed `APP_ORIGIN`; derive proposed `SIWE_DOMAIN` from its hostname, without protocol or path. For local development, use the exact host and port used by the app.
4. Add required web-server secrets under Project → Settings → Environment Variables, selecting the intended Development/Preview/Production scope. Use separate preview credentials rather than copying production signers to every preview.
5. Redeploy after changing deployment environment values. Never add registrar, recovery-worker, administrator, merchant, or purchaser private keys to the web project.
6. Dashboard/GitHub-connected deployment does not require an application `VERCEL_TOKEN`. Create a narrowly scoped deployment token only if the chosen deployment automation requires one; keep it in the deployment environment, not runtime.

[Vercel environment variables](https://vercel.com/docs/environment-variables).

## 3. Create the Neon backend project and database credentials

1. In your Free Neon organization, create a project named `mend-backend`.
2. Choose a region currently supporting both Functions and Object Storage. The docs list Ohio, N. Virginia, Frankfurt, and Singapore; confirm availability in the console. Singapore is a reasonable starting choice for Vietnam if available.
3. Record organization ID, project ID, branch ID/name, region, and database name as public configuration metadata.
4. Open Connect → select branch/database/role → copy the pooled PostgreSQL connection string. Preserve the provider's SSL parameters. This is secret provider-standard `DATABASE_URL`.
5. Copy the direct/unpooled connection string separately as provider-standard `DATABASE_URL_UNPOOLED`, for migration tooling. Keep migration/owner credentials in a local or CI migration environment.
6. Provision separate runtime database roles for the web/API, registrar, and recovery worker. Record each role's own connection string under the same `DATABASE_URL` name in its own environment. Their table/function grants depend on the migrations: downstream implementation must ensure the worker cannot rewrite authoritative evidence/policy or grant its own refund entitlement. A distinct role name without restricted grants does not establish isolation.
7. Verify connectivity from each intended environment with a connection test such as `SELECT current_user, current_database(), 1;`. Record only role/database names and PASS/FAIL, never the URL or password.

Do not deploy the Neon database-owner URL everywhere for convenience. [Connection setup](https://neon.com/docs/get-started/connect-neon).

## 4. Create private Object Storage and credentials

1. In `mend-backend`, select the intended branch → Object storage → New bucket.
2. Create `mend-uploads`, explicitly choosing `private`.
3. Create `mend-outputs`, also `private`. These names are a proposed Mend convention.
4. Open Connect → Storage → Parameters only. Copy the endpoint and region.
5. For named credentials, open project Settings → Credentials → Create credential. Create separate named credentials for the services that need storage access, with `storage:read` or `storage:write` as needed. Write scope includes read and delete. Credentials are branch-scoped, including descendants; do not assume bucket-specific restriction from their names.
6. Save the exact provider-standard fields:

   | Variable | Value to copy |
   | --- | --- |
   | `AWS_ENDPOINT_URL_S3` | Branch storage endpoint |
   | `AWS_REGION` | Storage region |
   | `AWS_ACCESS_KEY_ID` | Credential `token_id` |
   | `AWS_SECRET_ACCESS_KEY` | Credential `s3_secret_access_key` |
   | `UPLOAD_BUCKET` | Proposed Mend value `mend-uploads` |
   | `OUTPUT_BUCKET` | Proposed Mend value `mend-outputs` |

7. Store credentials server-side only. The `AWS_*` naming does not require an AWS account. The JavaScript S3 client needs path-style requests for this endpoint.
8. Verify with a synthetic text file: authenticated upload/read/delete succeeds; anonymous reading fails. Do not use customer PDFs for provisioning tests.

Seven-day upload/output retention must be implemented separately using each file's creation time. Creating private buckets does not implement retention or per-customer authorization. [Bucket setup](https://neon.com/docs/storage/buckets), [credential setup](https://neon.com/docs/storage/authentication).

## 5. Prepare Neon deployment access and isolated Functions

1. Neon Console → organization Settings → API keys → Create new → Project-scoped → select `mend-backend`, if your organization permissions allow this. Otherwise record the access limitation; avoid deploying a broad personal key into runtime.
2. Store the one-time secret as `NEON_API_KEY` only in a local/deployment environment. Record its scope and ID without its value. This is a management credential, different from storage and AI credentials.
3. Record intended separately deployed services: API/conversion, registrar, and recovery worker. Only the registrar receives `REGISTRAR_PRIVATE_KEY`; only the worker receives `RECOVERY_WORKER_PRIVATE_KEY`.
4. During implementation, explicitly map secrets to each function's `env` declaration in `neon.ts`. Pulling a file into the deployment shell does not require forwarding every value to every function. Do not hardcode secrets in source or pass literal secret values in command examples.
5. Neon injects database/storage credentials automatically into deployed functions. Override `DATABASE_URL` with the appropriate restricted runtime role where necessary; inspect both pooled and unpooled injected access. Remove or override unwanted privileged paths, or use separately isolated projects/services if required. A restricted pooled URL with an unrestricted unpooled URL still leaves privileged access.
6. Pass the selected direct model-provider API key only to the recovery agent environment. Do not put it in the web project or browser configuration unless a separately authorized implemented server path requires it.
7. Neon Function URLs are publicly reachable. Provision independent service-invocation secrets where required, using proposed names such as `RECOVERY_TRIGGER_SECRET` and `REGISTRAR_SERVICE_SECRET`. Generate them locally with a password manager; each belongs only to its intended caller and verifier. The recovery worker must not receive authority to bypass registrar eligibility checks. Keeping a URL obscure is not authentication.
8. Scheduled triggers, authenticated invocation, cancellation, and confirmed stopped execution must be tested by the dependent implementation tickets. Account availability alone cannot prove them.
9. If Functions cannot meet the required behavior, record the failure and evaluate the approved backend-only Render Free fallback. Do not substitute public storage or paid hosting. Render provisioning is conditional on that decision, rather than an additional required account now.

[Neon API keys](https://neon.com/docs/manage/api-keys), [Function variables](https://neon.com/docs/compute/functions/environment-variables), [Function authentication](https://neon.com/docs/compute/functions/authentication).

## 6. Configure OpenRouter through AI SDK

1. Open [OpenRouter API keys](https://openrouter.ai/settings/keys). Create a dedicated Mend key and set a small credit/spending limit using the available key controls.
2. Save the key locally as `OPENROUTER_API_KEY` in `.env.provisioning/model.env`. The file has been prepared with owner-only permissions and is ignored by Git. Do not paste the key into chat or GitHub.
3. Set `AI_PROVIDER=openrouter` and `AI_MODEL` to the exact selected OpenRouter model identifier. Choose a tool-capable model using its current catalog and validate it on recovery cases. The configured model is `nvidia/nemotron-3.5-lightning:free`, verified with a synthetic tool-call round trip. Recovery-case quality evaluation remains implementation work.
4. Use the selected `:free` model for the current setup. Live verification succeeded with zero purchased credits and both requests reported zero cost. If you later choose a paid model, check [OpenRouter credits](https://openrouter.ai/settings/credits). No credit purchase or infrastructure upgrade has been made.
5. During implementation, install compatible versions of `ai` and `@openrouter/ai-sdk-provider`. Use `createOpenRouter({ apiKey: process.env.OPENROUTER_API_KEY })` and an explicit `openrouter(modelId)` model instance; avoid bare model strings that implicitly select Vercel AI Gateway.
6. Keep the provider key in the recovery worker's secret store. Neon stays Free; no Neon AI Gateway credential is needed. OpenRouter is the selected inference route, not the database or worker host.
7. Verify a bounded synthetic inference and a schema-defined tool call. Record success and the model ID without logging the key. Preserve the persisted 12-call case budget, 60-second investigation limit, independently authorized tools, and deterministic reconciliation/refund behavior.

The API key, selected free model, live inference, and synthetic schema-defined tool-call round trip are verified. The local credential file is ready for the recovery worker implementation. [OpenRouter AI SDK integration](https://openrouter.ai/docs/guides/community/vercel-ai-sdk).

### ChatGPT subscription alternative

Current OpenAI documentation describes official ChatGPT-plan OAuth for eligible open-source/local integrations. It requires client registration, protected token storage/refresh, and a compatible Responses API request contract. Remotely hosted or paid apps are directed to an eligibility interest process; support for Mend's hosted worker has not been established. This is a separate integration from OpenRouter's API key and is not selected for the current prerequisite. [Plan-usage scope](https://developers.openai.com/siwc/token-sharing-open-source), [preview requirements](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

## 7. Obtain authenticated Canteen Arc testnet RPC

1. If not installed, follow the current [Canteen CLI setup](https://arc-canteen.dev/): `uv tool install arc-canteen`.
2. Run `arc-canteen login` locally and complete GitHub sign-in.
3. Run `arc-canteen rpc-url` in your private local terminal. Save the entire URL as proposed `ARC_RPC_URL` in the server-side environments that need chain access. The URL contains the credential; never paste it into chat or an issue.
4. Verify without displaying the token:

   ```sh
   arc-canteen rpc eth_chainId
   arc-canteen rpc eth_blockNumber
   ```

5. Expect chain ID `0x4cef52`, decimal `5042002`, and a current block response. Record success, not the secret endpoint.
6. For browser wallets, use the public Arc endpoint `https://rpc.testnet.arc.io`; do not expose the authenticated Canteen endpoint through `NEXT_PUBLIC_*` configuration.

Public network configuration: chain ID `5042002`, symbol `USDC`, explorer `https://explorer.testnet.arc.io`. [Canteen RPC](https://arc-canteen.dev/arc-node/), [Arc connection details](https://docs.arc.io/arc/references/connect-to-arc).

## 8. Create independent wallets and fund them

1. Use a dedicated testnet wallet setup. Create distinct EOA identities for merchant, administrator/deployer, registrar, recovery worker, and test purchaser. Do not reuse one private key for these roles. Configure a separate operator wallet as well for a clear review/login boundary.
2. In your wallet, use the add/create account flow to create the operator wallet and add Arc Testnet using the public network configuration above. Choose a wallet that supports secure private-key export for the test-only signing roles. Independent custody/secret stores matter: different account labels in one shared seed vault do not isolate services from that vault.
3. For roles that need programmatic signing, use the wallet's documented export flow locally, or generate them using the selected Arc Foundry tooling during contract setup. Export only each role's key, never the master seed, to its designated secret store.
4. Record the public addresses and secret destinations:

   | Role | Proposed public variable | Secret destination |
   | --- | --- | --- |
   | Merchant | `MERCHANT_ADDRESS` | Human wallet; deployed services receive only the address |
   | Administrator/deployer | `ADMIN_ADDRESS` | Local encrypted wallet/keystore only; no deployed recovery service |
   | Registrar | `REGISTRAR_ADDRESS` | `REGISTRAR_PRIVATE_KEY`, registrar environment only |
   | Recovery worker | `RECOVERY_WORKER_ADDRESS` | `RECOVERY_WORKER_PRIVATE_KEY`, worker environment only |
   | Test purchaser | `TEST_PURCHASER_ADDRESS` | `TEST_PURCHASER_PRIVATE_KEY`, local purchase client/test runner only |
   | Operator | `OPERATOR_WALLET_ADDRESS` | Browser wallet only; app receives the public address |

5. Open [Circle's faucet](https://faucet.circle.com/), select USDC and Arc Testnet, enter a public wallet address, and request test funds. Repeat subject to faucet limits; verify actual received balances.
6. Fund the purchaser for multiple 1-test-USDC purchases. Fund administrator, registrar, and worker for deployment/transaction gas. Fund the merchant sufficiently to transfer the planned reserve amount. The merchant can receive purchase proceeds, but receiving payments does not fund a separate reserve contract automatically.
7. The contract address is produced by ticket #10: leave proposed `REFUND_RESERVE_ADDRESS` unset until deployment. Later transfer the chosen reserve amount, verify the successful receipt, and record deployment/public role assignments and daily cap.
8. Native balances/gas use 18 decimals and the USDC ERC-20 interface uses 6 for the same underlying funds. Do not add the two balances. Confirm receipts rather than treating transaction hashes as success.

Wallet generation, chain role grants, reserve deployment, and funding are different steps. A funded worker EOA alone does not establish bounded refund authority. [Arc unit differences](https://docs.arc.io/arc/references/evm-differences).

## 9. Configure the facilitator and app-generated secrets

1. Use proposed `X402_FACILITATOR_URL=https://facilitator.arcusnetwork.co`. Arcus currently documents no account or API key requirement.
2. Check its advertised support with `curl https://facilitator.arcusnetwork.co/supported`. Confirm Arc Testnet and the required direct-settlement exact scheme; save a redacted result. This is discovery, not a successful payment test.
3. If actual settlement fails, investigate according to the specification. Provision alternative facilitator credentials only after an explicit provider decision; no placeholder Circle API key is required by the chosen Arcus path.
4. Generate an independent random session secret if the selected session implementation needs signing/encryption. Proposed name: `SESSION_SECRET`. Generate locally using a password manager or `openssl rand -hex 32` in a private terminal; store it only in the web/session service environment. Provider-managed opaque server sessions may use a different contract, so finalize this with ticket #3.
5. Set `APP_ORIGIN`, `SIWE_DOMAIN`, and `OPERATOR_WALLET_ADDRESS` to the intended deployment and wallet. These are public configuration values, though enforced server-side. Wallet connection alone does not create a server session.

[Arcus facilitator](https://docs.arcusnetwork.co/).

## 10. Store values and hand off verification

Use separate secret stores or separately loaded ignored files for web, migrations/deployment, registrar, worker, and purchaser. The local application workspace `.gitignore` ignores `.env*` except `.env.example`; any future tracked examples must contain placeholders only. Keep administrator custody outside all those deployed environments.

| Environment | Intended secrets |
| --- | --- |
| Web/API | Its restricted database URL; required private-storage credentials; session/invocation secrets only where needed |
| Conversion | Its restricted database/storage access; no chain administrator/registrar/worker signer |
| Registrar | Registrar-only database privileges, registrar signer, authenticated RPC, invocation verifier |
| Worker/agent | Worker-only database privileges, worker signer, authenticated RPC, direct model-provider API key, required scoped storage access |
| Migration/deployment | Migration database credential, scoped Neon management credential, deployment credentials if actually needed |
| Local purchaser | Purchaser signer, test API origin, RPC if its client needs one |
| Human wallets | Merchant, administrator, and operator custody |

Verified provisioning checklist (evidence in [provisioning-status.md](provisioning-status.md)):

- [x] GitHub/Vercel access and intended free-plan setup confirmed.
- [x] Free Neon project IDs/region and restricted database access available.
- [x] Private upload/output storage and credentials verified with synthetic data.
- [x] Functions deployment/invocation configuration available; outstanding isolation/cancellation checks explicitly assigned.
- [x] Direct model-provider credentials, usable billing/access, and real inference/tool calling verified.
- [x] Canteen RPC chain ID and block access verified.
- [x] Separate role addresses and secure signer destinations recorded; operator identified.
- [x] Test funding confirmed; reserve deployment/funding follow-through assigned to #10.
- [x] No administrator key, registrar key, migration-owner URL, or management API key in the worker environment.
- [x] Secret stores are accessible to the downstream implementation/deployment environment, not merely copied into an account the implementer cannot use.

Use statuses `PASS`, `BLOCKED`, or `PENDING IMPLEMENTATION` and record non-secret evidence. Do not mark every gate passed because an account exists. Issue #1 stays open until downstream work has usable access; implementation behavior checks remain with their dependent tickets.
