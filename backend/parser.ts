import {parentPort,workerData} from 'node:worker_threads';
import {DOMMatrix} from '@napi-rs/canvas/geometry';
// Bundle the real geometry implementation: standalone text extraction needs no native canvas.
globalThis.DOMMatrix??=DOMMatrix;
// The parser receives bytes only. Its environment excludes all service credentials.
async function parse() {
 if(workerData.holdMs)await new Promise(resolve=>setTimeout(resolve,workerData.holdMs));
 await import('pdfjs-dist/legacy/build/pdf.worker.mjs');
 const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
 const task=getDocument({data:new Uint8Array(workerData.bytes),disableFontFace:true,stopAtErrors:true,verbosity:0});
 try {
  const pdf=await task.promise;if(pdf.numPages<1||pdf.numPages>50||await pdf.getPermissions()!==null)throw new Error('unsupported_pdf');
  let text='';
  for(let n=1;n<=pdf.numPages;n++) {
   const page=await pdf.getPage(n);const content=await page.getTextContent();
   for(const item of content.items)if('str' in item)text+=item.str+(item.hasEOL?'\n':' ');
   text+='\n';page.cleanup();if(Buffer.byteLength(text)>10*1024*1024)throw new Error('output_limit');
  }
  if(!text.trim())throw new Error('empty_result');return text.trim()+'\n';
 }finally{await task.destroy();}
}
parse().then(text=>parentPort!.postMessage({text}),()=>parentPort!.postMessage({error:'pdf_conversion_failed'})).finally(()=>parentPort!.close());
