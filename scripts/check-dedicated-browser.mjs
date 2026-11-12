import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import WebSocket from 'ws';
const arg=(flag,fallback)=>{const i=process.argv.indexOf(flag);return i<0?fallback:process.argv[i+1];},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ringMode=process.argv.includes('--fire-ring');
const binary=resolve(arg('--binary','dedicated-server/target/release/wild-wheels-server')),output=arg('--output',join(tmpdir(),'wild-wheels-dedicated-browser.json'));
const wait=async(fn,message,ms=10000)=>{const end=performance.now()+ms;while(performance.now()<end){try{if(await fn())return;}catch{}await sleep(50);}throw new Error(message);};
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin=`http://127.0.0.1:${port}`;
const server=spawn(binary,[],{cwd:tmpdir(),env:{...process.env,BIND:'127.0.0.1',PORT:String(port),BOTS:'0'},stdio:['ignore','pipe','pipe']});let serverLog='';server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
const profile=await mkdtemp(join(tmpdir(),'wild-wheels-dedicated-chrome-'));
const chrome=spawn(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--window-size=1100,850','about:blank'],{stdio:['ignore','ignore','pipe']});let chromeLog='',ws,id=0;const pending=new Map(),errors=[],contexts=[];chrome.stderr.on('data',b=>chromeLog+=b);
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const number=++id,timer=setTimeout(()=>{pending.delete(number);reject(new Error('CDP timeout: '+method));},15000);pending.set(number,{resolve,reject,timer});ws.send(JSON.stringify({id:number,method,params,...(sessionId?{sessionId}:{})}));});}
async function evaluate(session,expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},session);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;}
try{
  await wait(async()=>{try{return(await fetch(origin+'/healthz')).ok;}catch{return false;}},'Native server did not start');
  await wait(()=>/DevTools listening on (ws:\/\/[^\s]+)/.test(chromeLog),'Chrome did not start');ws=new WebSocket(chromeLog.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);await new Promise(r=>ws.once('open',r));
  ws.on('message',async bytes=>{const msg=JSON.parse(bytes);if(msg.id){const task=pending.get(msg.id);if(!task)return;pending.delete(msg.id);clearTimeout(task.timer);if(msg.error)task.reject(new Error(JSON.stringify(msg.error)));else task.resolve(msg.result);return;}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description??msg.params.exceptionDetails.text);
    if(msg.method==='Fetch.requestPaused'){try{const {requestId}=msg.params;const reply=await call('Fetch.getResponseBody',{requestId},msg.sessionId);const source=Buffer.from(reply.body,reply.base64Encoded?'base64':'utf8').toString()+'\nglobalThis.__game={network,renderer,keys,get race(){return race}};';await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(source).toString('base64')},msg.sessionId);}catch(e){errors.push(e.message);}}
  });
  const sessions=[];for(let index=0;index<2;index++){
    const {browserContextId}=await call('Target.createBrowserContext');contexts.push(browserContextId);const {targetId}=await call('Target.createTarget',{url:'about:blank',browserContextId});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});sessions.push(sessionId);
    await call('Runtime.enable',{},sessionId);await call('Page.enable',{},sessionId);await call('Fetch.enable',{patterns:[{urlPattern:'*/game.js',requestStage:'Response'}]},sessionId);await call('Page.navigate',{url:origin},sessionId);
    await wait(()=>evaluate(sessionId,'Boolean(globalThis.__game?.network.active&&__game.network.state)'),`Browser ${index} failed to auto-join`);
  }
  const [host,guest]=sessions;await wait(()=>evaluate(host,'__game.network.state.players.length===2'),'Roster did not update');
  assert.equal(await evaluate(host,'__game.network.state.you'),0);assert.equal(await evaluate(guest,'__game.network.state.you'),1);
  for(const session of sessions){assert.equal(await evaluate(session,"getComputedStyle(document.querySelector('.mode-switch')).display"),'none');assert.equal(await evaluate(session,'__game.race.mode'),'combat');}
  assert.equal(await evaluate(host,'__game.network.dedicated'),true);assert.equal(await evaluate(host,"__game.network.hostButton.classList.contains('hidden')"),true);
  await evaluate(host,`(async()=>{const n=__game.network;n.name.value='Ubuntu Pilot';n.name.dispatchEvent(new Event('input'));await n.saveName();await n.request('/api/driver',{driver:10});await n.control('bots',undefined,${ringMode?0:6});})()`);
  await wait(()=>evaluate(guest,`__game.network.state.world.bots.length===${ringMode?1:7}`),'Eight-actor roster did not arrive');
  await evaluate(guest,'__game.network.requestPlay()');await wait(()=>evaluate(host,'__game.network.readyDialog.open'),'Host did not see guest play request');
  await wait(()=>evaluate(guest,"__game.race.phase==='racing'"),'Native auto-start did not reach browser',8000);
  const before=await evaluate(guest,'({x:__game.race.wx,z:__game.race.wz})');await evaluate(guest,"__game.keys.add('w')");await sleep(350);const after=await evaluate(guest,'({x:__game.race.wx,z:__game.race.wz})');assert.ok(Math.hypot(after.x-before.x,after.z-before.z)>.1,'Keyboard movement did not reach the native game');await evaluate(guest,"__game.keys.clear()");
  await wait(()=>evaluate(guest,"Boolean(__game.network.action('fire'))"),'Shot never became ready');
  await wait(()=>evaluate(guest,'__game.network.state.actionSequence>=0'),'Shot action was not acknowledged');
  if(ringMode){
    await evaluate(host,"__game.keys.add('w');__game.keys.add('shift');__game.keys.add('arrowright')");
    await wait(()=>evaluate(host,"__game.race.effects.some(f=>f.type==='fireRing')"),'Charged drift failed to ignite ring');
    await wait(()=>evaluate(guest,"__game.race.effects.some(f=>f.type==='fireRing')"),'Guest did not see the fire ring');
    await wait(()=>evaluate(host,"!document.getElementById('ring-of-fire-announcement').classList.contains('hidden')"),'Fiery ignition announcement did not appear');
    assert.equal(await evaluate(guest,"document.getElementById('ring-of-fire-announcement').classList.contains('hidden')"),true);
    assert.equal(await evaluate(host,"document.getElementById('ring-of-fire-announcement').classList.contains('blue-fire')"),true);
    assert.equal(await evaluate(guest,"__game.race.effects.find(f=>f.type==='fireRing').color"),'#4abaff');
    await evaluate(host,"document.getElementById('game').scrollIntoView({block:'center'})");
    const shot=await call('Page.captureScreenshot',{format:'png'},host);await writeFile(output+'.png',Buffer.from(shot.data,'base64'));
    await evaluate(host,'__game.keys.clear()');await wait(()=>evaluate(guest,"!__game.race.effects.some(f=>f.type==='fireRing')"),'Fire ring persisted after stopping');
  }
  for(const session of sessions)assert.equal(await evaluate(session,'__game.renderer.gl.getError()'),0);
  const beforeRefresh=await evaluate(host,'({id:__game.network.state.you,epoch:__game.race.soundEpoch,name:__game.race.name})');await call('Page.reload',{},host);await wait(()=>evaluate(host,'Boolean(globalThis.__game?.network.active&&__game.network.state)'), 'Refresh failed to rejoin');const refreshed=await evaluate(host,'({id:__game.network.state.you,epoch:__game.race.soundEpoch,name:__game.race.name})');assert.deepEqual(refreshed,beforeRefresh);
  await call('Target.disposeBrowserContext',{browserContextId:contexts.pop()});await wait(()=>evaluate(host,'__game.network.isHost'),'Lobby controls did not transfer after disconnect');
  assert.deepEqual(errors,[]);const report={pass:true,browsers:2,activeActors:ringMode?2:8,fireRing:ringMode,automaticJoin:true,nativeAutoStart:true,keyboardMovement:true,shotAcknowledged:true,refreshPreservesIdentity:true,hostTransfer:true,errors};await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(e){console.error(serverLog);throw e;}finally{for(const browserContextId of contexts){try{await call('Target.disposeBrowserContext',{browserContextId});}catch{}}ws?.close();chrome.kill('SIGTERM');server.kill('SIGTERM');}
