import {test,expect} from '@playwright/test';
import refund from '../backend/refund';
import {role} from './refund-fixture';
const invocation='vF4lndCNFX-ShsXYQKw8kkn8zE8KXInWpUPAWua6rxU';
test('scheduled HTTP boundary accepts platform digest and rejects mismatched or unbounded identifiers',async()=>{
 const old=process.env.REFUND_TRIGGER_ID;process.env.REFUND_TRIGGER_ID='owned-disabled-trigger';
 const request=(header:string,id=header)=>new Request('http://fixture/scheduled',{method:'POST',headers:{'Content-Type':'application/json','X-Neon-Trigger-Invocation-Id':header},body:JSON.stringify({invocation_id:id,version:1,trigger:{type:'schedule',id:'owned-disabled-trigger'},data:{scheduled_at:'2026-10-14T03:00:00.000Z'}})});
 try{
  expect((await refund.fetch(request(invocation,'different'))).status).toBe(403);
  expect((await refund.fetch(request('a'.repeat(257)))).status).toBe(403);
  // No database credentials: admission advances to reconciliation and safely reports unavailable.
  const result=await refund.fetch(request(invocation));expect(result.status).toBe(503);expect(await result.json()).toEqual({status:'pending',reason:'refund_reconciliation_unavailable'});
 }finally{if(old===undefined)delete process.env.REFUND_TRIGGER_ID;else process.env.REFUND_TRIGGER_ID=old;}
});
test('restricted durable sweep replays real-format digest without selecting a second obligation',async()=>{
 const q=role('database-refund-worker'),owner=role('migration'),id=`owned-${Date.now()}-${invocation}`;
 try{
  const first=(await q.query('SELECT mend_refund_sweep($1::text,$2::timestamptz) AS id',[id,new Date().toISOString()]))[0].id;
  const second=(await q.query('SELECT mend_refund_sweep($1::text,$2::timestamptz) AS id',[id,new Date().toISOString()]))[0].id;
  expect(second).toBe(first);
  expect((await owner.query('SELECT count(*)::int AS count FROM refund_sweeps WHERE invocation_id=$1',[id]))[0].count).toBe(1);
 }finally{await owner.query('DELETE FROM refund_sweeps WHERE invocation_id=$1',[id]);}
});
