import {test,expect} from '@playwright/test';
import {presentExecution} from '../lib/server/execution-history';
const base={id:'original',generation:0,state:'stopped',startedAt:new Date('2026-10-14T00:00:00Z'),stoppedAt:new Date(),publisherFinishedAt:new Date(),publicationFencedAt:new Date(),finalOutputCheck:'absent',outputPublication:null};
test('a stopped original and active retry remain separate from delivery',()=>{
 const history=presentExecution([base,{...base,id:'retry',generation:1,state:'running',stoppedAt:null,publisherFinishedAt:null,publicationFencedAt:null,finalOutputCheck:null}]);
 expect(history.map(a=>a.outcome)).toEqual(['Stopped without output','Retry started · execution unconfirmed']);
 expect(JSON.stringify(history)).not.toMatch(/key|diagnostic|invocation|sha256/);
});
test('parser exit alone does not establish parent termination or final absence',()=>{
 const [attempt]=presentExecution([{...base,publisherFinishedAt:null,publicationFencedAt:null,finalOutputCheck:'absent'}]);
 expect(attempt.outcome).toBe('Execution uncertain · delivery unresolved');
});
test('prepared output and unknown checks do not become confirmed absence',()=>{
 const [attempt]=presentExecution([{...base,finalOutputCheck:'unknown',outputPublication:{state:'prepared'}}]);
 expect(attempt.outcome).toBe('Stopped · output unresolved');expect(attempt.publication).toBe('prepared');
});
