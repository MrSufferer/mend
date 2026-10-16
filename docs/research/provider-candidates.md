# Independent x402 provider candidates

Research for [Find feasible independent x402 API integration candidates](https://github.com/MrSufferer/mend/issues/39), 2026-10-16. Advisory research; no provider selected, contacted, enrolled, or paid. No working recovery integration demonstrated.

## Conclusion

**BlockRun is the strongest candidate for a bounded feasibility discussion; Heurist Mesh is a plausible cooperation-first alternative. Neither currently satisfies the milestone on evidence collected.** These are separately branded, externally operated services with first-party documentation/source, not additional Mend-owned demo endpoints. Corporate ownership was not independently audited. Provider adoption of Mend remains unproven.

Do not present the ability to call an external x402 API as the ability to recover its failures. Required next evidence is permission and technical access to a particular recovery path, plus an executed, correlated example. A Mend-controlled proxy around an external API alone does not demonstrate that the independent provider integrated Mend.

## Shortlist

| Candidate | Publicly documented service and payment | Recovery evidence | Remaining access/cooperation |
| --- | --- | --- | --- |
| **BlockRun** | AI inference gateway. Its endpoint catalog advertises x402 v2, Base mainnet USDC and a Base Sepolia test gateway with a smaller model catalog. [Catalog](https://blockrun.ai/docs/x402/endpoints) | Background Responses supports a response ID and stream resumption after disconnect; its signed payment settles at creation. **Enterprise-allowlisted wallets only.** Ordinary requests enforce `store:false`; reusing payment authorization is rejected. [Responses reference](https://blockrun.ai/docs/api-reference/responses) | Obtain provider agreement/allowlisting, establish test-model availability and authenticated retrieval, retention, payment-to-response correlation, and a reproducible failure. No delegation of refund authority established. |
| **Heurist Mesh** | Crypto intelligence tools, including `AIXBTProjectInfoAgent/search_projects`, published under `POST /x402/agents/{AgentId}/{toolName}`. Official gateway README shows Base USDC, also describes Solana/XRPL, and illustrates a v1 payment challenge. [Gateway source](https://github.com/heurist-network/heurist-mesh-x402) | Public example returns tool data synchronously. README documents health/discovery endpoints, not a durable paid-result retrieval or idempotent replay contract. | Confirm live scheme/version per selected route; request a provider-operated test environment, durable payment/request/result mapping, replay support, and recovery policy. No public recovery/refund delegation found in reviewed material. |

## BlockRun: useful narrow scenario, gated access

Candidate experiment: an enterprise-approved background inference request has settled and a known response ID exists; delivery disconnects; Mend resumes retrieval and records the existing result without creating a second paid request. This is an **inference from documented capabilities**, not a tested integration. The API documents sequence-number resumption, cancellation, and a settlement header for non-streaming responses. Its detailed reference matters: the broad catalog's background endpoint listing alone does not reveal the enterprise restriction. [Responses reference](https://blockrun.ai/docs/api-reference/responses)

An interrupted response before the client records the ID is a separate, unresolved case. Require a durable correlation contract; do not claim a transaction hash can locate arbitrary results. Also verify whether cancellation after settlement has any financial effect: free cancellation is not evidence of a refund.

The FAQ says provider-side failures do not settle, while some rejected upstream calls do; it describes onchain payments as final. Accordingly, a generic “provider timed out, Mend refunded” showcase is unsupported. A failed delivery after successful execution is a better investigation than inventing a charged upstream failure. [FAQ](https://blockrun.ai/docs/resources/faq)

## Heurist: source visibility, larger cooperation gap

Its official framework describes independently available crypto analytics tools and links the x402 gateway. This establishes a useful existing service, not successful recovery. [Framework](https://github.com/heurist-network/heurist-agent-framework)

The gateway README describes local deployment requiring a Mesh API key, and payments directed to agent authors. Running that code ourselves would not prove independent-provider adoption; the provider must supply the test deployment and relevant authority. The reviewed documentation did not establish a public sandbox, request-ID lookup, persisted result retrieval, replay guarantee, or refund endpoint. These are unknowns, not claims that the implementation cannot support them. [Gateway source](https://github.com/heurist-network/heurist-mesh-x402)

## Acceptance evidence before calling either “integrated”

1. Independent provider agrees to participate and identifies the specific endpoint, network, merchant, and recovery capabilities Mend may invoke.
2. Test environment and failure injection are permitted; identify whether tokens and outcomes are test or production.
3. Capture a stable request identifier, payment settlement evidence, job state, and delivered result under one correlation record.
4. Demonstrate permitted recovery without a second charge; separately test uncertain settlement and missing-ID cases, escalating when evidence is insufficient.
5. Document result authorization/retention, retry limits, and exactly who can authorize and execute any refund. Unsupported actions remain unavailable.

The x402 payment-identifier extension supplies a possible interoperability mechanism: servers that implement it can return cached results for repeated IDs and reject payload conflicts. Its existence does not prove either shortlisted provider supports it. [Official extension specification](https://github.com/coinbase/x402/blob/main/specs/extensions/payment_identifier.md)

## Method and limitations

Read first-party provider documentation and repositories through web tools. Context7 resolved `/coinbase/x402` and retrieved payment-identifier documentation successfully using two CLI commands outside the sandbox; no quota error. No library implementation was changed. Public discovery probes and their outcomes are recorded below; discovery alone is not paid-path validation. No signatures, account creation, purchases, refunds, or outreach occurred.

If provider cooperation is unavailable, keep the milestone explicitly unmet. An adapter contract and synthetic fixtures can test Mend's architecture but cannot substitute for the agreed independently operated integration. Human selection and cooperation/access remain the next decision.

Public read-only probes (2026-10-16): `GET https://mesh.heurist.xyz/x402/agents` returned HTTP 200 with 24 agents and a `search_projects` entry. `GET https://testnet.blockrun.ai/.well-known/x402` failed in Python TLS negotiation (`UNEXPECTED_EOF_WHILE_READING`); the browser tool also could not access it. This does not establish that BlockRun's testnet is down, but its availability was not verified. Provider documentation remains the evidence for the advertised test gateway.
