import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Multiplayer } from './multiplayer.js';
import { createTunnelControl } from './tunnel-control.js';
const files = new Map([['/', ['index.html', 'text/html']], ['/style.css', ['style.css', 'text/css']], ...['game.js','engine.js','renderer.js','audio.js','track.js','combat.js','network.js','playback.js','prediction.js'].map(file=>['/'+file,[file,'text/javascript']])]);
export function createGameServer(){
const multiplayer=new Multiplayer();
const runtimeHash=createHash('sha256');for(const name of ['server.js','multiplayer.js','ngrok.js','tunnel-control.js','combat.js','engine.js','track.js','package-lock.json'])runtimeHash.update(name).update(readFileSync(new URL(name,import.meta.url)));const runtimeBuild=runtimeHash.digest('hex');
const server=createServer(async (req, res) => {
  if((req.url??'').split('?')[0]==='/build.json'){
    try{
      if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
      multiplayer.limit(req,'build',30);const hash=createHash('sha256').update(runtimeBuild);
      for(const name of [...new Set([...files.values()].map(file=>file[0]))])hash.update(name).update(await readFile(new URL(name,import.meta.url)));
      res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(req.method==='HEAD'?undefined:JSON.stringify({build:hash.digest('hex').slice(0,10).toUpperCase()}));
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
    res.writeHead(200, { 'Content-Type': file[1] + '; charset=utf-8', 'Cache-Control':'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' ws://${host} wss://${host}${control}; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` });
    res.end(req.method==='HEAD'?undefined:body);
  } catch { res.writeHead(500); res.end('Unable to load game'); }
});
multiplayer.attach(server);
server.headersTimeout=10000;server.requestTimeout=10000;server.on('listening',()=>{multiplayer.port=server.address().port;});server.on('close',()=>multiplayer.close());
return {server,multiplayer};
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){
  const port=Number(process.env.PORT??5173);if(!Number.isInteger(port)||port<1||port>65535)throw new Error('PORT must be between 1 and 65535.');
  const {server,multiplayer}=createGameServer();let control;
  server.listen(port,'0.0.0.0',()=>{
    control=createTunnelControl(port);
    control.server.listen(0,'127.0.0.1',()=>{multiplayer.controlPort=control.server.address().port;});
    console.log(`Wild Wheels: http://localhost:${port} · LAN multiplayer enabled`);
  });
  server.on('close',()=>control?.close());
  process.on('exit',()=>control?.stop());
}
