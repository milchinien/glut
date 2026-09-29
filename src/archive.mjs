import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.mjs';
import { getSettings } from './settings.mjs';
import { estimateCost, PRICE_UPDATED_AT } from './pricing.mjs';

const format = new Intl.DateTimeFormat('en-CA', { timeZone: config.timeZone, year:'numeric',month:'2-digit',day:'2-digit' });
export function dayFor(t) { const d = new Date(t); if (!Number.isFinite(+d)) return ''; const p=Object.fromEntries(format.formatToParts(d).map(x=>[x.type,x.value])); return `${p.year}-${p.month}-${p.day}`; }
const hash = x=>crypto.createHash('sha256').update(String(x)).digest('hex').slice(0,24);
const num = x=>Number.isFinite(Number(x)) ? Math.max(0,Number(x)) : 0;
export function normalizeUsage(provider,u={}) {
  let input=num(u.input_tokens), cached=num(u.cached_input_tokens ?? u.cache_read_input_tokens), output=num(u.output_tokens);
  let write=num(u.cache_write_input_tokens ?? u.cache_creation_input_tokens), hour=num(u.cache_creation?.ephemeral_1h_input_tokens);
  if(provider==='claude' && Array.isArray(u.iterations) && u.iterations.length) {
    const iterations=u.iterations.map(x=>x.usage || x);
    if(iterations.some(x=>x.input_tokens!=null)) {
      const sum=k=>iterations.reduce((a,x)=>a+num(x[k]),0);
      input=sum('input_tokens'); cached=sum('cache_read_input_tokens'); output=sum('output_tokens'); write=sum('cache_creation_input_tokens');
      hour=iterations.reduce((a,x)=>a+num(x.cache_creation?.ephemeral_1h_input_tokens),0);
      // Some iterations omit cache duration details; keep the top-level split when totals agree.
      if(!hour && write===num(u.cache_creation_input_tokens)) hour=num(u.cache_creation?.ephemeral_1h_input_tokens);
    }
  }
  hour=Math.min(hour,write);
  const uncached=provider==='codex' ? Math.max(0,input-cached-write) : input;
  return {input:uncached,cached,cacheWrite:write-hour,cacheWriteOneHour:hour,output,tokens:uncached+cached+write+output};
}
function value(provider,model,u) {
  const n=normalizeUsage(provider,u);
  const price=estimateCost(provider,model,{...n,input:provider==='codex'?n.input+n.cached+n.cacheWrite:n.input});
  return {...n,cost:price.cost,savings:price.savings,unpriced:price.priced?0:n.tokens};
}
const roots=new Map();
export function projectRoot(cwd) {
  if(!cwd) return 'Unbekannt';
  const original=cwd.replaceAll('\\','/').replace(/\/$/,'');
  if(roots.has(original))return roots.get(original);
  let current=original;
  for(let i=0;i<12;i++) {
    if(fs.existsSync(path.join(current,'.git'))) { roots.set(original,current);return current; }
    const parent=path.dirname(current);if(parent===current || parent==='.')break;current=parent;
  }
  // The local workspace convention groups all nested working directories under one project.
  const local=original.match(/^(.*\/src\/[^/]+\/[^/]+)/i);
  const result=local?.[1] || original;
  roots.set(original,result);return result;
}
export async function parseFile(file,provider) {
  const sub=provider==='claude' && /[\\/]subagents[\\/]/.test(file);
  const parent=sub?file.split(/[\\/]subagents[\\/]/)[0].split(/[\\/]/).at(-1):null;
  let session=parent || path.basename(file,'.jsonl'), project=null, model='unbekannt', account='local', isSub=sub;
  const events=new Map(), limits=[], fallbacks=[], prompts=[], ignoredPrompts=[];
  let lineNo=0, malformed=0, duplicates=0, counters=null, explicit=false, firstAt='';
  const add=(id,e)=>{
    if(!e.at || !dayFor(e.at))return;
    const old=events.get(id);
    if(old){duplicates++;if((e.tokens||0)<(old.tokens||0))return;}
    events.set(id,{...e,id,provider,session,project,model:e.model||model,account});
  };
  const stream=readline.createInterface({input:fs.createReadStream(file),crlfDelay:Infinity});
  for await (const line of stream) {
    lineNo++;if(!line.trim())continue;
    let r;try{r=JSON.parse(line);}catch{malformed++;continue;}
    const p=r.payload||{}, at=r.timestamp;
    if(at && dayFor(at) && (!firstAt || at<firstAt)) firstAt=at;
    if(provider==='codex') {
      if(r.type==='session_meta') {
        session=p.parent_thread_id||p.session_id||p.id||session;project=projectRoot(p.cwd);
        account=hash(p.creator_account_id||p.creator_user_id||'local');
        isSub=isSub||!!(p.source?.subagent)||p.thread_source==='subagent'||!!p.parent_thread_id;
      }
      if(r.type==='turn_context')model=p.model||model;
      if(r.type==='response_item' && p.type==='message' && p.role==='user') {
        const text=Array.isArray(p.content)?p.content.map(x=>x.text||'').join('\n'):'';
        ignoredPrompts.push({id:`prompt:${p.id||hash(session+':'+lineNo)}`,at});
        if(!isSub && !/^\s*(<environment_context>|<INSTRUCTIONS>|# AGENTS\.md)/.test(text))
          prompts.push({id:`prompt:${p.id||hash(session+':'+lineNo)}`,at,kind:'prompt',model, prompts:1});
      }
      if(r.type==='event_msg' && p.type==='user_message' && !isSub) {
        prompts.push({id:`user:${p.id||hash(session+':'+lineNo)}`,at,kind:'user',model,prompts:1});
      }
      if(r.type==='event_msg' && p.type==='user_message')ignoredPrompts.push({id:`user:${p.id||hash(session+':'+lineNo)}`,at});
      if(r.type==='token_usage_record') {
        explicit=true;
        add(`usage:${p.response_id||hash(session+':'+lineNo)}`,{at,kind:'usage',...value(provider,model,p.usage),model});
      }
      if(r.type==='event_msg' && p.type==='token_count') {
        const total=p.info?.total_token_usage;
        if(total) {
          const delta={};for(const k of Object.keys(total))delta[k]=Math.max(0,num(total[k])-num(counters?.[k]));
          if(counters && num(total.total_tokens)<num(counters.total_tokens))Object.assign(delta,p.info.last_token_usage||total);
          counters=total;fallbacks.push({id:`legacy:${hash(session+':'+lineNo)}`,at,kind:'usage',model,...value(provider,model,delta)});
        }
        if(p.rate_limits)for(const slot of ['primary','secondary']) {
          const w=p.rate_limits[slot];if(w?.resets_at && Number.isFinite(w.used_percent))
            limits.push({at,provider,account,limitId:p.rate_limits.limit_id||'codex',slot,minutes:w.window_minutes,reset:w.resets_at,percent:w.used_percent});
        }
      }
    } else {
      if(!sub && r.sessionId)session=r.sessionId;
      if(!project && r.cwd)project=projectRoot(r.cwd);
      if(r.type==='user' && !sub && !r.isSidechain && !r.isMeta && !r.toolUseResult) {
        const content=r.message?.content;
        const text=typeof content==='string'?content:Array.isArray(content)?content.filter(x=>x.type==='text').map(x=>x.text||'').join(''):'';
        const hasTool=Array.isArray(content)&&content.some(x=>x.type==='tool_result');
        if(text && !hasTool && !/^\s*(<local-command|<command-name>|This session is being continued)/.test(text))
          add(`prompt:${r.promptId||r.uuid||hash(session+':'+lineNo)}`,{at,kind:'prompt',model:'unbekannt',prompts:1});
      }
      if(r.type==='assistant' && r.message?.usage && r.message.model!=='<synthetic>') {
        model=r.message.model||'unbekannt';
        add(`usage:${r.message.id||r.requestId||r.uuid||hash(session+':'+lineNo)}`,{at,kind:'usage',model,...value(provider,model,r.message.usage)});
      }
    }
  }
  if(provider==='codex') {
    const human=prompts.some(x=>x.kind==='user')?prompts.filter(x=>x.kind==='user'):prompts;
    for(const e of human)add(e.id,e);
    if(!explicit)for(const e of fallbacks)add(e.id,e);
  }
  if(!isSub) add(`session:${session}`,{at:firstAt||fs.statSync(file).mtime.toISOString(),kind:'session',model:'unbekannt'});
  // Resolve human prompts to the next model call in their own session.
  const ordered=[...events.values()].sort((a,b)=>a.at.localeCompare(b.at));
  let next='unbekannt';for(let i=ordered.length-1;i>=0;i--){const e=ordered[i];if(e.kind==='usage')next=e.model;else if(e.model==='unbekannt')e.model=next;}
  for(const e of ordered){e.project=project||'Unbekannt';e.session=session;e.day=dayFor(e.at);e.subagent=isSub;}
  return {events:ordered,limits,malformed,duplicates,lines:lineNo,ignoredPrompts:isSub?ignoredPrompts:[]};
}
export function openArchive(directory=config.dataDirectory) {
  fs.mkdirSync(directory,{recursive:true});
  const db=new DatabaseSync(path.join(directory,'usage.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, signature TEXT, report TEXT);
    CREATE TABLE IF NOT EXISTS events(id TEXT PRIMARY KEY, json TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS limits(id TEXT PRIMARY KEY, json TEXT NOT NULL);`);
  return db;
}
function files(root){if(!fs.existsSync(root))return [];return fs.readdirSync(root,{withFileTypes:true}).flatMap(x=>x.isDirectory()?files(path.join(root,x.name)):x.name.endsWith('.jsonl')?[path.join(root,x.name)]:[]);}
let running;
export function refreshArchive(){if(!running)running=importAll().finally(()=>running=null);return running;}
async function importAll(){
  const db=openArchive(), settings=getSettings(), device={...settings.device,user:os.userInfo().username};
  const lookup=db.prepare('SELECT signature FROM files WHERE path=?');
  const eventInsert=db.prepare('INSERT INTO events VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json');
  const limitInsert=db.prepare('INSERT OR REPLACE INTO limits VALUES(?,?)');
  const fileInsert=db.prepare('INSERT OR REPLACE INTO files VALUES(?,?,?)');
  const removeSubPrompt=db.prepare("DELETE FROM events WHERE id=? AND json_extract(json,'$.at')=? AND json_extract(json,'$.kind') IN ('prompt','user')");
  let changed=0;
  try {
    for(const [provider,root]of [['codex',config.codexSessions],['codex',path.join(path.dirname(config.codexSessions),'archived_sessions')],['claude',config.claudeProjects]]) {
      for(const file of files(root)) {
        const stat=fs.statSync(file), sig=`v5:${stat.size}:${stat.mtimeMs}`;
        if(lookup.get(file)?.signature===sig)continue;
        const result=await parseFile(file,provider);
        db.exec('BEGIN');
        try{
          for(const e of result.events)eventInsert.run(provider+':'+e.id,JSON.stringify({...e,device}));
          for(const e of result.ignoredPrompts)removeSubPrompt.run(provider+':'+e.id,e.at);
          for(const l of result.limits)limitInsert.run(hash(JSON.stringify(l)),JSON.stringify({...l,device}));
          fileInsert.run(file,sig,JSON.stringify({lines:result.lines,malformed:result.malformed,duplicates:result.duplicates}));
          db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        changed++;
        if(changed%30===0)console.log(`Archiv: ${changed} Dateien geprüft`);
      }
    }
    return snapshot(db,settings);
  }finally{db.close();}
}
export function snapshot(db,settings=getSettings()) {
  const events=db.prepare('SELECT json FROM events').all().map(x=>JSON.parse(x.json));
  for(const e of events)if(e.device.id===settings.device.id)e.device.name=settings.device.name;
  const limits=db.prepare('SELECT json FROM limits').all().map(x=>JSON.parse(x.json)).sort((a,b)=>a.at.localeCompare(b.at));
  const reports=db.prepare('SELECT report FROM files').all().map(x=>JSON.parse(x.report));
  return {version:2,generatedAt:new Date().toISOString(),timeZone:config.timeZone,priceUpdatedAt:PRICE_UPDATED_AT,events,limits,
    audit:{files:reports.length,malformed:reports.reduce((a,x)=>a+x.malformed,0),duplicateBlocks:reports.reduce((a,x)=>a+x.duplicates,0),
      events:events.length,unpricedTokens:events.reduce((a,x)=>a+(x.unpriced||0),0),
      tokenIdentity:events.every(x=>x.kind!=='usage'||x.tokens===x.input+x.cached+x.cacheWrite+x.cacheWriteOneHour+x.output)},
    notes:['API-Gegenwert mit hinterlegten Standardpreisen vom '+PRICE_UPDATED_AT+'. Keine historische Rechnung; Toolgebühren und Sondertarife sind nicht enthalten.',
      'Gerät bezeichnet die Herkunft des Imports. Bei früher kopierten Verläufen ist das ursprüngliche Gerät nicht nachweisbar.',
      'Limit-Prozente sind Kontobeobachtungen. Ein Geräteanteil am Tokenverbrauch ist kein gemessener Anteil am Anbieterlimit.']};
}
export function readArchive(){const db=openArchive();try{return snapshot(db);}finally{db.close();}}
export function importBundle(bundle){
  if(bundle?.version!==2||!Array.isArray(bundle.events)||!Array.isArray(bundle.limits)||bundle.events.length>500000)throw Error('Ungültiges Gerätearchiv');
  const validText=x=>typeof x==='string'&&x.length<2048;
  const clean=[];
  for(const e of bundle.events){
    if(!['codex','claude'].includes(e.provider)||!validText(e.id)||!validText(e.session)||!validText(e.device?.id)||!validText(e.device?.name)||!validText(e.at)||!dayFor(e.at))throw Error('Ungültiger Datensatz');
    const row={};for(const k of ['id','provider','session','project','model','account','at','kind'])row[k]=validText(e[k])?e[k]:'';
    row.device={id:e.device.id,name:e.device.name,user:validText(e.device.user)?e.device.user:''};row.day=dayFor(e.at);row.subagent=!!e.subagent;
    for(const k of ['input','cached','cacheWrite','cacheWriteOneHour','output','prompts'])row[k]=num(e[k]);
    row.tokens=row.input+row.cached+row.cacheWrite+row.cacheWriteOneHour+row.output;
    const p=estimateCost(row.provider,row.model,{...row,input:row.provider==='codex'?row.input+row.cached+row.cacheWrite:row.input});
    row.cost=p.cost;row.savings=p.savings;row.unpriced=p.priced?0:row.tokens;clean.push(row);
  }
  const db=openArchive();try{db.exec('BEGIN');const put=db.prepare("INSERT INTO events VALUES(?,?) ON CONFLICT(id) DO UPDATE SET json=excluded.json WHERE json_extract(events.json,'$.device.id')=json_extract(excluded.json,'$.device.id')");for(const e of clean)put.run(e.provider+':'+e.id,JSON.stringify(e));
    const putLimit=db.prepare('INSERT OR IGNORE INTO limits VALUES(?,?)');
    for(const l of bundle.limits)if(l.provider==='codex'&&validText(l.at)&&validText(l.device?.id)&&Number.isFinite(l.percent)&&l.percent>=0&&l.percent<=100&&Number.isFinite(l.reset)&&Number.isFinite(l.minutes)){
      const row={provider:l.provider,at:l.at,account:String(l.account||''),limitId:String(l.limitId||''),slot:String(l.slot||''),percent:l.percent,reset:l.reset,minutes:l.minutes,device:{id:l.device.id,name:String(l.device.name||'Gerät')}};
      putLimit.run(hash(JSON.stringify(row)),JSON.stringify(row));
    }db.exec('COMMIT');return snapshot(db);
  }catch(e){db.exec('ROLLBACK');throw e;}finally{db.close();}
}
if(process.argv[1] && path.resolve(process.argv[1])===path.resolve('src/archive.mjs')) {
  const data=await refreshArchive();
  if(process.argv.includes('--export')){const target=path.join(config.dataDirectory,`geraet-${os.hostname()}.json`);fs.writeFileSync(target,JSON.stringify(data));console.log(target);}
  console.log(JSON.stringify(data.audit));
}
