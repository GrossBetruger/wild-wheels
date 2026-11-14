import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer,request} from 'node:http';
import {once} from 'node:events';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import WebSocket from 'ws';

const binary=fileURLToPath(new URL('../../dedicated-server/target/debug/wild-wheels-server',import.meta.url));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const children=[],sockets=[],directories=[];
async function start(config={}){
  const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
  const env={...process.env,BIND:'127.0.0.1',PORT:String(port),BOTS:'0'};
  delete env.PUBLIC_ORIGIN;delete env.TRUST_PROXY;delete env.INVITE_SECRET;Object.assign(env,config);
  const directory=await mkdtemp(join(tmpdir(),'wild-wheels-dedicated-security-'));directories.push(directory);
  const child=spawn(binary,[],{cwd:directory,env,stdio:['ignore','pipe','pipe']});children.push(child);let logs='';child.stdout.on('data',bytes=>logs+=bytes);child.stderr.on('data',bytes=>logs+=bytes);child.on('error',error=>logs+=error.message);
  const origin=`http://127.0.0.1:${port}`;
  const proxy=config.PUBLIC_ORIGIN?{Host:new URL(config.PUBLIC_ORIGIN).host,'X-Forwarded-Proto':'https',Origin:config.PUBLIC_ORIGIN}:{};
  const call=(path,body,token,extra={})=>new Promise((resolve,reject)=>{
    const req=request(origin+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`} :{}),...proxy,...extra}},res=>{let text='';res.on('data',bytes=>text+=bytes);res.on('end',()=>{let value;try{value=JSON.parse(text);}catch{value=text;}resolve({status:res.statusCode,headers:res.headers,value});});});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
  let ready=false;for(let n=0;n<100;n++){try{if((await call('/healthz')).status===200){ready=true;break;}}catch{}await sleep(50);}
  assert.ok(ready,`Dedicated server did not start: ${logs}`);
  return {origin,call};
}
function socket(origin,headers={}){
  const ws=new WebSocket(origin.replace('http:','ws:')+'/api/socket',{headers});sockets.push(ws);ws.on('error',()=>{});return ws;
}
function closed(ws){return Promise.race([new Promise(resolve=>ws.once('close',resolve)),sleep(4500).then(()=>{throw new Error('Attack socket remained open');})]);}
try{
  const {origin,call}=await start();
  const join=name=>call('/api/join',{code:'00',name,driver:null});
  const alice=(await join('Alice')).value,bob=(await join('Bob')).value,eve=(await join('Eve')).value;
  for(const hostile of ['https://attacker.invalid',origin.replace('http:','https:')])assert.equal((await call('/api/name',{name:'Hacked'},alice.token,{Origin:hostile})).status,403);
  assert.equal((await call('/api/name',{name:'Hacked'},undefined,{Cookie:`wild-wheels-session=${alice.token}`})).status,403);
  const sent=await call('/api/chat',{text:'Private secret',to:bob.you,from:eve.you},alice.token);assert.equal(sent.status,200);const id=sent.value.messages[0].id;
  assert.deepEqual((await call('/api/chat',{you:alice.you},eve.token)).value.messages,[]);
  for(const deleteId of [id,99999])assert.equal((await call('/api/chat',{deleteId},eve.token)).status,404);
  assert.equal((await call('/api/chat',{text:'Leak',to:alice.you,replyTo:id},eve.token)).status,400);
  for(const text of ['<script>globalThis.__chatXss=1</script>','<img src=x onerror=alert(1)>',"' OR 1=1; DROP TABLE messages; --"]){
    await sleep(550);const response=await call('/api/chat',{text},alice.token);assert.equal(response.status,200);assert.equal(response.value.messages.at(-1).text,text);
  }
  assert.equal((await call('/api/chat',{text:'x'.repeat(3000)},alice.token)).status,413);
  assert.equal((await call('/api/chat',{},'a'.repeat(64))).status,401);
  assert.equal((await call('/api/color',{color:'#a4198b',id:bob.you},alice.token)).status,200);
  assert.equal((await call('/api/color',{color:'#a4198b'},bob.token)).status,409);
  assert.equal((await call('/api/color',{color:'url(https://attacker.invalid)'},alice.token)).status,400);
  const coloredChat=await call('/api/chat',{},alice.token);assert.ok(coloredChat.value.messages.length>0);

  for(const headers of [{},{Origin:'https://attacker.invalid'},{Origin:origin.replace('http:','https:')}]){
    const ws=socket(origin,headers);let opened=false;ws.once('open',()=>opened=true);await closed(ws);assert.equal(opened,false);
  }
  const cookieSocket=socket(origin,{Origin:origin,Cookie:`wild-wheels-session=${alice.token}`});await once(cookieSocket,'open');const cookieClosed=closed(cookieSocket);cookieSocket.send(JSON.stringify({type:'input',sequence:0,keys:[],actions:[]}));await cookieClosed;
  const flood=socket(origin,{Origin:origin});await once(flood,'open');const initial=once(flood,'message');flood.send(JSON.stringify({type:'authenticate',token:alice.token}));await initial;
  const floodClosed=closed(flood);for(let n=0;n<101;n++)flood.send(JSON.stringify({type:'ping',sent:n}));await floodClosed;
  const oversized=socket(origin,{Origin:origin});await once(oversized,'open');const oversizedClosed=closed(oversized);oversized.send('x'.repeat(2049));await oversizedClosed;
  const idle=socket(origin,{Origin:origin});await once(idle,'open');await closed(idle);
  await sleep(1050);let rejected=false;for(let n=0;n<35;n++){if((await call('/api/chat',{},bob.token)).status===429)rejected=true;}assert.ok(rejected,'HTTP flood was not rate limited');
  const secret='b'.repeat(64);const publicServer=await start({PUBLIC_ORIGIN:'https://game.example',TRUST_PROXY:'1',INVITE_SECRET:secret});
  assert.equal((await publicServer.call('/api/join',{code:'00',name:'Intruder',driver:null})).status,403);
  const allowed=await publicServer.call('/api/join',{code:'00',name:'Friend',driver:null,invite:secret});assert.equal(allowed.status,200);assert.match(allowed.headers['set-cookie'][0],/HttpOnly; SameSite=Lax.*Secure/);
  assert.equal(allowed.headers['strict-transport-security'],'max-age=31536000');
  const publicSocket=socket(publicServer.origin,{Host:'game.example','X-Forwarded-Proto':'https',Origin:'https://game.example'});await once(publicSocket,'open');const publicInitial=once(publicSocket,'message');publicSocket.send(JSON.stringify({type:'authenticate',token:allowed.value.token}));assert.equal((await publicInitial)[1],true);
  assert.equal((await publicServer.call('/api/chat',{},allowed.value.token,{'X-Forwarded-Proto':'http'})).status,403);
  assert.equal((await publicServer.call('/api/chat',{},allowed.value.token,{Origin:'http://game.example'})).status,403);
  console.log('Dedicated security checks passed: IDOR, CSRF, authenticated color selection and collisions, injection-as-data, body limits, HTTP/WebSocket floods, hijacking, authentication deadlines, HTTPS and invitation secrets.');
}finally{
  for(const ws of sockets)ws.terminate();
  for(const child of children){child.kill('SIGTERM');}
  await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():once(child,'exit')));
  await Promise.all(directories.map(directory=>rm(directory,{recursive:true,force:true})));
}
