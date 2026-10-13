export type RecoveryPolicy = { deliverySeconds: number; maxRetries: number; automaticRefundAllowance: string };
export const defaultPolicy: RecoveryPolicy = {deliverySeconds: 120, maxRetries: 1, automaticRefundAllowance: '10'};
export function validatePolicy(value: RecoveryPolicy): RecoveryPolicy {
  if (!Number.isInteger(value.deliverySeconds) || value.deliverySeconds < 1 || value.deliverySeconds > 120 ||
      !Number.isInteger(value.maxRetries) || value.maxRetries < 0 || value.maxRetries > 1 ||
      !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value.automaticRefundAllowance)) throw new Error('Invalid bounded recovery policy');
  return {deliverySeconds:value.deliverySeconds, maxRetries:value.maxRetries, automaticRefundAllowance:value.automaticRefundAllowance};
}
export function purchasedTerms(policy: RecoveryPolicy, version: string) {
  return {
    version, price:{amount:'1', currency:'test USDC', network:'Arc testnet'},
    deliverySeconds:policy.deliverySeconds, deliveryClock:'Starts only at receipt-confirmed payment; hosting interruptions do not extend the original deadline.',
    maxRetries:policy.maxRetries, automaticRefundAllowance:{amount:policy.automaticRefundAllowance, currency:'test USDC', period:'UTC calendar day'},
    refund:'Confirmed failure with exhausted recovery permits a full purchase-price refund. Gas is excluded. A timeout alone does not establish refund eligibility; ambiguous evidence remains unresolved for operator review.',
    retention:{uploadDays:7, outputDays:7, clocks:'Each upload expires seven days after upload; each output expires seven days after creation. Downloads and restoration never restart either clock.'},
    providers:['Vercel hosts the API and can access document data during validation.', 'Neon stores private documents and authoritative order records.', 'Local PDF processing inspects document content; documents are not placed on-chain.', 'Planned recovery uses OpenRouter with NVIDIA Nemotron (nvidia/nemotron-3.5-lightning:free); OpenRouter and the selected inference provider see recovery evidence sent for inference. Document contents must be excluded. This unpaid submission slice does not invoke a model.'],
    dependence:'Settlement pays the merchant directly. Refunds depend on operator funding and a separately authorized registrar. There is no unconditional deadline refund or permissionless refund if the operator disappears.',
  };
}
export type PurchasedTerms = ReturnType<typeof purchasedTerms>;
