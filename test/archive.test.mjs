import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {normalizeUsage,parseFile,openArchive} from '../src/archive.mjs';
import {total,filterEvents,sessions,sortRows,monthRange,limitWindows} from '../public/analytics.js';

test('exclusive token categories reconcile for both providers',()=>{
  assert.deepEqual(normalizeUsage('codex',{input_tokens:100,cached_input_tokens:80,output_tokens:10}),{input:20,cached:80,cacheWrite:0,cacheWriteOneHour:0,output:10,tokens:110});
  const c=normalizeUsage('claude',{input_tokens:3,cache_read_input_tokens:30,cache_creation_input_tokens:100,cache_creation:{ephemeral_1h_input_tokens:20},output_tokens:7});
  assert.deepEqual(c,{input:3,cached:30,cacheWrite:80,cacheWriteOneHour:20,output:7,tokens:140});
});

test('Claude repeated message blocks count once and tool results are not prompts',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glut-parse-'));
  try{
    const file=path.join(dir,'session.jsonl'),at='2026-09-20T10:00:00.000Z';
    const records=[
      {type:'user',timestamp:at,sessionId:'session',cwd:'C:/src/Michi/Example',promptId:'p1',message:{content:'Hallo'}},
      {type:'user',timestamp:at,sessionId:'session',cwd:'C:/src/Michi/Example',message:{content:[{type:'tool_result',content:'x'}]}},
      {type:'assistant',timestamp:at,sessionId:'session',message:{id:'m1',model:'claude-opus-5',usage:{input_tokens:1,cache_read_input_tokens:10,output_tokens:1}}},
      {type:'assistant',timestamp:at,sessionId:'session',message:{id:'m1',model:'claude-opus-5',usage:{input_tokens:1,cache_read_input_tokens:10,output_tokens:4}}},
    ];
    fs.writeFileSync(file,records.map(x=>JSON.stringify(x)).join('\n'));
    const parsed=await parseFile(file,'claude');
    assert.equal(parsed.duplicates,1);assert.equal(parsed.events.filter(x=>x.kind==='prompt').length,1);
    assert.equal(parsed.events.filter(x=>x.kind==='usage').length,1);
    assert.equal(total(parsed.events).tokens,15);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('whole archive sorting happens before pagination and filters preserve totals',()=>{
  const events=Array.from({length:60},(_,i)=>({provider:'codex',session:`s${i}`,device:{id:i%2?'a':'b'},project:'P',model:'m',day:'2026-09-01',cost:i===59?1000:i,tokens:i+1}));
  const ordered=sortRows(sessions(events),'cost',-1);
  assert.equal(ordered[0].id,'s59');assert.equal(ordered.slice(0,20)[0].cost,1000);
  const a=filterEvents(events,{device:'a'}),b=filterEvents(events,{device:'b'});
  assert.equal(total(a).tokens+total(b).tokens,total(events).tokens);
});

test('month comparison and nearby limit reset timestamps',()=>{
  assert.deepEqual(monthRange('2026-09','2026-09-29').previous,['2026-08-01','2026-08-29']);
  const rows=[{provider:'codex',account:'a',limitId:'x',slot:'primary',minutes:10080,reset:1791046714,at:'2026-09-29T14:18:00Z',percent:14},{provider:'codex',account:'a',limitId:'x',slot:'primary',minutes:10080,reset:1791046715,at:'2026-09-29T14:19:00Z',percent:15}];
  const windows=limitWindows(rows);assert.equal(windows.length,1);assert.equal(windows[0].percent,15);assert.equal(windows[0].observations,2);
});

test('SQLite archive retains events after source no longer exists',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'glut-db-'));
  try{let db=openArchive(dir);db.prepare('INSERT INTO events VALUES(?,?)').run('x',JSON.stringify({id:'x'}));db.close();db=openArchive(dir);assert.equal(db.prepare('SELECT COUNT(*) AS n FROM events').get().n,1);db.close();}finally{fs.rmSync(dir,{recursive:true,force:true});}
});
