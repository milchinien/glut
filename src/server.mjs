import childProcess from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { config } from "./config.mjs";
import { refreshArchive, readArchive, importBundle } from "./archive.mjs";
import { getSettings, saveSettings } from "./settings.mjs";

const publicDirectory = path.resolve("public");
const statsPath = path.join(config.dataDirectory, "dashboard.json");
let importing = null;

function contentType(file) {
  return (
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
    }[path.extname(file)] || "application/octet-stream"
  );
}

async function refresh() {
  if (!importing) importing = refreshArchive().finally(() => (importing = null));
  return importing;
}

let latest = readArchive();
refresh().then(data => latest=data).catch(console.error);
setInterval(()=>refresh().then(data=>latest=data).catch(console.error),60000).unref();

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (!['127.0.0.1','localhost'].includes(url.hostname)) { response.writeHead(403).end(); return; }
    if (request.headers.origin && ![`http://127.0.0.1:${config.port}`,`http://localhost:${config.port}`].includes(request.headers.origin)) { response.writeHead(403).end(); return; }
    if (url.pathname === "/api/stats") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({...latest,importing:!!importing}));
      return;
    }
    if(url.pathname==='/api/export') {
      response.writeHead(200,{'Content-Type':'application/json','Content-Disposition':'attachment; filename="ai-geraet.json"'});
      response.end(JSON.stringify(latest));return;
    }
    if(url.pathname==='/api/import' && request.method==='POST') {
      let size=0;const chunks=[];for await(const chunk of request){size+=chunk.length;if(size>100*1024*1024)throw Error('Archiv zu groß (max. 100 MB)');chunks.push(chunk);}
      latest=importBundle(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({ok:true,events:latest.events.length}));return;
    }
    if (url.pathname === "/api/settings" && request.method === "GET") {
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify(getSettings()));
      return;
    }
    if (url.pathname === "/api/settings" && request.method === "PUT") {
      let body = "";
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 20_000) throw new Error("Einstellungen sind zu groß.");
      }
      const settings = saveSettings(JSON.parse(body || "{}"));
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(settings));
      return;
    }
    if (url.pathname === "/api/refresh" && request.method === "POST") {
      const stats = await refresh();
      latest=stats;
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(stats));
      return;
    }
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.resolve(publicDirectory, requested);
    if (!file.startsWith(publicDirectory+path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end("Nicht gefunden");
      return;
    }
    response.writeHead(200, { "Content-Type": contentType(file) });
    fs.createReadStream(file).pipe(response);
  } catch (error) {
    response.writeHead(500, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ error: error.message }));
  }
});

server.listen(config.port, "127.0.0.1", () => {
  const url = `http://127.0.0.1:${config.port}`;
  console.log(`AI-Statistiken laufen lokal auf ${url}`);
  if (process.platform === "win32" && !process.argv.includes("--no-open")) {
    childProcess.spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
  }
});
