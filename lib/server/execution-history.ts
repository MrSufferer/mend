// Public attempt facts deliberately omit storage paths, process logs and service identities.
type Attempt={id:string;generation:number;state:string;startedAt:Date;stoppedAt:Date|null;publisherFinishedAt:Date|null;publicationFencedAt:Date|null;finalOutputCheck:string|null;outputPublication:{state:string}|null};
export function presentExecution(attempts:Attempt[]) {
 return attempts.toSorted((a,b)=>a.generation-b.generation).map(a=>{
  const stopped=!!a.publisherFinishedAt&&!!a.publicationFencedAt;
  const outcome=!stopped?(a.state==='running'&&!a.stoppedAt?(a.generation===1?'Retry started · execution unconfirmed':'Conversion started · execution unconfirmed'):'Execution uncertain · delivery unresolved'):a.finalOutputCheck==='valid'?'Stopped · verified output':a.finalOutputCheck==='absent'?'Stopped without output':'Stopped · output unresolved';
  return {id:a.id,generation:a.generation,state:a.state,outcome,startedAt:a.startedAt.toISOString(),parserExitedAt:a.stoppedAt?.toISOString()??null,executionStoppedAt:a.publisherFinishedAt?.toISOString()??null,publicationFencedAt:a.publicationFencedAt?.toISOString()??null,finalOutputCheck:a.finalOutputCheck??'unknown',publication:a.outputPublication?.state??null};
 });
}
export type ExecutionHistory=ReturnType<typeof presentExecution>;
