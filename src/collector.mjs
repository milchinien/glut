import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {config} from './config.mjs';
import {getSettings} from './settings.mjs';
import {refreshArchive} from './archive.mjs';

const endpoint=(process.env.GLUT_SERVER_URL||'https://miwale.com').replace(/\/$/,'');
const stateFile=path.join(config.dataDirectory,'sync-state.json');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function readState(){try{return JSON.parse(fs.readFileSync(stateFile,'utf8'));}catch{return {events:{},limits:{}};}}
function saveState(state){fs.mkdirSync(config.dataDirectory,{recursive:true});const temp=stateFile+'.tmp';fs.writeFileSync(temp,JSON.stringify(state),{mode:0o600});fs.renameSync(temp,stateFile);}
async function post(route,value,token){const response=await fetch(endpoint+'/usage/api/'+route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(value),signal:AbortSignal.timeout(120000)});const data=await response.json();if(!response.ok)throw Error(data.error||`HTTP ${response.status}`);return data;}
export async function pair(code){const settings=getSettings(),data=await post('pair/claim',{code,deviceId:settings.device.id,name:settings.device.name});const state=readState();state.token=data.token;state.server=endpoint;state.events={};state.limits={};saveState(state);console.log(`Gerät ${settings.device.name} verbunden.`);}
export async function sync(){const state=readState();if(!state.token)throw Error('Gerät noch nicht verbunden. Pairing-Code im Dashboard erzeugen und --pair CODE ausführen.');
  const snapshot=await refreshArchive(),batchSize=1000;
  const changedEvents=snapshot.events.map(row=>({row,key:row.provider+':'+row.id,hash:hash(JSON.stringify(row))})).filter(x=>state.events[x.key]!==x.hash);
  const changedLimits=snapshot.limits.map(row=>({row,key:hash(JSON.stringify(row))})).filter(x=>!state.limits[x.key]);
  let sent=0;
  for(let i=0;i<Math.max(changedEvents.length,changedLimits.length);i+=batchSize){const events=changedEvents.slice(i,i+batchSize),limits=changedLimits.slice(i,i+batchSize);
    await post('ingest',{version:2,events:events.map(x=>x.row),limits:limits.map(x=>x.row)},state.token);
    for(const x of events)state.events[x.key]=x.hash;for(const x of limits)state.limits[x.key]=true;saveState(state);sent+=events.length;
  }
  console.log(`${snapshot.audit.files} Dateien geprüft, ${sent} Ereignisse und ${changedLimits.length} Limitbeobachtungen übertragen.`);
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve('src/collector.mjs')){
  try{const i=process.argv.indexOf('--pair');if(i>=0){if(!process.argv[i+1])throw Error('Pairing-Code fehlt');await pair(process.argv[i+1]);}await sync();}catch(e){console.error(e.message);process.exitCode=1;}
}
