// The server's problem log, end to end: what the server notes, what clients may
// report, who may read it, and that reading never needs the game to stop.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {existsSync} from 'node:fs';
import {mkdtemp,readFile,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import WebSocket from 'ws';

const arg=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
const binary=resolve(arg('--server-binary','dedicated-server/target/release/wild-wheels-server'));
const nativeBinary=resolve(arg('--client-binary','native-client/target/release/wild-wheels-native'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check,message,ms=15000){const end=performance.now()+ms;while(performance.now()<end){if(await check())return;await sleep(100);}throw new Error(message);}
const directory=await mkdtemp(join(tmpdir(),'wild-wheels-logging-'));
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const origin=`http://127.0.0.1:${port}`,logs=join(directory,'logs');
const env={...process.env,PORT:String(port),BIND:'127.0.0.1',BOTS:'0',WILD_WHEELS_LOG_DIR:logs,WILD_WHEELS_SESSION_FILE:join(directory,'sessions.json'),WILD_WHEELS_CHAT_FILE:join(directory,'chat.json'),WILD_WHEELS_STATS_FILE:join(directory,'stats.json')};
for(const name of ['PUBLIC_ORIGIN','TRUST_PROXY','INVITE_SECRET','LOG_READ_KEY','WILD_WHEELS_LOG_DAILY_BYTES'])delete env[name];
const server=spawn(binary,[],{cwd:directory,env,stdio:['ignore','ignore','pipe']});
let serverLog='';server.stderr.on('data',data=>serverLog+=data);
const post=(path,body,token)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
let native;
try{
  await wait(async()=>{try{return(await fetch(origin+'/healthz')).ok;}catch{return false;}},'Dedicated server did not start');
  await wait(()=>existsSync(join(logs,'read-key')),'The server did not make a log reading key');
  const key=(await readFile(join(logs,'read-key'),'utf8')).trim();
  const read=async(query='',bearer=key)=>{const reply=await fetch(`${origin}/logz${query}`,{headers:bearer?{Authorization:`Bearer ${bearer}`}:{}});return {status:reply.status,body:await reply.json()};};
  const events=async(query='')=>(await read(`?day=today&limit=2000${query}`)).body.entries;

  // Only the key reads the log.
  assert.equal((await read('',null)).status,401);assert.equal((await read('','x'.repeat(64))).status,401);
  assert.equal((await read('?day=../read-key')).status,400);assert.equal((await read('?dya=today')).status,400);
  const index=await read();assert.equal(index.status,200);assert.equal(index.body.keptDays,30);assert.equal(index.body.days.length,1);

  // Only a player in the room writes to it, and only well-formed reports.
  const report={client:'browser',build:'check',entries:[{level:'error',event:'js-error',agoMs:1200,count:2,data:{message:'boom\nline two',stack:'at x'}}]};
  assert.equal((await post('/api/log',report)).status,401);
  const joined=await(await post('/api/join',{code:'00',name:'Reporter',driver:10,role:'driver'})).json();
  assert.equal((await post('/api/log',report,joined.token)).status,200);
  const bevyFrame={level:'warn',event:'slow-minute',data:{match:3,p95Ms:47.5,longestWaitForServerMs:1100}};
  assert.equal((await post('/api/log',{client:'bevy-wasm',build:'check',entries:[bevyFrame]},joined.token)).status,200);
  assert.equal((await post('/api/log',{client:'server',entries:report.entries},joined.token)).status,400);
  assert.equal((await post('/api/log',{client:'browser',entries:[{level:'error',event:'Bad Name'}]},joined.token)).status,400);
  assert.equal((await post('/api/log',{client:'browser',entries:[{level:'info',event:'big',data:{text:'x'.repeat(9000)}}]},joined.token)).status,413,'a report larger than the limit is refused');

  // A connection the server ends is explained: here, a move out of sequence.
  await post('/api/control',{action:'start'},joined.token);await sleep(300);
  const socket=new WebSocket(origin.replace('http','ws')+'/api/socket',{headers:{origin}});
  await new Promise(resolve=>socket.once('open',resolve));
  const snapshot=new Promise(resolve=>socket.on('message',(data,binary)=>{if(binary)resolve(data);}));
  socket.send(JSON.stringify({type:'authenticate',token:joined.token,client:'bevy-wasm'}));
  // A snapshot is a 16-byte header, then JSON of the length in bytes 4–8.
  const packet=await snapshot,epoch=JSON.parse(packet.subarray(16,16+packet.readUInt32LE(4))).state.world.soundEpoch;
  socket.send(JSON.stringify({type:'input',sequence:0,epoch,keys:[],actions:[],moves:[{sequence:41,keys:['arrowup']}]}));
  await new Promise(resolve=>socket.once('close',resolve));

  await wait(async()=>(await events()).some(entry=>entry.event==='socket-closed'),'The server did not note the closed connection');
  const all=await events();
  const named=name=>all.filter(entry=>entry.event===name);
  assert.equal(named('server-start').length,1);
  const closed=named('socket-closed')[0];
  assert.equal(closed.level,'error');assert.match(closed.reason,/refused input: Movement out of sequence/);
  assert.equal(closed.client,'bevy-wasm');
  assert.ok(named('socket-open').some(entry=>entry.client==='bevy-wasm'&&entry.connection===closed.connection));
  assert.deepEqual([closed.who.name,closed.who.driver,closed.detail.input.moves.first,closed.detail.held.acceptedMove],['Reporter',10,41,-1]);
  const reported=named('js-error')[0];
  assert.deepEqual([reported.source,reported.level,reported.who.name,reported.count,reported.agoMs,reported.build,reported.data.message],['browser','error','Reporter',2,1200,'check','boom\nline two']);
  assert.ok(named('request').some(entry=>entry.path==='/api/join'&&entry.who.name==='Reporter'));
  assert.ok(named('request-refused').length===0||named('request-refused').every(entry=>entry.status>=400));
  assert.ok(named('match-phase').some(entry=>entry.to==='countdown'));
  assert.ok(!JSON.stringify(all).includes(joined.token)&&!JSON.stringify(all).includes(key),'No session or key may appear in the log');
  assert.equal((await read('?day=today&source=browser')).body.returned,1);
  const bevyReports=await events('&source=bevy-wasm');
  assert.equal(bevyReports.length,1);
  assert.equal(bevyReports[0].event,'slow-minute');
  assert.equal(bevyReports[0].who.name,'Reporter');
  assert.deepEqual(bevyReports[0].data,bevyFrame.data);
  assert.equal((await read('?day=today&level=error&contains=Movement')).body.returned,1);

  // The files themselves: one line of JSON each, private, in the day's two files.
  const files=(await readdir(logs)).sort();
  assert.deepEqual(files.map(name=>name.replace(/^\d{4}-\d{2}-\d{2}/,'DAY')),['DAY.clients.jsonl','DAY.server.jsonl','read-key']);
  for(const name of files.slice(0,2))for(const line of (await readFile(join(logs,name),'utf8')).trim().split('\n'))JSON.parse(line);

  // The native client reports through the same door.
  let nativeChecked=false;
  if(existsSync(nativeBinary)){
    native=spawn(nativeBinary,['--server',origin,'--name','Native Reporter','--headless','--seconds','9'],{env:{...process.env,WILD_WHEELS_NATIVE_DATA_DIR:join(directory,'native')},stdio:'ignore'});
    await new Promise(resolve=>native.once('exit',resolve));native=null;
    await wait(async()=>(await events('&source=native')).some(entry=>entry.event==='connected'),'The native client did not report');
    const connected=(await events('&source=native')).find(entry=>entry.event==='connected');
    assert.equal(connected.who.name,'Native Reporter');assert.match(connected.build,/^native /);nativeChecked=true;
  }
  // Everything at once: one public file of lines in the order they happened.
  const collect=(query='')=>fetch(`${origin}/logz/all${query}`);
  assert.equal((await collect('?day=today')).status,400);assert.equal((await read('?days=2')).status,400);
  const collected=await collect();assert.equal(collected.status,200);
  assert.equal(collected.headers.get('content-type'),'application/x-ndjson');assert.match(collected.headers.get('content-disposition'),/^attachment; filename="wild-wheels-log-\d{4}-\d{2}-\d{2}\.jsonl"$/);
  const lines=(await collected.text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.equal(lines.length,(await events()).length,'everything is every line of every day');
  assert.deepEqual(lines.map(line=>line.t),lines.map(line=>line.t).sort(),'in the order it happened');
  assert.ok(lines.some(line=>line.source==='server')&&lines.some(line=>line.source==='browser')&&lines.some(line=>line.source==='native'));
  const errors=(await(await collect('?days=1&level=error')).text()).trim().split('\n').map(line=>JSON.parse(line));
  assert.ok(errors.length>=2&&errors.every(line=>line.level==='error'));

  // A flood of reports is slowed at the door and cannot fill the day's file.
  const statuses=[];for(let i=0;i<12;i++)statuses.push((await post('/api/log',{client:'browser',entries:[{level:'warn',event:'flood',data:{i}}]},joined.token)).status);
  assert.ok(statuses.includes(429),`Reports must be rate limited: ${statuses}`);

  console.log(JSON.stringify({pass:true,criteria:'The server notes its own problems with reasons, accepts checked reports only from players in the room, limits their rate and size, keeps sessions and keys out of the log, and shows the log, a day at a time or all at once, only to the reading key.',nativeChecked,events:[...new Set((await events()).map(entry=>`${entry.source}:${entry.event}`))].sort()}));
}catch(error){console.error(serverLog);throw error;}finally{native?.kill('SIGKILL');server.kill('SIGTERM');}
