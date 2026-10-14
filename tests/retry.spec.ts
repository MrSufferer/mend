import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
// Public lifecycle seam, real DB/S3 authority. Copied receipt is a labeled fixture only.
test('trusted retry admission preserves the purchased deadline and starts at most one retry',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/verify-retry-fixture.mjs'],{encoding:'utf8'}));
 expect(result.retry.status).toBe('completed');
 expect(result.generations).toEqual([0,1]);
 expect(result.deadlinePreserved).toBe(true);
 expect(result.replay.reason).toBe('disposition_fenced');
 expect(result.convertReplay).toEqual({status:'completed',generation:1});
});
test('a running retry remains unresolved even when the original attempt stopped without output',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/verify-retry-fixture.mjs'],{encoding:'utf8',env:{...process.env,RETRY_FIXTURE_MODE:'running'}}));
 expect(result.reconciliation.status).toBe('execution_unknown');
 expect(result.generations).toEqual([0,1]);
});
for(const [mode,reason] of [['expired','deadline_elapsed'],['policy','policy_disallows_retry'],['unknown','execution_unknown'],['storageerror','output_unknown'],['finalunknown','output_unknown'],['unexpectedoutput','output_unknown']] as const){
 test(`retry denies ${mode} evidence without another attempt`,()=>{
  const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/verify-retry-fixture.mjs'],{encoding:'utf8',env:{...process.env,RETRY_FIXTURE_MODE:mode}}));
  expect(result.result.reason).toBe(reason);expect(result.generations).toEqual([0]);
 });
}
test('retry request restores verified prepared output without starting another attempt',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/verify-retry-fixture.mjs'],{encoding:'utf8',env:{...process.env,RETRY_FIXTURE_MODE:'found'}}));
 expect(result.result.status).toBe('restored');expect(result.result.restored).toBe(true);expect(result.generations).toEqual([0]);
});
test('model-selected retry uses only the invocation-pinned trusted conversion command',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/verify-retry-agent-fixture.mjs'],{encoding:'utf8'}));
 expect(result.commands).toEqual(['retry']);expect(result.inputFields).toEqual([['invocationId']]);expect(result.actions[0].tool).toBe('retry_once');expect(result.actions[0].evidence.status).toBe('completed');expect(result.calls).toBe(2);
});

for(const [mode,reason] of [['lockdeadline','deadline_elapsed'],['lockinvocation','invocation_expired'],['stale','inspection_stale'],['workerforge','permission_denied']] as const){
 test(`retry revalidates ${mode} at trusted admission`,()=>{const result=JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/verify-retry-fixture.mjs'],{encoding:'utf8',env:{...process.env,RETRY_FIXTURE_MODE:mode}}));expect(result.result.reason).toBe(reason);expect(result.generations).toEqual([0]);});
}
