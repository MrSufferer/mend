import {test} from 'node:test';
import assert from 'node:assert/strict';
import {deploymentId,waitForDeployment} from '../scripts/deployment-completion.mjs';
test('deployment polling waits past old completed and new inactive states for exactly POST-created id',async()=>{
 const status=(current,active)=>({function:{invocation_url:'https://owned.invalid',current_deployment:{id:current,status:'completed'},active_deployment:{id:active,status:'completed'}}});
 const pending=[status(2,2),status(3,2),status(3,3)];let reads=0;
 const result=await waitForDeployment(3,async()=>{reads++;return pending.shift();},async()=>{});
 assert.equal(reads,3);assert.equal(result.current_deployment.id,3);assert.equal(result.active_deployment.id,3);
});
test('polling rejects only target failure and never accepts a different active deployment',async()=>{
 let reads=0;
 await assert.rejects(waitForDeployment(3,async()=>{reads++;return {current_deployment:{id:2,status:'failed'}};},async()=>{},2),/Completion unconfirmed/);assert.equal(reads,2);
 await assert.rejects(waitForDeployment(3,async()=>({current_deployment:{id:3,status:'failed'}}),async()=>{}),/Deployment failed/);
});
test('POST identifier or known previous integer ID pins the deployment before polling',()=>{
 assert.equal(deploymentId({deployment:{id:3}},2),3);
 assert.equal(deploymentId(undefined,2),3);
 assert.throws(()=>deploymentId({deployment:{id:2}},2),/Invalid deployment identifier/);
 assert.throws(()=>deploymentId({}),/Deployment identifier missing/);
});

test('concurrent deployment cannot cause completion of a superseding artifact',async()=>{
 await assert.rejects(waitForDeployment(3,async()=>({current_deployment:{id:4,status:'completed'},active_deployment:{id:4,status:'completed'},invocation_url:'https://owned.invalid'}),async()=>{}),/superseded/);
});
