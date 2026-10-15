import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {deletePrivateObject} from '../lib/server/storage-transport';
test('deletion requires actual absence and does not accept successful DELETE alone',async()=>{
 let exists=true,deny=false;
 const server=createServer((req,res)=>{if(deny){res.statusCode=503;res.end();return;}if(req.method==='DELETE'){res.statusCode=204;res.end();return;}res.statusCode=exists?200:404;res.setHeader('Content-Length','0');res.end();});
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 Object.assign(process.env,{AWS_ENDPOINT_URL_S3:`http://127.0.0.1:${(server.address() as {port:number}).port}`,AWS_REGION:'us-east-1',AWS_ACCESS_KEY_ID:'owned-fixture',AWS_SECRET_ACCESS_KEY:'owned-fixture'});
 try{await expect(deletePrivateObject('upload','accepted/fixture.pdf')).resolves.toBe(false);exists=false;await expect(deletePrivateObject('upload','accepted/fixture.pdf')).resolves.toBe(true);deny=true;await expect(deletePrivateObject('upload','accepted/fixture.pdf')).rejects.toThrow();}finally{await new Promise<void>(r=>server.close(()=>r()));}
});
