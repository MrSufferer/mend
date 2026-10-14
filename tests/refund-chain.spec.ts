import {test,expect} from '@playwright/test';
import {encodeAbiParameters,encodeEventTopics,type Hex} from 'viem';
import {verifyRefundReceipt,reserve,token,reserveAbi,tokenAbi,signerAddresses,type ChainReceipt,type ChainReader} from '../backend/refund-chain';
const hash=`0x${'21'.repeat(32)}` as Hex,blockHash=`0x${'22'.repeat(32)}` as Hex;
const binding={chain_order_id:`0x${'23'.repeat(32)}` as Hex,payer:`0x${'24'.repeat(20)}` as Hex,amount_atomic:'1000000'};
const refundLog={address:reserve,topics:encodeEventTopics({abi:reserveAbi,eventName:'Refunded',args:{orderId:binding.chain_order_id,payer:binding.payer}}) as [Hex,...Hex[]],data:encodeAbiParameters([{type:'uint256'},{type:'uint256'}],[BigInt(1000000),BigInt(20000)])};
const transferLog={address:token,topics:encodeEventTopics({abi:tokenAbi,eventName:'Transfer',args:{from:reserve,to:binding.payer}}) as [Hex,...Hex[]],data:encodeAbiParameters([{type:'uint256'}],[BigInt(1000000)])};
function reader(overrides:Partial<ChainReceipt>={},canonicalHash:Hex=blockHash):ChainReader{return {async getChainId(){return 5042002;},async getTransactionReceipt(){return {transactionHash:hash,status:'success',blockNumber:BigInt(5),blockHash,from:signerAddresses.refund,to:reserve,logs:[refundLog,transferLog],...overrides};},async getBlock(){return {hash:canonicalHash,timestamp:BigInt(1)};}};}
test('successful refund requires canonical inclusion and exact reserve event plus payer transfer',async()=>{
 await expect(verifyRefundReceipt(reader(),'refund',hash,binding)).resolves.toMatchObject({transaction:hash,payer:binding.payer,amountAtomic:'1000000',blockNumber:'5'});
 await expect(verifyRefundReceipt(reader({},`0x${'ff'.repeat(32)}`),'refund',hash,binding)).rejects.toThrow('receipt_not_canonical');
 await expect(verifyRefundReceipt(reader({logs:[refundLog]}),'refund',hash,binding)).rejects.toThrow('matching_refund_receipt_required');
 await expect(verifyRefundReceipt(reader({status:'reverted'}),'refund',hash,binding)).rejects.toThrow('successful_receipt_required');
 await expect(verifyRefundReceipt(reader(),'refund',hash,{...binding,payer:`0x${'25'.repeat(20)}`})).rejects.toThrow('matching_refund_receipt_required');
});
