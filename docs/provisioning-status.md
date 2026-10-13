# Mend provisioning handoff

Prepared 2026-10-13 for [issue #1](https://github.com/MrSufferer/mend/issues/1). Full configuration instructions are in [credential-setup.md](credential-setup.md); resource identifiers and verification results are in [provisioning-status.json](provisioning-status.json).

## Completed

- Confirmed administrator access to the GitHub repository.
- Created the undeployed [Mend Vercel project](https://vercel.com/gadillacers-projects/mend/settings/environment-variables) and selected Next.js. After explicit user approval, uploaded web-only database credentials, scoped storage credentials, session secret, and required public configuration to Production and Development. Readback verified all 13 variables. No wallet private keys were uploaded.
- Created the Free [Neon backend project](https://console.neon.tech/app/projects/morning-bar-76751353) in Singapore, using PostgreSQL 18.
- Created separate web, conversion, registrar, and worker database roles. Verified their pooled connections and absence of elevated PostgreSQL role flags. Application table grants remain pending schema implementation.
- Created private `mend-uploads` and `mend-outputs` buckets. Verified authenticated upload/download, anonymous access denial, and worker write denial against both buckets. Deleted the synthetic test objects.
- Created separate storage credentials: web and conversion read/write; worker read only; registrar has none. These credentials are scoped to the branch and its descendants, rather than individual buckets.
- Verified Neon Functions management access. No Functions have been deployed; runtime isolation, authentication, and cancellation tests require implementation.
- Verified existing authenticated Canteen RPC chain ID and block access.
- Generated six separate testnet wallets plus session and service secrets. Saved credentials under the ignored, owner-only `.env.provisioning` directory. Files are mode `0600`; the directory is `0700`.
- Opened GitHub access settings, Vercel, Neon, billing, Circle faucet, Canteen, and the local credential folder. Copied the public purchaser address to the clipboard for faucet use.

## Model access verified

OpenRouter is selected and Neon stays Free. The supplied key authenticates successfully. `AI_MODEL=nvidia/nemotron-3.5-lightning:free` is configured in the ignored, owner-only `.env.provisioning/model.env`. Live inference, a schema-defined `get_order` call with validated arguments, and a synthetic tool-result round trip all passed on 2026-10-13. Both requests reported zero cost despite zero purchased credits. No credit purchase or upgrade is required for the verified free-model access.

This verifies provider credentials and REST API tool calling. Installing the AI SDK provider, evaluating recovery cases, and enforcing runtime budgets remain implementation work. Keep the key scoped to the recovery worker; it has not been uploaded to Vercel.

## Custody follow-through

Generated wallet files contain raw testnet private keys protected by filesystem permissions. The administrator key remains local and separate from service signers. An encrypted local administrator keystore is a recommended custody improvement; before deploying services, place each service signer only in its own runtime secret store.

**Funding verified:** All six generated wallets have 20 native test USDC each on Arc, checked on 2026-10-13. Native and ERC-20 interfaces represent the same funds; do not add their balances. Reserve deployment and funding still follow ticket #10.

**Operator import:** The user reports importing the operator private key into the browser wallet. Its displayed account address has not been independently checked against `OPERATOR_WALLET_ADDRESS`.

## Implementation follow-through

- The GitHub repository is empty. Source connection, deployment, `APP_ORIGIN`, and `SIWE_DOMAIN` await deployable application code.
- Add schema-specific database grants and load only the credentials intended for each service. `migration.env` contains the owner connection and stays local to migrations.
- Override privileged database defaults when deploying Neon Functions, including both pooled and unpooled database variables. Do not deploy a worker with the migration-owner connection.
- Facilitator discovery now passes: public `/supported` returned HTTP 200 without credentials and advertised `exact` and `batch-settlement` on Arc testnet (`eip155:5042002`). The earlier HTTP 403 is resolved. Real payment verification belongs to implementation.
- Reserve deployment, funding, and on-chain role grants belong to ticket #10. Generated wallets do not establish contract permissions.
- The approved model-provider alternative now has usable verified access. No paid-model credit gate remains. No production deployment or paid resource purchase was performed; issue closure covers provisioning access only.

## Issue #1 closure readiness

No recorded provider/account access blocker remains. The approved OpenRouter alternative, isolated credentials, funding, and provisioning evidence are available locally. This non-secret handoff records the approved OpenRouter alternative for issue #1 closure. Application deployment, runtime behavior, payment settlement, and contract setup remain dependent-ticket work.

## Local credential files

Load individual files for the intended role; do not load the whole directory into every service.

| Files | Intended consumer |
| --- | --- |
| `database-web.env`, `storage-web.env`, `session.env` | Web server; approved values also configured in Vercel |
| `database-conversion.env`, `storage-conversion.env` | Conversion service |
| `database-registrar.env`, `registrar.env`, `registrar-service.env`, `rpc.env` | Registrar service |
| `database-worker.env`, `storage-worker.env`, `worker.env`, `recovery-trigger.env`, `rpc.env`, `model.env` | Recovery worker; OpenRouter free model and tool-call access verified |
| `migration.env`, `storage-default.env` | Local migration/provisioning; never copy into web or worker |
| `administrator.env`, `merchant.env`, `operator.env`, `purchaser.env` | Separate local testnet wallet custody |
| `public.env` | Public addresses and network configuration |

The storage JSON files contain secret credential material as well. Keep them inside the ignored directory. Do not paste private keys, database URLs, storage secrets, or the authenticated RPC URL into chat or GitHub.
