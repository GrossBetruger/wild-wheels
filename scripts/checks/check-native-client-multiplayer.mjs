import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer,request as httpRequest} from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import WebSocket,{WebSocketServer} from 'ws';

const arg=(name,fallback)=>{const at=process.argv.indexOf(name);return at<0?fallback:process.argv[at+1];};
const binary=resolve(arg('--server-binary','dedicated-server/target/release/wild-wheels-server'));
const nativeBinary=resolve(arg('--client-binary','native-client/target/debug/wild-wheels-native'));
const selectedProfile=arg('--profile',null);
const output=arg('--output',join(tmpdir(),'wild-wheels-native-multiplayer.json'));
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check,message,ms=15000){const end=performance.now()+ms;while(performance.now()<end){if(await check())return;await sleep(40);}throw new Error(message);}
const directory=await mkdtemp(join(tmpdir(),'wild-wheels-native-poc-'));
const probe=createServer();await new Promise(resolve=>probe.listen(0,'127.0.0.1',resolve));const port=probe.address().port;await new Promise(resolve=>probe.close(resolve));
const origin=`http://127.0.0.1:${port}`;
function startServer(label){
  const env={...process.env,PORT:String(port),BIND:'127.0.0.1',BOTS:'0',WILD_WHEELS_SESSION_FILE:join(directory,`${label}-sessions.json`),WILD_WHEELS_CHAT_FILE:join(directory,`${label}-chat.json`),WILD_WHEELS_STATS_FILE:join(directory,`${label}-stats.json`)};
  // Each latency bridge has its own local origin and preserves Host/Origin.
  // Exercise LAN development policy instead of pinning the upstream port.
  delete env.PUBLIC_ORIGIN;delete env.TRUST_PROXY;delete env.INVITE_SECRET;
  return spawn(binary,[],{cwd:directory,env,stdio:['ignore','ignore','pipe']});
}
let server=startServer('local');
let serverLog='',chromeLog='',socket,sequence=0,currentNative;
server.stderr.on('data',data=>serverLog+=data);
const chrome=spawn(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${join(directory,'chrome')}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--window-size=1100,850','about:blank'],{stdio:['ignore','ignore','pipe']});
chrome.stderr.on('data',data=>chromeLog+=data);
const pending=new Map(),errors=[],results=[],bridges=[];
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function evaluate(session,expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},session);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;}

// WebSocket frames preserve TCP ordering while adding reproducible one-way delay.
async function proxy(profile){
  const sockets=new Set();const timers=new Set();
  const bridge=createServer((req,res)=>{
    const upstream=httpRequest(origin+(req.url??'/'),{method:req.method,headers:req.headers},reply=>{res.writeHead(reply.statusCode,reply.headers);reply.pipe(res);});
    upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);
  });
  const wsServer=new WebSocketServer({noServer:true});
  bridge.on('upgrade',(req,stream,head)=>wsServer.handleUpgrade(req,stream,head,client=>{
    sockets.add(client);let upstream,closed=false;let counter=0;
    const queued=[];const schedule=()=>{
      let last=0,timer;const frames=[];
      const arm=()=>{timer=setTimeout(flush,Math.max(0,Math.ceil(frames[0].at-performance.now())));timers.add(timer);};
      function flush(){
        timers.delete(timer);timer=null;
        // One FIFO pump per direction: independent rounded timers can reorder
        // equal-deadline frames, even sending input before authentication.
        while(frames.length&&frames[0].at<=performance.now()){
          const frame=frames.shift();if(!closed)frame.action();
        }
        if(frames.length)arm();
      }
      return action=>{
        last=Math.max(last,performance.now()+profile.delay+Math.sin(++counter*1.7)*profile.jitter);
        frames.push({at:last,action});if(!timer)arm();
      };
    };
    const toServer=schedule(),toClient=schedule();
    upstream=new WebSocket(origin.replace('http','ws')+(req.url??'/api/socket'),{headers:{origin:req.headers.origin,host:req.headers.host}});sockets.add(upstream);
    client.on('message',(data,binary)=>{const send=()=>{if(upstream.readyState===WebSocket.OPEN)upstream.send(data,{binary});};if(upstream.readyState!==WebSocket.OPEN){queued.push(send);return;}toServer(send);});
    upstream.on('open',()=>{for(const send of queued)toServer(send);});
    upstream.on('message',(data,binary)=>toClient(()=>{if(client.readyState===WebSocket.OPEN)client.send(data,{binary});}));
    const close=()=>{if(closed)return;closed=true;client.terminate();upstream.terminate();sockets.delete(client);sockets.delete(upstream);};
    for(const [label,peer] of [['client',client],['server',upstream]]){peer.on('error',error=>{console.error(JSON.stringify({event:'proxy-error',peer:label,message:error.message}));close();});peer.on('close',(code,reason)=>{if(!closed)console.error(JSON.stringify({event:'proxy-close',peer:label,code,reason:reason.toString()}));close();});}
  }));
  await new Promise(resolve=>bridge.listen(0,'127.0.0.1',resolve));
  const stop=async()=>{for(const timer of timers)clearTimeout(timer);for(const peer of sockets)peer.terminate();wsServer.close();bridge.closeAllConnections();await new Promise(resolve=>bridge.close(resolve));};
  bridges.push(stop);return {origin:`http://127.0.0.1:${bridge.address().port}`,stop};
}
try{
  await wait(async()=>{try{return(await fetch(origin+'/healthz')).ok;}catch{return false;}},'Dedicated server did not start');
  await wait(()=>/DevTools listening on (ws:\/\/\S+)/.test(chromeLog),'Chrome did not start');
  socket=new WebSocket(chromeLog.match(/DevTools listening on (ws:\/\/\S+)/)[1]);await new Promise(resolve=>socket.once('open',resolve));
  socket.on('message',async data=>{
    const message=JSON.parse(data);
    if(message.id){const task=pending.get(message.id);if(!task)return;pending.delete(message.id);clearTimeout(task.timer);if(message.error)task.reject(new Error(JSON.stringify(message.error)));else task.resolve(message.result);return;}
    if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);
    if(message.method==='Fetch.requestPaused'){
      try{const {requestId}=message.params;const response=await call('Fetch.getResponseBody',{requestId},message.sessionId);
        const source=Buffer.from(response.body,response.base64Encoded?'base64':'utf8').toString()+'\nglobalThis.__game={network,keys,get race(){return race}};';
        await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(source).toString('base64')},message.sessionId);
      }catch(error){errors.push(error.message);}
    }
  });
  for(const profile of [{name:'local',delay:0,jitter:0},{name:'160ms',delay:80,jitter:0},{name:'160ms-jitter',delay:80,jitter:30}]){
    if(selectedProfile&&selectedProfile!==profile.name)continue;
    console.log(JSON.stringify({event:'profile-start',profile:profile.name}));
    if(profile.name!=='local'){
      const stopped=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await stopped;
      server=startServer(profile.name);server.stderr.on('data',data=>serverLog+=data);
      await wait(async()=>{try{return(await fetch(origin+'/healthz')).ok;}catch{return false;}},'Fresh profile server did not start');
    }
    const bridge=await proxy(profile);
    const {browserContextId}=await call('Target.createBrowserContext');
    const {targetId}=await call('Target.createTarget',{url:'about:blank',browserContextId});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    await call('Runtime.enable',{},sessionId);await call('Page.enable',{},sessionId);
    await call('Emulation.setFocusEmulationEnabled',{enabled:true},sessionId);
    await call('Fetch.enable',{patterns:[{urlPattern:'*/client/game.js',requestStage:'Response'}]},sessionId);
    await call('Page.navigate',{url:bridge.origin+'/?room=00'},sessionId);
    await wait(()=>evaluate(sessionId,'Boolean(globalThis.__game?.network.dedicated)'),'Browser did not initialize');
    await evaluate(sessionId,`(async()=>{const n=__game.network;n.name.value='Browser ${profile.name}';n.name.dispatchEvent(new Event('input',{bubbles:true}));await n.connect('/api/join');})()`);
    await wait(()=>evaluate(sessionId,'Boolean(__game.network.state?.code)'),'Browser did not join');
    if(await evaluate(sessionId,"['ready','finished'].includes(__game.race.phase)"))await evaluate(sessionId,"__game.network.control('start')");
    await wait(()=>evaluate(sessionId,"__game.race.phase==='racing'"),'Match did not start');
    let nativeLog='';
    const nativeName=`Native ${profile.name}`;
    currentNative=spawn(nativeBinary,['--server',bridge.origin,'--name',nativeName,'--headless','--seconds','8'],{env:{...process.env,WILD_WHEELS_NATIVE_DATA_DIR:join(directory,profile.name)},stdio:['ignore','pipe','pipe']});
    const completion=new Promise(resolve=>currentNative.once('exit',(code,signal)=>resolve({code,signal})));
    currentNative.stdout.on('data',data=>nativeLog+=data);currentNative.stderr.on('data',data=>nativeLog+=data);
    await wait(()=>evaluate(sessionId,`__game.network.state.players.some(p=>p.name===${JSON.stringify(nativeName)})`),'Native player did not appear in browser');
    const before=await evaluate(sessionId,'({x:__game.race.wx,z:__game.race.wz})');
    await evaluate(sessionId,"__game.keys.add('w')");
    try {
      await wait(async()=>{const after=await evaluate(sessionId,'({x:__game.race.wx,z:__game.race.wz})');return Math.hypot(after.x-before.x,after.z-before.z)>1;},`${profile.name}: Browser movement must reach the shared game`,3000);
    } finally {await evaluate(sessionId,'__game.keys.clear()');}
    await wait(()=>evaluate(sessionId,"Boolean(__game.network.action('fire'))"),'Browser could not fire');
    try {
      await wait(()=>evaluate(sessionId,'__game.network.state.actionSequence>=0'),`${profile.name}: Browser shot was not acknowledged`);
    } catch(error) {
      console.error(JSON.stringify({profile:profile.name,browser:await evaluate(sessionId,'({phase:__game.race.phase,paused:__game.network.paused,afk:__game.network.afk,actionAck:__game.network.state.actionSequence,movementAck:__game.network.state.movementSequence,socket:__game.network.socket.readyState,buffered:__game.network.socket.bufferedAmount,stats:__game.network.client.stats})'),nativeLog,errors,serverLog}));
      throw error;
    }
    const done=await Promise.race([completion,sleep(15000).then(()=>({timeout:true}))]);
    assert.equal(done.code,0,nativeLog);currentNative=null;
    const native=nativeLog.split('\n').filter(line=>line.startsWith('{')).map(line=>JSON.parse(line)).findLast(row=>'pass'in row);
    assert.equal(native?.pass,true,nativeLog);assert.ok(native.actionAck>=0);assert.ok(native.movementAck>=0);
    assert.equal(native.metrics.connections,1,`${profile.name}: network must remain connected`);
    assert.ok(native.metrics.movementAcknowledgementMs.p99<1000,`${profile.name}: acknowledgements stalled`);
    results.push({profile:profile.name,pass:true,browserMoved:true,browserShotAcknowledged:true,native});
    console.log(JSON.stringify(results.at(-1)));
    await call('Target.disposeBrowserContext',{browserContextId});await bridge.stop();bridges.splice(bridges.indexOf(bridge.stop),1);
  }
  assert.deepEqual(errors,[]);
  const report={pass:true,criteria:'Real Chrome browser and owned native client share a dedicated Rust server, both move/fire and receive authoritative acknowledgements, under local and delayed/jittered WebSockets.',results,errors};
  await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}finally{
  currentNative?.kill('SIGTERM');for(const stop of bridges)await stop();
  socket?.close();chrome.kill('SIGTERM');server.kill('SIGTERM');
  for(const task of pending.values()){clearTimeout(task.timer);task.reject(new Error('Browser closed'));}
}
