// A native client whose connection drops mid-match must recover on its first
// reconnection. The link has latency, so the racer keeps producing controls
// while the new connection is being set up; none of those may reach it.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer,request as httpRequest} from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import WebSocket,{WebSocketServer} from 'ws';

const arg=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
const binary=resolve(arg('--server-binary','dedicated-server/target/release/wild-wheels-server'));
const nativeBinary=resolve(arg('--client-binary','native-client/target/release/wild-wheels-native'));
const DELAY=40,CUT_AFTER=5000,SECONDS=16;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check,message,ms=15000){const end=performance.now()+ms;while(performance.now()<end){if(await check())return;await sleep(40);}throw new Error(message);}
const directory=await mkdtemp(join(tmpdir(),'wild-wheels-native-reconnect-'));
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const origin=`http://127.0.0.1:${port}`;
const env={...process.env,PORT:String(port),BIND:'127.0.0.1',BOTS:'0',WILD_WHEELS_SESSION_FILE:join(directory,'sessions.json'),WILD_WHEELS_CHAT_FILE:join(directory,'chat.json'),WILD_WHEELS_STATS_FILE:join(directory,'stats.json')};
delete env.PUBLIC_ORIGIN;delete env.TRUST_PROXY;delete env.INVITE_SECRET;
const server=spawn(binary,[],{cwd:directory,env,stdio:['ignore','ignore','pipe']});
let serverLog='';server.stderr.on('data',data=>serverLog+=data);

// One socket per connection the client makes: who closed it and what it carried.
const sockets=[];const peers=new Set();
const later=action=>setTimeout(action,DELAY);
const bridge=createServer((req,res)=>{
  const sent=[];req.on('data',chunk=>sent.push(chunk));req.on('end',()=>later(()=>{
    const upstream=httpRequest(origin+(req.url??'/'),{method:req.method,headers:req.headers},reply=>{
      const body=[];reply.on('data',chunk=>body.push(chunk));reply.on('end',()=>later(()=>{res.writeHead(reply.statusCode,reply.headers);res.end(Buffer.concat(body));}));
    });
    upstream.on('error',()=>{res.writeHead(502);res.end();});upstream.end(Buffer.concat(sent));
  }));
});
const wsServer=new WebSocketServer({noServer:true});
bridge.on('upgrade',(req,stream,head)=>later(()=>wsServer.handleUpgrade(req,stream,head,client=>{
  const record={closedBy:null,inputs:0,firstInput:null,actionAck:-1,movementAck:-1};sockets.push(record);
  const upstream=new WebSocket(origin.replace('http','ws')+req.url,{headers:{origin:req.headers.origin,host:req.headers.host}});
  peers.add(client);peers.add(upstream);const queued=[];
  const close=by=>{if(record.closedBy)return;record.closedBy=by;client.terminate();upstream.terminate();};
  client.on('message',(data,binary)=>{
    const text=data.toString();if(text.includes('"type":"input"')){record.inputs++;record.firstInput??=JSON.parse(text);}
    const send=()=>later(()=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(data,{binary});});
    if(upstream.readyState===WebSocket.OPEN)send();else queued.push(send);
  });
  upstream.on('open',()=>{for(const send of queued)send();});
  upstream.on('message',(data,binary)=>{
    // A state packet is a 16-byte header, then JSON of the length in bytes 4–8.
    if(binary&&data.length>16){const state=JSON.parse(data.subarray(16,16+data.readUInt32LE(4))).state;record.actionAck=state.actionSequence;record.movementAck=state.movementSequence;}
    later(()=>{if(client.readyState===WebSocket.OPEN)client.send(data,{binary});});
  });
  client.on('close',()=>close('client'));upstream.on('close',()=>close('server'));
  client.on('error',()=>close('client'));upstream.on('error',()=>close('server'));
  if(sockets.length===1)setTimeout(()=>close('network'),CUT_AFTER);
})));
await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
let native;
try{
  await wait(async()=>{try{return(await fetch(origin+'/healthz')).ok;}catch{return false;}},'Dedicated server did not start');
  let log='';
  native=spawn(nativeBinary,['--server',`http://127.0.0.1:${bridge.address().port}`,'--name','Native Blip','--headless','--auto-start','--seconds',String(SECONDS)],{env:{...process.env,WILD_WHEELS_NATIVE_DATA_DIR:join(directory,'native')},stdio:['ignore','pipe','pipe']});
  native.stdout.on('data',data=>log+=data);native.stderr.on('data',data=>log+=data);
  const done=await Promise.race([new Promise(resolve=>native.once('exit',code=>resolve({code}))),sleep((SECONDS+15)*1000).then(()=>({timeout:true}))]);
  const rows=log.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line));
  const result=rows.findLast(row=>'pass'in row);
  const summary=JSON.stringify({sockets,lost:rows.filter(row=>row.event==='connection-lost')});
  assert.equal(done.code,0,log);assert.equal(result?.pass,true,log);
  assert.equal(sockets[0].closedBy,'network','The check itself must be what drops the first connection');
  assert.ok(!sockets.some(socket=>socket.closedBy==='server'),`The server must never reject a reconnected client: ${summary}`);
  assert.equal(sockets.length,2,`One dropped connection must cost exactly one reconnection: ${summary}`);
  assert.equal(result.metrics.connections,2,summary);
  assert.equal(rows.filter(row=>row.event==='connection-lost').length,1,summary);
  const [before,after]=sockets;
  assert.ok(after.firstInput.moves.every(move=>move.sequence>before.movementAck)&&after.firstInput.sequence===0,`The first controls on a new connection must come from its own session: ${summary}`);
  assert.ok(after.movementAck>before.movementAck+120,`Driving must continue after reconnecting: ${summary}`);
  assert.ok(after.actionAck>before.actionAck+5,`Firing must continue after reconnecting: ${summary}`);
  console.log(JSON.stringify({pass:true,criteria:'A native client whose connection drops mid-match over a delayed link rejoins on its first reconnection, is never rejected by the server, and keeps driving and firing.',sockets:sockets.map(({closedBy,inputs,actionAck,movementAck})=>({closedBy,inputs,actionAck,movementAck})),native:result}));
}finally{
  native?.kill('SIGKILL');for(const peer of peers)peer.terminate();wsServer.close();bridge.closeAllConnections();bridge.close();server.kill('SIGTERM');
}
