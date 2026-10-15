// Run explicitly with: node --import tsx scripts/verify-release-live-pause.mjs --run-live
// RECOVERY_ENV_DIR: seven reviewed role files for mend_ticket16_lifecycle ONLY.
// RELEASE_MODEL_ENV: private model env file; RELEASE_LIVE_REPORT: new private report path.
// Synthetic failure/payment facts, real provider inference. No live chain/settlement.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {parseEnv} from 'node:util';
import {execFileSync} from 'node:child_process';
import {lifecycle} from '../tests/recovery/harness.ts';
if(process.argv.length!==3||process.argv[2]!=='--run-live')throw Error('Explicit --run-live is required; this consumes bounded free-model allowance');
const modelFile=process.env.RELEASE_MODEL_ENV,reportFile=process.env.RELEASE_LIVE_REPORT;
if(!modelFile||!reportFile||!isAbsolute(modelFile)||!isAbsolute(reportFile))throw Error('Explicit absolute RELEASE_MODEL_ENV and RELEASE_LIVE_REPORT are required');
const mode=await stat(modelFile);if((mode.mode&0o077)!==0||mode.uid!==process.getuid())throw Error('Model credentials must be private and owned by the current user');
const model=parseEnv(await readFile(modelFile,'utf8'));if(!model.OPENROUTER_API_KEY)throw Error('OPENROUTER_API_KEY is absent; no model credential is generated');
// Exclusive creation prevents accidentally overwriting earlier live evidence.
await writeFile(reportFile,JSON.stringify({status:'started',startedAt:new Date().toISOString(),syntheticFailures:true,realProvider:true,paidModelUse:false})+'\n',{flag:'wx',mode:0o600});
const source={sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),dirty:execFileSync('git',['status','--porcelain'],{encoding:'utf8'}).trim().length>0};
let h;
try{
 h=await lifecycle(); // Guards every DB role, exact isolated DB, migration prefix before writes.
 const first=await h.seed({stopped:true,confirmedParserFailure:true}),second=await h.seed({stopped:true,confirmedParserFailure:true});
 for(const order of [first,second]){
  const result=await h.role('database-conversion')`SELECT mend_fail_execution(${order.attempt}::uuid,'absent','pdf_conversion_failed') AS value`;
  if(!result[0].value.recorded||result[0].value.paused)throw Error('Expected exactly two canonical fixture failures below deterministic pause threshold');
 }
 await h.restart('agent',{RECOVERY_LIVE_MODEL:'explicit-live-acceptance',OPENROUTER_API_KEY:model.OPENROUTER_API_KEY,RECOVERY_MODEL_ID:'nvidia/nemotron-3.5-lightning:free'});
 const startedAt=new Date().toISOString(),response=await h.call('agent','/investigate',{orderId:first.id}),body=await response.json();
 const availability=(await h.owner`SELECT paused,generation,failure_generation FROM service_availability WHERE id='merchant'`)[0];
 const incidents=await h.owner`SELECT actor_kind,reason,evidence FROM service_incidents ORDER BY created_at`;
 const state=await h.state();
 const passed=response.status===200&&availability.paused&&incidents.some(i=>i.actor_kind==='agent')&&body.actions?.some(a=>a.tool==='related_orders')&&body.actions?.some(a=>a.tool==='request_pause'&&a.evidence?.paused===true)&&body.case?.callsUsed>0&&body.case?.callsUsed<=12&&state.charges.length===0&&state.refunds.length===0;
 const report={status:passed?'passed':'outstanding',source,startedAt,finishedAt:new Date().toISOString(),syntheticFailures:true,syntheticPaymentFacts:true,realProvider:true,model:'nvidia/nemotron-3.5-lightning:free',database:'mend_ticket16_lifecycle',callLimit:12,invocationLimitSeconds:60,orderIds:[first.id,second.id],httpStatus:response.status,callsUsed:body.case?.callsUsed,invocations:body.invocations?.map(i=>({id:i.id,outcome:i.outcome,startedAt:i.startedAt,deadline:i.deadline,finishedAt:i.finishedAt})),actions:body.actions?.map(a=>({tool:a.tool,outcome:a.outcome,evidence:a.evidence})),availability,incidents,financialEffects:{charges:state.charges.length,refunds:state.refunds.length,registrations:state.registrations.length}};
 await writeFile(reportFile,JSON.stringify(report,null,2)+'\n',{mode:0o600});
 console.log(JSON.stringify({status:report.status,httpStatus:response.status,callsUsed:report.callsUsed,report:reportFile}));
 if(!passed)process.exitCode=1;
}catch(error){await writeFile(reportFile,JSON.stringify({status:'incomplete',source,finishedAt:new Date().toISOString(),reason:error instanceof Error?error.message:'verification_failed',syntheticFailures:true,realProvider:true})+'\n',{mode:0o600});throw error;}
finally{await h?.close();}
