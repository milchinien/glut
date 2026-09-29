import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';

async function freePort(){const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));return port;}
test('password, device pairing and authenticated ingest',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glut-host-')),port=await freePort(),base=`http://127.0.0.1:${port}`;
  const child=spawn(process.execPath,['src/host.mjs'],{cwd:path.resolve('.'),env:{...process.env,GLUT_DATA_DIR:dir,GLUT_PASSWORD:'test-secret',GLUT_PORT:String(port),GLUT_HOST:'127.0.0.1'},stdio:'ignore'});
  try{
    let ready=false;for(let i=0;i<50;i++){try{const r=await fetch(base+'/usage/healthz');if(r.ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,'host started');
    assert.equal((await fetch(base+'/usage/api/stats')).status,401);
    const login=await fetch(base+'/usage/api/login',{method:'POST',body:new URLSearchParams({password:'test-secret'}),redirect:'manual'});
    assert.equal(login.status,303);const cookie=login.headers.get('set-cookie').split(';')[0];
    const auth={Cookie:cookie};
    const start=await fetch(base+'/usage/api/pair/start',{method:'POST',headers:auth});assert.equal(start.status,200);const {code}=await start.json();
    const deviceId='5bc88166-e7de-44d1-82c0-74bb0e4bdb32';
    const claim=await fetch(base+'/usage/api/pair/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,deviceId,name:'Test-PC'})});assert.equal(claim.status,200);const {token}=await claim.json();
    const event={id:'usage:test-1',provider:'codex',session:'test-session',project:'C:/project',model:'gpt-5.6-sol',account:'test',at:'2026-09-29T12:00:00.000Z',kind:'usage',device:{id:deviceId,name:'Test-PC',user:'test'},input:100,cached:0,cacheWrite:0,cacheWriteOneHour:0,output:20,prompts:0};
    const send=()=>fetch(base+'/usage/api/ingest',{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({version:2,events:[event],limits:[]})});
    assert.equal((await send()).status,200);assert.equal((await send()).status,200);
    const stats=await fetch(base+'/usage/api/stats',{headers:auth});assert.equal(stats.status,200);const data=await stats.json();assert.equal(data.events.length,1);assert.equal(data.events[0].tokens,120);assert.ok(data.events[0].cost>0);
    assert.equal((await fetch(base+'/usage/api/stats')).status,401);
  }finally{child.kill();await new Promise(r=>child.once('exit',r));fs.rmSync(dir,{recursive:true,force:true});}
});
