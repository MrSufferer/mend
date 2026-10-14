import {test,expect,type APIRequestContext} from '@playwright/test';
import {privateKeyToAccount} from 'viem/accounts';
import {operatorFixture} from './operator-fixture';
import {readFileSync} from 'node:fs';
import {parseEnv} from 'node:util';
import type {Hex} from 'viem';
const account=privateKeyToAccount((process.env.PROVISIONING_ENV_DIR?parseEnv(readFileSync(`${process.env.PROVISIONING_ENV_DIR}/operator.env`,'utf8')).OPERATOR_WALLET_PRIVATE_KEY:`0x${'44'.repeat(32)}`) as Hex),customer=privateKeyToAccount(`0x${'11'.repeat(32)}`);
async function signIn(request:APIRequestContext,wallet=account){const challenge=await(await request.post('/api/auth/challenge',{headers:{Origin:process.env.TEST_BASE_URL!},data:{address:wallet.address,chainId:5042002}})).json();expect((await request.post('/api/auth/verify',{headers:{Origin:process.env.TEST_BASE_URL!},data:{...challenge,signature:await wallet.signMessage({message:challenge.message})}})).status()).toBe(200);}
test('operator refund request retains actor audit and rejects deficient canonical payment without spending model calls',async({request})=>{
 const f=await operatorFixture();
 try{
  expect((await request.post(`/api/operator/orders/${f.id}/actions`,{data:{action:'refund'}})).status()).toBe(401);
  await signIn(request,customer);expect((await request.post(`/api/operator/orders/${f.id}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'refund'}})).status()).toBe(403);
  await signIn(request);expect((await request.post(`/api/operator/orders/${f.id}/actions`,{data:{action:'refund'}})).status()).toBe(403);
  const response=await request.post(`/api/operator/orders/${f.id}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'refund'}});expect(response.status()).toBe(200);const body=await response.json();
  expect(body.operatorRequest).toMatchObject({action:'refund',actor:account.address.toLowerCase(),outcome:'skipped'});expect(body.operatorRequest.outcomeEvidence.reason).toBe('payment_unknown');expect(body.case.callsUsed).toBe(12);
  const [o]=await f.owner.query('SELECT disposition,(SELECT refunded_at FROM refunds WHERE order_id=$1) AS refunded_at FROM orders WHERE id=$1',[f.id]);expect(o).toEqual({disposition:'unresolved',refunded_at:null});
  expect(JSON.stringify(body)).not.toMatch(/sessionHash|raw_transaction|PRIVATE_KEY/);
  await request.post('/api/auth/logout',{headers:{Origin:process.env.TEST_BASE_URL!}});expect((await request.post(`/api/operator/orders/${f.id}/actions`,{headers:{Origin:process.env.TEST_BASE_URL!},data:{action:'refund'}})).status()).toBe(401);
 }finally{await f.cleanup();}
});
