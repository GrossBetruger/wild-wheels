import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {tmpdir} from 'node:os';
import WebSocket from 'ws';
import {ArenaClient} from '../../gameplay/arena-core.js';
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const binary=resolve(arg('--binary','dedicated-server/target/release/wild-wheels-server')),output=arg('--output',`${tmpdir()}/wild-wheels-dedicated.json`),duration=Number(arg('--seconds','20'));
assert.ok(Number.isFinite(duration)&&duration>=5&&duration<=300);
const sleep=ms=>new Promise(r=>setTimeout(r,ms)),quantile=(a,p)=>[...a].sort((x,y)=>x-y)[Math.min(a.length-1,Math.floor(a.length*p))]??0;
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,child=spawn(binary,[],{cwd:tmpdir(),env:{...process.env,BIND:'127.0.0.1',PORT:String(port),BOTS:'0'},stdio:['ignore','pipe','pipe']});let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);const peers=[],errors=[];let timer,frameTimer;
const request=async(path,body,token,extra={})=>{const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{'content-type':'application/json',...(token?{authorization:`Bearer ${token}`}:{}) ,...extra},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,value:await response.text().then(text=>{try{return JSON.parse(text);}catch{return text;}}),headers:response.headers};};
const wait=async(predicate,message,ms=5000)=>{const end=performance.now()+ms;while(performance.now()<end){if(await predicate())return;await sleep(20);}throw new Error(message);};
async function connect(peer){
  peer.socket=new WebSocket(origin.replace('http','ws')+'/api/socket',{origin});peer.socket.on('error',e=>errors.push(e.message));
  peer.socket.on('message',(bytes,binary)=>{const now=performance.now();if(!binary){const pong=JSON.parse(bytes);if(pong.type==='pong')peer.rtts.push(now-pong.sent);return;}try{peer.client.accept(bytes,now/1000);peer.client.frame(0,peer.keys,now/1000);peer.client.peek();const state=peer.client.state();peer.state={you:state.you,host:state.host,epoch:state.world.soundEpoch,phase:state.world.phase,movement:state.movementSequence,action:state.actionSequence,players:state.players,wx:state.world.wx,wz:state.world.wz};if(peer.last)peer.intervals.push(now-peer.last);peer.last=now;peer.packets++;peer.bytes+=bytes.length;}catch(e){errors.push(e.message);}});
  await new Promise((r,j)=>{peer.socket.once('open',r);peer.socket.once('error',j);});peer.socket.send(JSON.stringify({type:'authenticate',token:peer.token}));await wait(()=>peer.state,'No initial snapshot');
}
try{
  await wait(async()=>{try{return(await request('/healthz')).status===200;}catch{return false;}},'Rust server failed to start');
  assert.equal((await request('/api/info')).value.maxPlayers,8);
  for(const asset of JSON.parse(await readFile(new URL('../../public-assets.json',import.meta.url))))assert.equal((await fetch(origin+(asset==='index.html'?'/':'/'+asset))).status,200,asset);
  for(const path of ['/.git/config','/server.js','/Cargo.lock','/rust-core/src/lib.rs'])assert.equal((await fetch(origin+path)).status,404,path);
  assert.equal((await request('/api/session',{})).status,401);
  assert.equal((await request('/api/join',{name:'Intruder',driver:null,code:'00'},null,{origin:'https://evil.invalid'})).status,403);
  assert.equal((await request('/api/join',{name:'x'.repeat(3000),driver:null,code:'00'})).status,413);
  for(let id=0;id<8;id++){const reply=await request('/api/join',{name:`Friend ${id}`,driver:null,code:'00'});assert.equal(reply.status,200);assert.equal(reply.value.you,id);assert.match(reply.headers.get('set-cookie'),/HttpOnly; SameSite=Lax/);const peer={token:reply.value.token,client:new ArenaClient(),keys:['w'],state:null,intervals:[],rtts:[],last:0,packets:0,bytes:0,sequence:0};peers.push(peer);await connect(peer);}
  assert.equal((await request('/api/join',{name:'Ninth',driver:null,code:'00'})).status,409);
  assert.ok(peers.every(p=>p.state.host===null));
  assert.equal((await request('/api/rooms',{},peers[0].token)).status,404);
  assert.equal((await request('/api/ready',{ready:true},peers[7].token)).status,404);
  assert.equal((await request('/api/control',{action:'refuse-start',requestId:1},peers[0].token)).status,400);
  assert.equal((await request('/api/control',{action:'reset'},peers[0].token)).status,400);
  assert.equal((await request('/api/control',{action:'special-abilities',enabled:false},peers[7].token)).status,200);
  assert.equal((await request('/api/control',{action:'special-abilities',enabled:true},peers[0].token)).status,200);
  assert.equal((await request('/api/control',{action:'start'},peers[7].token)).status,200);
  await wait(()=>peers.every(p=>p.state.phase==='countdown'),'Last player could not start the shared room');
  assert.equal((await request('/api/control',{action:'arena',arena:1},peers[0].token)).status,409);
  assert.equal((await request('/api/control',{action:'bots',bots:0},peers[7].token)).status,409);
  await wait(()=>peers.every(p=>p.state.phase==='racing'),'Countdown did not complete',4000);
  peers.forEach(p=>{p.intervals=[];p.packets=0;p.bytes=0;});let lastFrame=performance.now(),lastPing=0,lastAction=0;
  frameTimer=setInterval(()=>{const now=performance.now(),dt=Math.min(.05,(now-lastFrame)/1000);lastFrame=now;for(const p of peers){p.client.frame(dt,p.keys,now/1000);p.client.peek();}if(now-lastAction>900){lastAction=now;for(const p of peers)p.client.action('fire',null,now/1000);}},1000/60);
  timer=setInterval(()=>{const now=performance.now(),ping=now-lastPing>500;if(ping)lastPing=now;for(const p of peers){if(p.socket.readyState!==1)continue;p.socket.send(p.client.outboundText(p.keys));if(ping)p.socket.send(JSON.stringify({type:'ping',sent:now}));}},1000/30);
  await sleep(duration*1000);clearInterval(timer);clearInterval(frameTimer);timer=null;frameTimer=null;
  assert.deepEqual(errors,[]);for(const [id,p]of peers.entries()){assert.equal(p.socket.readyState,1);assert.equal(p.state.you,id);assert.ok(p.state.movement>duration*40,`Player ${id}: movement stopped`);assert.ok(p.state.action>=0,`Player ${id}: fire not acknowledged`);assert.ok(p.packets/duration>=25,`Player ${id}: snapshot rate ${p.packets/duration}`);assert.ok(quantile(p.intervals,.99)<100,`Player ${id}: snapshot stall`);}
  peers[0].socket.close();await wait(()=>peers[1].state.players.find(p=>p.id===0)?.afk,'Disconnected player did not become AFK');assert.ok(peers.every(p=>p.state.host===null));const epoch=peers[1].state.epoch;const old=peers[0].token;
  const refreshed=await request('/api/session',{},old);assert.equal(refreshed.status,200);assert.equal(refreshed.value.you,0);assert.equal(refreshed.value.world.name,'Friend 0');assert.equal(refreshed.value.world.soundEpoch,epoch);assert.ok(refreshed.value.movementSequence>0);peers[0].token=refreshed.value.token;peers[0].state=null;await connect(peers[0]);
  assert.equal((await request('/api/session',{},old)).status,401);
  const health=(await request('/healthz')).value;const report={pass:true,durationSeconds:duration,health,peers:peers.map((p,id)=>({id,packetsPerSecond:p.packets/duration,p99SnapshotGapMs:quantile(p.intervals,.99),p95RttMs:quantile(p.rtts,.95),bytesPerSecond:p.bytes/duration,movementAck:p.state.movement})),errors};await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(e){console.error(logs);throw e;}finally{clearInterval(timer);clearInterval(frameTimer);for(const p of peers)p.socket?.terminate();child.kill('SIGTERM');}
