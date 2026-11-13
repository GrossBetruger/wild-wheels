import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import WebSocket from 'ws';
const arg=(flag,fallback)=>{const i=process.argv.indexOf(flag);return i<0?fallback:process.argv[i+1];},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const ringMode=process.argv.includes('--fire-ring'),cameraMode=process.argv.includes('--camera');
const binary=resolve(arg('--binary','dedicated-server/target/release/wild-wheels-server')),output=arg('--output',join(tmpdir(),'wild-wheels-dedicated-browser.json'));
const wait=async(fn,message,ms=10000)=>{const end=performance.now()+ms;while(performance.now()<end){try{if(await fn())return;}catch{}await sleep(50);}throw new Error(message);};
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin=`http://127.0.0.1:${port}`;
const stateDirectory=await mkdtemp(join(tmpdir(),'wild-wheels-native-browser-state-'));
const server=spawn(binary,[],{cwd:stateDirectory,env:{...process.env,WILD_WHEELS_SESSION_FILE:join(stateDirectory,'sessions.json'),BIND:'127.0.0.1',PORT:String(port),BOTS:'0'},stdio:['ignore','pipe','pipe']});let serverLog='';server.stdout.on('data',b=>serverLog+=b);server.stderr.on('data',b=>serverLog+=b);
const profile=await mkdtemp(join(tmpdir(),'wild-wheels-dedicated-chrome-'));
const chrome=spawn(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--window-size=1100,850','about:blank'],{stdio:['ignore','ignore','pipe']});let chromeLog='',ws,id=0,slowBoot=true,failJoinOnce=true;const pending=new Map(),errors=[],contexts=[];chrome.stderr.on('data',b=>chromeLog+=b);
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const number=++id,timer=setTimeout(()=>{pending.delete(number);reject(new Error('CDP timeout: '+method));},15000);pending.set(number,{resolve,reject,timer});ws.send(JSON.stringify({id:number,method,params,...(sessionId?{sessionId}:{})}));});}
async function evaluate(session,expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},session);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;}
try{
  await wait(async()=>{try{return(await fetch(origin+'/healthz')).ok;}catch{return false;}},'Native server did not start');
  await wait(()=>/DevTools listening on (ws:\/\/[^\s]+)/.test(chromeLog),'Chrome did not start');ws=new WebSocket(chromeLog.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);await new Promise(r=>ws.once('open',r));
  ws.on('message',async bytes=>{const msg=JSON.parse(bytes);if(msg.id){const task=pending.get(msg.id);if(!task)return;pending.delete(msg.id);clearTimeout(task.timer);if(msg.error)task.reject(new Error(JSON.stringify(msg.error)));else task.resolve(msg.result);return;}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description??msg.params.exceptionDetails.text);
    if(msg.method==='Fetch.requestPaused'){try{const {requestId,request}=msg.params;if(new URL(request.url).pathname==='/api/join'){if(failJoinOnce){failJoinOnce=false;await call('Fetch.fulfillRequest',{requestId,responseCode:503,responseHeaders:[{name:'Content-Type',value:'application/json'}],body:Buffer.from(JSON.stringify({error:'Temporary test connection failure'})).toString('base64')},msg.sessionId);return;}await call('Fetch.continueRequest',{requestId},msg.sessionId);return;}if(slowBoot){slowBoot=false;await sleep(1500);}const reply=await call('Fetch.getResponseBody',{requestId},msg.sessionId);const source=Buffer.from(reply.body,reply.base64Encoded?'base64':'utf8').toString()+'\nglobalThis.__game={network,renderer,keys,photography,get race(){return race}};';await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(source).toString('base64')},msg.sessionId);}catch(e){errors.push(e.message);}}
  });
  const sessions=[];for(let index=0;index<2;index++){
    const {browserContextId}=await call('Target.createBrowserContext');contexts.push(browserContextId);const {targetId}=await call('Target.createTarget',{url:'about:blank',browserContextId});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});sessions.push(sessionId);
    await call('Runtime.enable',{},sessionId);await call('Page.enable',{},sessionId);await call('Fetch.enable',{patterns:[{urlPattern:'*/game.js',requestStage:'Response'},{urlPattern:'*/api/join',requestStage:'Request'}]},sessionId);if(cameraMode&&index===1){await call('Emulation.setDeviceMetricsOverride',{width:430,height:900,deviceScaleFactor:1,mobile:true},sessionId);await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5},sessionId);}
    await call('Page.navigate',{url:origin},sessionId);
    if(index===0){
      await wait(()=>evaluate(sessionId,"Boolean(document.getElementById('arena-connection'))&&getComputedStyle(document.getElementById('arena-connection')).display==='flex'&&getComputedStyle(document.getElementById('start')).visibility==='hidden'"),'First paint exposed the inactive game instead of the connection screen');
      const loading=await call('Page.captureScreenshot',{format:'png'},sessionId);await writeFile(output+'.loading.png',Buffer.from(loading.data,'base64'));
      await wait(()=>evaluate(sessionId,"document.querySelector('#arena-connection p').textContent==='Temporary test connection failure'&&!document.querySelector('#arena-connection button').classList.contains('hidden')"),'Failed join did not show a retry action');
      assert.equal(await evaluate(sessionId,"getComputedStyle(document.getElementById('start')).visibility"),'hidden');
      await evaluate(sessionId,"document.querySelector('#arena-connection button').click()");
    }
    await wait(()=>evaluate(sessionId,'Boolean(globalThis.__game?.network.active&&__game.network.state)'),`Browser ${index} failed to auto-join`);
    await wait(()=>evaluate(sessionId,"document.body.classList.contains('arena-connected')&&getComputedStyle(document.getElementById('arena-connection')).display==='none'"),'Connected arena did not replace the connection screen');
  }
  const [host,guest]=sessions;await wait(()=>evaluate(host,'__game.network.state.players.length===2'),'Roster did not update');
  assert.equal(await evaluate(host,'__game.network.state.you'),0);assert.equal(await evaluate(guest,'__game.network.state.you'),1);
  for(const session of sessions){assert.equal(await evaluate(session,"getComputedStyle(document.querySelector('.mode-switch')).display"),'none');assert.equal(await evaluate(session,'__game.race.mode'),'combat');}
  assert.equal(await evaluate(host,'__game.network.dedicated'),true);assert.equal(await evaluate(host,"__game.network.hostButton.classList.contains('hidden')"),true);
  await evaluate(host,`(async()=>{const n=__game.network;n.name.value='Ubuntu Pilot';n.name.dispatchEvent(new Event('input'));await n.saveName();await n.request('/api/driver',{driver:10});await n.control('bots',undefined,${ringMode||cameraMode?0:6});})()`);
  await wait(()=>evaluate(host,"Array.from(document.querySelectorAll('.preview-ability-entry>strong')).map(n=>n.textContent).join('|')==='REEFER MADNESS|RING OF FIRE'"),'Yuda abilities did not have separate titles');
  await wait(()=>evaluate(guest,`__game.network.state.world.bots.length===${ringMode||cameraMode?1:7}`),'Eight-actor roster did not arrive');
  for(const session of sessions){
    assert.equal(await evaluate(session,'__game.network.state.host'),null);assert.equal(await evaluate(session,'__game.network.canConfigure'),true);
    assert.equal(await evaluate(session,"Boolean(document.querySelector('#play-request-popup'))"),false);
    assert.equal(await evaluate(session,"getComputedStyle(document.getElementById('restart')).display"),'none');
    assert.equal(await evaluate(session,"getComputedStyle(document.getElementById('change-track')).display"),'none');
    assert.equal(await evaluate(session,"document.querySelector('.network-players').textContent.includes('HOST')"),false);
    assert.equal(await evaluate(session,"__game.network.botCount.disabled||__game.network.abilities.disabled"),false);
    assert.equal(await evaluate(session,"getComputedStyle(__game.network.share.parentElement).display==='none'"),false);
  }
  await evaluate(guest,"document.getElementById('start').click()");

  await wait(()=>evaluate(guest,"__game.race.phase==='racing'"),'Second player could not start the match',8000);
  for(const session of sessions)assert.equal(await evaluate(session,'__game.network.canConfigure'),false);
  if(!cameraMode){
  const before=await evaluate(guest,'({x:__game.race.wx,z:__game.race.wz})');await evaluate(guest,"__game.keys.add('w')");await sleep(350);const after=await evaluate(guest,'({x:__game.race.wx,z:__game.race.wz})');assert.ok(Math.hypot(after.x-before.x,after.z-before.z)>.1,'Keyboard movement did not reach the native game');await evaluate(guest,"__game.keys.clear()");
  await wait(()=>evaluate(guest,"Boolean(__game.network.action('fire'))"),'Shot never became ready');
  await wait(()=>evaluate(guest,'__game.network.state.actionSequence>=0'),'Shot action was not acknowledged');
  }
  if(cameraMode){
    await wait(()=>evaluate(guest,'__game.race.bomber'),'Mobile player did not become a bomber');
    await evaluate(guest,"{const original=window.fetch;window.fetch=async(url,options)=>{const response=await original(url,options);if(url==='/api/photos'&&options?.method==='POST')__game.cameraUpload={status:response.status,bytes:options.body.size};return response;};document.getElementById('take-photo').click();}");
    await wait(()=>evaluate(guest,'__game.photography.count===1'),'Native camera upload failed');
    const uploaded=await evaluate(guest,'__game.cameraUpload');assert.equal(uploaded.status,200);assert.ok(uploaded.bytes>2048,'Native photo upload must use the larger image body allowance');
  }

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
    await evaluate(host,'__game.keys.clear()');
    await wait(()=>evaluate(guest,"__game.race.effects.some(f=>f.type==='fireRingOut')"),'Manual release did not extinguish for the guest');
    assert.equal(await evaluate(guest,"__game.race.effects.some(f=>f.type==='fireRing')"),false);
    assert.equal(await evaluate(guest,"__game.race.effects.find(f=>f.type==='fireRingOut').color"),'#4abaff');
    await sleep(200);const extinguish=await call('Page.captureScreenshot',{format:'png'},host);await writeFile(output+'.extinguish.png',Buffer.from(extinguish.data,'base64'));
    await wait(()=>evaluate(guest,"!__game.race.effects.some(f=>f.type==='fireRingOut')"),'Extinguishing smoke did not clear');
    await evaluate(host,"__game.keys.add('w');__game.keys.add('shift');__game.keys.add('arrowright')");
    await wait(()=>evaluate(guest,"__game.race.effects.some(f=>f.type==='fireRing')"),'Second charged drift did not ignite');
    await wait(()=>evaluate(guest,"(__game.race.effects.find(f=>f.type==='fireRing')?.radius??0)>=39.5"),'Remote fire ring did not grow toward radius 40',21000);
    await wait(()=>evaluate(guest,"__game.race.effects.some(f=>f.type==='fireRingOut')"),'Twenty-second expiry did not extinguish');
    assert.equal(await evaluate(guest,"__game.race.effects.find(f=>f.type==='fireRingOut').radius"),40);
    await evaluate(host,'__game.keys.clear()');

  }
  for(const session of sessions)assert.equal(await evaluate(session,'__game.renderer.gl.getError()'),0);
  const beforeRefresh=await evaluate(host,'({id:__game.network.state.you,epoch:__game.race.soundEpoch,name:__game.race.name})');await call('Page.reload',{},host);await wait(()=>evaluate(host,'Boolean(globalThis.__game?.network.active&&__game.network.state)'), 'Refresh failed to rejoin');const refreshed=await evaluate(host,'({id:__game.network.state.you,epoch:__game.race.soundEpoch,name:__game.race.name})');assert.deepEqual(refreshed,beforeRefresh);
  await call('Target.disposeBrowserContext',{browserContextId:contexts.pop()});await wait(()=>evaluate(host,'__game.network.state.players.find(p=>p.id===1)?.afk'),'Disconnected player did not become AFK');
  assert.equal(await evaluate(host,'__game.network.state.host'),null);
  const epoch=await evaluate(host,'__game.race.soundEpoch');await evaluate(host,"document.getElementById('pause').click()");await wait(()=>evaluate(host,'__game.network.afk'),'AFK button did not mark the player away');
  assert.equal(await evaluate(host,"__game.race.phase==='paused'&&document.getElementById('status').textContent.includes('AFK')"),true);
  await evaluate(host,"document.getElementById('start').click()");await wait(()=>evaluate(host,'!__game.network.afk&&__game.race.phase==="racing"'),'Returning from AFK did not resume the same match');assert.equal(await evaluate(host,'__game.race.soundEpoch'),epoch);

  assert.deepEqual(errors,[]);const report={pass:true,browsers:2,activeActors:ringMode||cameraMode?2:8,fireRing:ringMode,automaticJoin:true,firstPaintShowsConnection:true,failedJoinRetry:true,anyPlayerStarts:true,keyboardMovement:!cameraMode,shotAcknowledged:!cameraMode,cameraUpload:cameraMode,refreshPreservesIdentity:true,noCaptain:true,sharedControls:true,afkPreservesMatch:true,errors};await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
}catch(e){console.error(serverLog);throw e;}finally{for(const browserContextId of contexts){try{await call('Target.disposeBrowserContext',{browserContextId});}catch{}}ws?.close();chrome.kill('SIGTERM');const exited=server.exitCode!==null||server.signalCode!==null?Promise.resolve():new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await exited;await rm(stateDirectory,{recursive:true,force:true});}
