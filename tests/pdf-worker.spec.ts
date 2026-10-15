import {test,expect} from '@playwright/test';
import {build} from 'esbuild';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {PDFDocument,StandardFonts} from 'pdf-lib';

test('real isolated PDF worker extracts text, rejects invalid bytes, and observes termination before returning',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'mend-parser14-'));
 try{
  const options={bundle:true,platform:'node' as const,target:'node24',format:'esm' as const,banner:{js:"import{createRequire as ___cr}from'node:module';const require=___cr(import.meta.url);"}};
  await build({...options,entryPoints:['backend/parser.ts'],outfile:join(directory,'parser.mjs')});
  await build({...options,entryPoints:['backend/pdf-worker.ts'],outfile:join(directory,'pdf-worker.mjs')});
  const pdf=await PDFDocument.create();pdf.addPage().drawText('Real parser lifecycle acceptance',{font:await pdf.embedFont(StandardFonts.Helvetica)});
  await writeFile(join(directory,'input.pdf'),await pdf.save());
  await writeFile(join(directory,'run.mjs'),`import {readFile} from 'node:fs/promises';import {runPdfWorker} from './pdf-worker.mjs';
const bytes=await readFile(new URL('./input.pdf',import.meta.url));const outcomes=[];
for(const [input,budget,hold] of [[bytes,10000,0],[Buffer.from('invalid PDF'),10000,0],[bytes,100,15000]]){
 const control={};let worker,exited=false;
 const running=runPdfWorker(input,Date.now()+budget,control,reason=>{control.stopReason=reason;void control.worker?.terminate();},hold);
 worker=control.worker;worker.once('exit',()=>{exited=true;});
 const result=await running;outcomes.push({...result,exited,cleared:control.worker===undefined,threadId:worker.threadId});
}console.log(JSON.stringify(outcomes));`);
  const {stdout}=await promisify(execFile)(process.execPath,[join(directory,'run.mjs')],{timeout:20000});
  const [valid,invalid,terminated]=JSON.parse(stdout.trim().split('\n').at(-1)!);
  expect(valid).toMatchObject({code:0,reason:'completed',text:'Real parser lifecycle acceptance\n',exited:true,cleared:true,threadId:-1});
  expect(invalid.text).toBeUndefined();expect(invalid.exited).toBe(true);
  expect(terminated).toMatchObject({reason:'deadline',exited:true,cleared:true,threadId:-1});expect(terminated.text).toBeUndefined();expect(terminated.code).not.toBe(0);
 }finally{await rm(directory,{recursive:true,force:true});}
});
