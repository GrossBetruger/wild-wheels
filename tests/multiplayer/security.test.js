import test from 'node:test';
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {once} from 'node:events';
import WebSocket from 'ws';
import {createGameServer} from '../../server.js';
import {RequestSecurity} from '../../server/security.js';
import {invitationUrl} from '../../networking/network.js';

async function setup(t,options={}){
  const app=createGameServer(options);clearInterval(app.multiplayer.timer);
  await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{app.multiplayer.close();app.server.closeAllConnections();app.server.close();});
  const origin=`http://127.0.0.1:${app.server.address().port}`;
  const post=async(path,body={},token,headers={})=>{
    if(headers.Host){return new Promise((resolve,reject)=>{const req=request(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} :{}),...headers}},res=>{let data='';res.on('data',part=>data+=part);res.on('end',()=>resolve({status:res.statusCode,headers:new Headers(Object.entries(res.headers).flatMap(([key,value])=>Array.isArray(value)?value.map(v=>[key,v]):[[key,value]])),...JSON.parse(data)}));});req.on('error',reject);req.end(JSON.stringify(body));});}
    const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} :{}),...headers},body:JSON.stringify(body),signal:AbortSignal.timeout(4000)});
    return {status:response.status,headers:response.headers,...await response.json()};
  };
  return {...app,origin,post};
}
const joinBody=(code,name='Guest')=>({name,driver:null,code});

test('CSRF rejects hostile, sibling, wrong-scheme and missing origins for cookie authentication',async t=>{
  const {post,origin}=await setup(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});
  const cookie=host.headers.get('set-cookie').split(';')[0];
  for(const headers of [
    {Origin:'https://attacker.invalid'}, {Origin:origin.replace('http:','https:')},
    {Origin:origin,'Sec-Fetch-Site':'cross-site'}, {Origin:origin,'Sec-Fetch-Site':'same-site'}, {},
  ])assert.equal((await post('/api/name',{name:'Hacked'},undefined,{Cookie:cookie,...headers})).status,403);
  assert.equal((await post('/api/name',{name:'Safe'},undefined,{Cookie:cookie,Origin:origin})).status,200);
  assert.equal((await post('/api/name',{name:'Safe'},undefined,{Cookie:cookie,'Sec-Fetch-Site':'same-origin'})).status,200);
  const form=await fetch(origin+'/api/chat',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'text/plain'},body:'{"text":"CSRF"}'});
  assert.equal(form.status,415);
});

test('public transport requires exact origin and explicitly trusted loopback proxy; forwarded headers alone grant nothing',()=>{
  const request=(headers={},remoteAddress='127.0.0.1')=>({headers:{host:'game.example',...headers},socket:{remoteAddress}});
  const security=new RequestSecurity({publicOrigin:'https://game.example',trustProxy:true});
  assert.throws(()=>security.check(request({origin:'https://game.example'})),{status:403});
  assert.equal(security.check(request({origin:'https://game.example','x-forwarded-proto':'https'})),'https://game.example');
  for(const origin of ['http://game.example','https://game.example.attacker.invalid','null','https://game.example/'])assert.throws(()=>security.check(request({origin,'x-forwarded-proto':'https'})),{status:403});
  assert.throws(()=>security.check(request({origin:'https://game.example','x-forwarded-proto':'https'},'203.0.113.7')),{status:403});
  assert.throws(()=>new RequestSecurity({publicOrigin:'http://game.example'}));
  assert.throws(()=>new RequestSecurity().origin(request()));
});

test('IDOR: forged sender, room, delete and reply IDs cannot disclose or modify private messages',async t=>{
  const {post}=await setup(t);
  const alice=await post('/api/rooms',{name:'Alice',driver:0,arena:0,bots:0});
  const bob=await post('/api/join',joinBody(alice.code,'Bob'));
  const eve=await post('/api/join',joinBody(alice.code,'Eve'));
  const sent=await post('/api/chat',{text:'Private secret',to:bob.you,from:eve.you,sender:eve.token},alice.token);
  const id=sent.messages[0].id;
  assert.equal(sent.messages[0].from,alice.you);
  assert.deepEqual((await post('/api/chat',{you:alice.you,room:alice.code,token:alice.token},eve.token)).messages,[]);
  for(const deleteId of [id,999999])assert.equal((await post('/api/chat',{deleteId},eve.token)).status,404);
  assert.equal((await post('/api/chat',{text:'Leak',to:alice.you,replyTo:id},eve.token)).status,400);
  assert.equal((await post('/api/chat',{text:'Leak to Everyone',replyTo:id},bob.token)).status,400);
  assert.equal((await post('/api/chat',{},bob.token)).messages[0].text,'Private secret');
  assert.equal((await post('/api/name',{id:alice.you,name:'Impersonated'},eve.token)).status,200);
  assert.equal((await post('/api/chat',{},alice.token)).players.find(p=>p.id===alice.you).name,'Alice');
  assert.equal((await post('/api/chat',{},'a'.repeat(64))).status,401);
});

test('SQL, HTML and prototype-looking input remain data and cannot forge authentication',async t=>{
  const {post,multiplayer}=await setup(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0,bots:0});
  const payloads=["' OR 1=1; DROP TABLE messages; --",'<script>globalThis.__chatXss=1</script>','<img src=x onerror="globalThis.__chatXss=1">','{"__proto__":{"isAdmin":true}}'];
  for(const text of payloads){
    const chat=multiplayer.rooms.get(host.code).chat;if(chat)chat.sent.clear();
    const response=await post('/api/chat',{text},host.token);
    assert.equal(response.status,200);assert.equal(response.messages.at(-1).text,text);
    assert.equal(response.headers.get('content-type'),'application/json; charset=utf-8');
  }
  assert.equal(({}).isAdmin,undefined);
  assert.equal((await post('/api/chat',{},"' OR 1=1 --")).status,401);
  const next=await post('/api/join',joinBody(host.code));assert.equal(next.status,200);
});

test('DoS limits reject oversized bodies and chat floods while leaving a valid session usable',async t=>{
  const {post,multiplayer}=await setup(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});
  assert.equal((await post('/api/chat',{text:'x'.repeat(3000)},host.token)).status,413);
  assert.equal((await post('/api/chat',{text:'x'.repeat(501)},host.token)).status,400);
  assert.equal((await post('/api/chat',{text:'First'},host.token)).status,200);
  assert.equal((await post('/api/chat',{text:'Flood'},host.token)).status,429);
  for(let n=0;n<20;n++)await post('/api/chat',{},host.token);
  assert.equal((await post('/api/chat',{},host.token)).status,429);
  assert.equal((await post('/api/name',{name:'Still alive'},host.token)).status,200);
  multiplayer.limits.clear();
  for(let n=0;n<4096;n++)multiplayer.limits.set(`attacker-${n}`,{since:Date.now(),count:1});
  assert.equal((await post('/api/chat',{},host.token)).status,429);
  assert.equal(multiplayer.limits.size,4096);
});

test('abandoned slots expire and only the host can reclaim a live occupied slot',async t=>{
  const {post,multiplayer}=await setup(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});
  const guest=await post('/api/join',joinBody(host.code));
  assert.equal((await post('/api/kick',{id:host.you},guest.token)).status,403);
  assert.equal((await post('/api/kick',{id:guest.you},host.token)).status,200);
  assert.equal((await post('/api/chat',{},guest.token)).status,401);
  const newcomer=await post('/api/join',joinBody(host.code));
  multiplayer.members.get(newcomer.token).lastSeen=Date.now()-900001;
  multiplayer.step(1/60);
  assert.equal(multiplayer.members.has(newcomer.token),false);
  assert.equal(multiplayer.members.has(host.token),true);
  assert.equal((await post('/api/join',joinBody(host.code,'Replacement'))).status,200);
});

async function openSocket(t,origin,options={}){
  const socket=new WebSocket(origin.replace('http:','ws:')+'/api/socket',options);
  socket.on('error',()=>{});t.after(()=>socket.terminate());
  return socket;
}
async function closed(socket){return Promise.race([new Promise(resolve=>socket.once('close',resolve)),new Promise((_,reject)=>{const timer=setTimeout(()=>reject(new Error('Socket was not closed')),4500);timer.unref();})]);}

test('WebSocket hijacking: foreign, absent and wrong-scheme origins cannot connect',async t=>{
  const {origin}=await setup(t);
  for(const headers of [{},{Origin:'https://attacker.invalid'},{Origin:origin.replace('http:','https:')}]){
    const socket=await openSocket(t,origin,{headers});let opened=false;socket.on('open',()=>{opened=true;});await closed(socket);assert.equal(opened,false);
  }
});

test('WebSocket cookies do not authenticate; unauthenticated, oversized and flooded connections close',async t=>{
  const {origin,post}=await setup(t);
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0});
  const socket=await openSocket(t,origin,{origin,headers:{Cookie:host.headers.get('set-cookie').split(';')[0]}});
  await once(socket,'open');const ended=closed(socket);socket.send(JSON.stringify({type:'input',sequence:0,keys:[],actions:[]}));assert.equal(await ended,1008);
  const oversized=await openSocket(t,origin,{origin});await once(oversized,'open');const tooLarge=closed(oversized);oversized.send('x'.repeat(2049));assert.equal(await tooLarge,1009);
  const flood=await openSocket(t,origin,{origin});await once(flood,'open');const first=once(flood,'message');flood.send(JSON.stringify({type:'authenticate',token:host.token}));await first;
  const flooded=closed(flood);for(let n=0;n<101;n++)flood.send(JSON.stringify({type:'ping',sent:n}));assert.equal(await flooded,1008);
  const idle=await openSocket(t,origin,{origin});await once(idle,'open');assert.equal(await closed(idle),1008);
});

test('public invitations require a secret; HTTPS adds secure cookies and transport headers',async t=>{
  const {post,origin,server,multiplayer}=await setup(t,{publicOrigin:'https://game.example',trustProxy:true});
  const headers={Host:'game.example','X-Forwarded-Proto':'https',Origin:'https://game.example'};
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0},undefined,headers);
  assert.equal(host.status,200);assert.match(host.invite,/^[a-f0-9]{64}$/);
  assert.match(host.headers.get('set-cookie'),/HttpOnly; SameSite=Lax.*; Secure/);
  assert.equal(host.headers.get('strict-transport-security'),'max-age=31536000');
  assert.equal((await post('/api/join',joinBody(host.code),undefined,headers)).status,403);
  assert.equal((await post('/api/join',{...joinBody(host.code),invite:host.invite},undefined,headers)).status,200);
  const url=new URL(invitationUrl(origin,host.code,{publicOrigin:'https://game.example',invite:host.invite}));
  assert.equal(url.searchParams.has('invite'),false);assert.equal(new URLSearchParams(url.hash.slice(1)).get('invite'),host.invite);
  assert.equal((await post('/api/chat',{},host.token,{Host:'game.example',Origin:'https://game.example'})).status,403);
  const ws=await openSocket(t,origin,{headers});await once(ws,'open');const initial=once(ws,'message');ws.send(JSON.stringify({type:'authenticate',token:host.token}));assert.equal((await initial)[1],true);
  assert.equal(multiplayer.rooms.size,1);assert.ok(server.listening);
});

test('only the tunnel discovered from the local ngrok agent is accepted as an automatic HTTPS proxy',()=>{
  const security=new RequestSecurity({trustProxy:false});security.tunnelOrigin='https://trusted.ngrok.app';
  const req={headers:{host:'trusted.ngrok.app',origin:'https://trusted.ngrok.app','x-forwarded-proto':'https'},socket:{remoteAddress:'127.0.0.1'}};
  assert.equal(security.check(req),'https://trusted.ngrok.app');
  assert.throws(()=>security.check({...req,headers:{...req.headers,host:'evil.ngrok.app',origin:'https://evil.ngrok.app'}}),{status:403});
  assert.throws(()=>security.check({...req,socket:{remoteAddress:'203.0.113.7'}}),{status:403});
  security.tunnelOrigin=null;assert.throws(()=>security.check(req),{status:403});
});

test('WebSocket connection exhaustion is bounded per peer before authentication',async t=>{
  const {origin,multiplayer}=await setup(t);
  for(let n=0;n<12;n++){
    multiplayer.limits.clear();const socket=await openSocket(t,origin,{origin});await once(socket,'open');
  }
  multiplayer.limits.clear();const extra=await openSocket(t,origin,{origin});let opened=false;extra.on('open',()=>{opened=true;});await closed(extra);
  assert.equal(opened,false);assert.equal(multiplayer.sockets.clients.size,12);
});

test('kicking a player also invalidates their public invitation secret',async t=>{
  const {post}=await setup(t,{publicOrigin:'https://game.example',trustProxy:true});
  const headers={Host:'game.example','X-Forwarded-Proto':'https',Origin:'https://game.example'};
  const host=await post('/api/rooms',{name:'Host',driver:0,arena:0},undefined,headers);
  const guest=await post('/api/join',{...joinBody(host.code),invite:host.invite},undefined,headers);
  const kicked=await post('/api/kick',{id:guest.you},host.token,headers);
  assert.equal(kicked.status,200);assert.notEqual(kicked.invite,host.invite);
  assert.equal((await post('/api/join',{...joinBody(host.code),invite:host.invite},undefined,headers)).status,403);
  assert.equal((await post('/api/chat',{},guest.token,headers)).status,401);
  assert.equal((await post('/api/join',{...joinBody(host.code),invite:kicked.invite},undefined,headers)).status,200);
});


test('path traversal and source-file probes cannot retrieve private server files',async t=>{
  const {origin}=await setup(t);
  for(const path of ['/server/security.js','/server/chat.js','/.git/config','/package.json','/%2e%2e/server.js','/server/%2e%2e/server.js']){
    const response=await fetch(origin+path);assert.equal(response.status,404,path);
  }
});
