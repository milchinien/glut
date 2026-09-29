import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import {config} from './config.mjs';
import {readArchive,importBundle} from './archive.mjs';
import {getSettings,saveSettings} from './settings.mjs';

const port=Number(process.env.GLUT_PORT||4318),bind=process.env.GLUT_HOST||'127.0.0.1';
const password=process.env.GLUT_PASSWORD||'';
const siteOrigin=process.env.GLUT_ORIGIN||'https://miwale.com';
const sessionSecret=crypto.randomBytes(32),sessions=new Map(),pairCodes=new Map(),failures=new Map();
const tokenFile=path.join(config.dataDirectory,'device-tokens.json');
fs.mkdirSync(config.dataDirectory,{recursive:true});
let devices={};try{devices=JSON.parse(fs.readFileSync(tokenFile,'utf8'));}catch{}
let latest=readArchive();
const digest=x=>crypto.createHash('sha256').update(String(x)).digest('hex');
const equal=(a,b)=>{const aa=Buffer.from(digest(a)),bb=Buffer.from(digest(b));return crypto.timingSafeEqual(aa,bb);};
const random=()=>crypto.randomBytes(32).toString('base64url');
function json(res,status,obj,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(obj));}
function fail(res,status,message){json(res,status,{error:message});}
function harden(res){res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");}
async function body(req,max=100*1024*1024){const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>max)throw Object.assign(Error('Anfrage zu groß'),{status:413});chunks.push(c);}return Buffer.concat(chunks).toString('utf8');}
function originOkay(req){return !req.headers.origin||req.headers.origin===siteOrigin||req.headers.origin===`http://127.0.0.1:${port}`;}
function cookie(req){const all=req.headers.cookie||'',match=all.match(/(?:^|;\s*)glut_session=([^;]+)/);return match?.[1]||'';}
function isLoggedIn(req){const raw=cookie(req),s=sessions.get(digest(raw));return !!(raw&&s&&s>Date.now());}
function sessionCookie(raw,maxAge){return `glut_session=${raw}; HttpOnly; Secure; SameSite=Strict; Path=/usage; Max-Age=${maxAge}`;}
function saveDevices(){const tmp=tokenFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(devices),{mode:0o600});fs.renameSync(tmp,tokenFile);}
function ip(req){return String(req.headers['x-real-ip']||req.socket.remoteAddress||'unknown');}
function throttle(req){const key=ip(req),f=failures.get(key);return f?.until>Date.now();}
function failed(req){const key=ip(req),old=failures.get(key)||{count:0,until:0};old.count++;old.until=Date.now()+(old.count>=5?15*60_000:1000);failures.set(key,old);}
function staticFile(res,file,type){res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);}
const web=path.resolve('public');
const assets={'styles.css':'text/css; charset=utf-8','host.css':'text/css; charset=utf-8','app.js':'text/javascript; charset=utf-8','analytics.js':'text/javascript; charset=utf-8'};
const authorizedToken=req=>{const raw=(req.headers.authorization||'').match(/^Bearer ([A-Za-z0-9_-]{30,})$/)?.[1];if(!raw)return null;return devices[digest(raw)]||null;};

const server=http.createServer(async(req,res)=>{
  harden(res);
  try{
    const url=new URL(req.url,'http://localhost');
    if(url.pathname==='/usage/healthz'){json(res,200,{ok:true,configured:!!password});return;}
    if(url.pathname==='/usage/install.ps1'&&req.method==='GET'){staticFile(res,path.resolve('install.ps1'),'text/plain; charset=utf-8');return;}
    if(url.pathname==='/usage/login.css'&&req.method==='GET'){staticFile(res,path.join(web,'login.css'),'text/css; charset=utf-8');return;}
    if(url.pathname==='/usage/login.js'&&req.method==='GET'){staticFile(res,path.join(web,'login.js'),'text/javascript; charset=utf-8');return;}
    if(url.pathname==='/usage/api/pair/claim'&&req.method==='POST'){
      if(throttle(req)){fail(res,429,'Bitte später erneut versuchen');return;}
      const input=JSON.parse(await body(req,10_000)),code=String(input.code||'').toUpperCase(),pair=pairCodes.get(digest(code));
      if(!pair||pair.expires<Date.now()){failed(req);fail(res,401,'Code ungültig oder abgelaufen');return;}
      if(!/^[0-9a-f-]{30,40}$/i.test(input.deviceId||'')){fail(res,400,'Ungültiges Gerät');return;}
      failures.delete(ip(req));pairCodes.delete(digest(code));const token=random();devices[digest(token)]={id:input.deviceId,name:String(input.name||'Gerät').slice(0,80),createdAt:new Date().toISOString()};saveDevices();json(res,200,{token});return;
    }
    if(url.pathname==='/usage/api/ingest'&&req.method==='POST'){
      const device=authorizedToken(req);if(!device){fail(res,401,'Geräteschlüssel ungültig');return;}
      const bundle=JSON.parse(await body(req));
      if(bundle?.version!==2||!Array.isArray(bundle.events)||!Array.isArray(bundle.limits)||bundle.events.some(e=>e.device?.id!==device.id)||bundle.limits.some(e=>e.device?.id!==device.id)){fail(res,400,'Archiv passt nicht zum Gerät');return;}
      latest=importBundle(bundle);json(res,200,{ok:true,events:bundle.events.length,limits:bundle.limits.length,version:latest.generatedAt});return;
    }
    if(!password){fail(res,503,'Glut ist noch nicht eingerichtet');return;}
    if(url.pathname==='/usage/api/login'&&req.method==='POST'){
      if(!originOkay(req)){fail(res,403,'Ungültige Herkunft');return;}
      if(throttle(req)){fail(res,429,'Bitte später erneut versuchen');return;}
      const raw=await body(req,10_000),input=req.headers['content-type']?.includes('application/json')?JSON.parse(raw):Object.fromEntries(new URLSearchParams(raw));
      if(!equal(input.password||'',password)){failed(req);res.writeHead(303,{Location:'/usage/?error=1'}).end();return;}
      failures.delete(ip(req));const token=random();sessions.set(digest(token),Date.now()+30*86400_000);
      res.writeHead(303,{'Set-Cookie':sessionCookie(token,30*86400),Location:'/usage/','Cache-Control':'no-store'}).end();return;
    }
    if(!isLoggedIn(req)){
      if(url.pathname==='/usage/'&&req.method==='GET'){staticFile(res,path.join(web,'login.html'),'text/html; charset=utf-8');return;}
      fail(res,401,'Anmeldung erforderlich');return;
    }
    if(req.method!=='GET'&&!originOkay(req)){fail(res,403,'Ungültige Herkunft');return;}
    if(url.pathname==='/usage/api/logout'&&req.method==='POST'){sessions.delete(digest(cookie(req)));res.writeHead(303,{'Set-Cookie':sessionCookie('',0),Location:'/usage/'}).end();return;}
    if(url.pathname==='/usage/api/version'&&req.method==='GET'){json(res,200,{version:latest.generatedAt});return;}
    if(url.pathname==='/usage/api/stats'&&req.method==='GET'){json(res,200,latest);return;}
    if(url.pathname==='/usage/api/refresh'&&req.method==='POST'){latest=readArchive();json(res,200,latest);return;}
    if(url.pathname==='/usage/api/settings'&&req.method==='GET'){json(res,200,getSettings());return;}
    if(url.pathname==='/usage/api/settings'&&req.method==='PUT'){const input=JSON.parse(await body(req,20_000));json(res,200,saveSettings(input));return;}
    if(url.pathname==='/usage/api/export'&&req.method==='GET'){json(res,200,latest,{'Content-Disposition':'attachment; filename="glut-archiv.json"'});return;}
    if(url.pathname==='/usage/api/import'&&req.method==='POST'){latest=importBundle(JSON.parse(await body(req)));json(res,200,{ok:true,events:latest.events.length});return;}
    if(url.pathname==='/usage/api/pair/start'&&req.method==='POST'){
      const code=crypto.randomBytes(8).toString('hex').toUpperCase();pairCodes.set(digest(code),{expires:Date.now()+10*60_000});json(res,200,{code,expiresInMinutes:10});return;
    }
    if(url.pathname==='/usage/'&&req.method==='GET'){staticFile(res,path.join(web,'index.html'),'text/html; charset=utf-8');return;}
    const asset=url.pathname.slice('/usage/'.length);if(req.method==='GET'&&assets[asset]&&url.pathname.startsWith('/usage/')){staticFile(res,path.join(web,asset),assets[asset]);return;}
    fail(res,404,'Nicht gefunden');
  }catch(error){fail(res,error.status||500,error.status?error.message:'Interner Fehler');console.error(error);}
});
server.listen(port,bind,()=>console.log(`Glut host auf ${bind}:${port}`));
