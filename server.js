import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Multiplayer } from './server/multiplayer.js';
import { createTunnelControl } from './server/tunnel-control.js';
const files=new Map(JSON.parse(readFileSync(new URL('./public-assets.json',import.meta.url))).map(name=>[name==='index.html'?'/':'/'+name,[name,({'html':'text/html','css':'text/css','svg':'image/svg+xml','wasm':'application/wasm','ogg':'audio/ogg','flac':'audio/flac'})[name.split('.').at(-1)]??'text/javascript']]));
export function createGameServer(options={}){
const multiplayer=new Multiplayer(options);
const runtimeHash=createHash('sha256');for(const name of ['server.js','server/chat.js','server/security.js','server/multiplayer.js','server/photo-album.js','server/ngrok.js','server/tunnel-control.js','gameplay/combat.js','gameplay/arena-core.js','gameplay/core-view.js','rust-core.wasm','gameplay/engine.js','gameplay/track.js','package-lock.json'])runtimeHash.update(name).update(readFileSync(new URL(name,import.meta.url)));const runtimeBuild=runtimeHash.digest('hex');
let buildPromise;
const build=()=>buildPromise??=(async()=>{const hash=createHash('sha256').update(runtimeBuild);for(const name of [...new Set([...files.values()].map(file=>file[0]))])hash.update(name).update(await readFile(new URL(name,import.meta.url)));return hash.digest('hex').slice(0,10).toUpperCase();})().catch(error=>{buildPromise=undefined;throw error;});
const server=createServer(async (req, res) => {
  try{multiplayer.security.origin(req);}catch(error){res.writeHead(403,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));return;}
  res.setHeader('Referrer-Policy','no-referrer');
  if(multiplayer.security.secure(req))res.setHeader('Strict-Transport-Security','max-age=31536000');
  if((req.url??'').split('?')[0]==='/build.json'){
    try{
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      multiplayer.limit(req,'build',30);const fingerprint=await build();
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:JSON.stringify({build:fingerprint}));
    }catch(error){res.writeHead(error.status??500);res.end('Build information unavailable');}return;
  }
  if(await multiplayer.handle(req,res))return;
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end('Method not allowed');return;}
  const file = files.get((req.url || '/').split('?')[0]);
  if (!file) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(new URL(file[0], import.meta.url));
    const host=/^[a-zA-Z0-9.\[\]:-]+$/.test(req.headers.host??'')?req.headers.host:'localhost';
    const local=['localhost',`localhost:${multiplayer.port}`,'127.0.0.1',`127.0.0.1:${multiplayer.port}`].includes(host);
    const control=local&&multiplayer.controlPort?` http://127.0.0.1:${multiplayer.controlPort}`:'';
    res.writeHead(200, { 'Content-Type': file[1]==='application/wasm'?file[1]:file[1]+'; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; img-src 'self' data:; connect-src 'self' ${multiplayer.security.secure(req)?'wss':'ws'}://${host}${control}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` });
    res.end(req.method==='HEAD'?undefined:body);
  } catch { res.writeHead(500); res.end('Unable to load game'); }
});
multiplayer.attach(server);
server.maxConnections=256;server.headersTimeout=10000;server.requestTimeout=10000;server.on('listening',()=>{multiplayer.port=server.address().port;});server.on('close',()=>multiplayer.close());
return {server,multiplayer};
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const port=Number(process.env.PORT??5173);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535.');
  const {server,multiplayer}=createGameServer();let control;
  server.listen(port,process.env.BIND??'0.0.0.0',()=>{
    control=createTunnelControl(port);
    control.server.listen(0,'127.0.0.1',()=>{multiplayer.controlPort=control.server.address().port;});
    console.log(`Wild Wheels: http://localhost:${port} · LAN multiplayer enabled`);
  });
  server.on('close',()=>control?.close());
  process.on('exit',()=>control?.stop());
}
