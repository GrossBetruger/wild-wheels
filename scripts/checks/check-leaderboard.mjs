// The all-time leaderboard, end to end on a real server: a saved board is read
// at start, a finished match adds a game and a win, the file is written as the
// match finishes, and a restart keeps it. Plays one whole match: about 3.5 minutes.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import WebSocket from 'ws';

const arg=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
const binary=resolve(arg('--server-binary','dedicated-server/target/release/wild-wheels-server'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check,message,ms=15000){const end=performance.now()+ms;while(performance.now()<end){if(await check())return;await sleep(100);}throw new Error(message);}
const directory=await mkdtemp(join(tmpdir(),'wild-wheels-leaderboard-'));
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const origin=`http://127.0.0.1:${port}`,file=join(directory,'leaderboard.json');
const env={...process.env,PORT:String(port),BIND:'127.0.0.1',BOTS:'0',WILD_WHEELS_LEADERBOARD_FILE:file,WILD_WHEELS_LOG_DIR:join(directory,'logs'),WILD_WHEELS_SESSION_FILE:join(directory,'sessions.json'),WILD_WHEELS_CHAT_FILE:join(directory,'chat.json'),WILD_WHEELS_STATS_FILE:join(directory,'stats.json')};
for(const name of ['PUBLIC_ORIGIN','TRUST_PROXY','INVITE_SECRET'])delete env[name];
let server;
const start=async()=>{server=spawn(binary,[],{cwd:directory,env,stdio:'ignore'});await wait(async()=>{try{return(await fetch(origin+'/healthz')).ok;}catch{return false;}},'Dedicated server did not start');};
const stop=async()=>{const gone=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await gone;};
const board=async()=>(await(await fetch(origin+'/api/leaderboard')).json()).players;
const post=(path,body,token)=>fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
try{
  await writeFile(file,JSON.stringify({players:[{name:'Veteran',wins:5,games:9}]}));
  await start();
  assert.deepEqual(await board(),[{name:'Veteran',wins:5,games:9}],'a saved board is read when the server starts');

  // One person plays a whole match alone and so wins it.
  const joined=await(await post('/api/join',{code:'00',name:'Solo',driver:0,role:'driver'})).json();
  await post('/api/control',{action:'start'},joined.token);
  const socket=new WebSocket(origin.replace('http','ws')+'/api/socket',{headers:{origin}});
  let phase='',epoch=null;
  // A snapshot is a 16-byte header, then JSON of the length in bytes 4–8.
  socket.on('message',(data,binary)=>{if(!binary)return;const world=JSON.parse(data.subarray(16,16+data.readUInt32LE(4))).state.world;phase=world.phase;epoch=world.soundEpoch;});
  await new Promise(resolve=>socket.once('open',resolve));
  socket.send(JSON.stringify({type:'authenticate',token:joined.token}));
  // Staying in touch keeps the player from being marked away.
  let sequence=0;const present=setInterval(()=>{if(socket.readyState===WebSocket.OPEN&&epoch!==null)socket.send(JSON.stringify({type:'input',sequence:sequence++,epoch,keys:[],actions:[],moves:[]}));},1000);
  await wait(()=>phase==='racing','The match did not start');
  assert.deepEqual(await board(),[{name:'Veteran',wins:5,games:9}],'nothing is counted while the match is being played');
  await wait(()=>phase==='finished','The match did not finish',215000);
  clearInterval(present);
  const expected=[{name:'Veteran',wins:5,games:9},{name:'Solo',wins:1,games:1}];
  await wait(async()=>(await board()).length===2,'The finished match was not counted');
  assert.deepEqual(await board(),expected);
  await wait(async()=>JSON.parse(await readFile(file,'utf8')).players.length===2,'The file was not written when the match finished',5000);
  const saved=JSON.parse(await readFile(file,'utf8')).players;
  assert.deepEqual([...saved].sort((a,b)=>b.wins-a.wins),expected);
  assert.deepEqual(saved.map(player=>Object.keys(player).sort()),[['games','name','wins'],['games','name','wins']],'only names, wins and games are kept');
  await sleep(1500);assert.deepEqual(await board(),expected,'a finished match is counted once');
  socket.close();

  await stop();await start();
  assert.deepEqual(await board(),expected,'the board survives a restart');
  console.log(JSON.stringify({pass:true,criteria:'A saved leaderboard is read at start; a finished match adds one game for the person playing and a win for the winner, once; the file holds only names, wins and games, is written as the match finishes, and survives a restart.',board:expected}));
}finally{server?.kill('SIGTERM');}
