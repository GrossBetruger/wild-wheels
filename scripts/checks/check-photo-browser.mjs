import {createGameServer} from '../../server.js';
import {arenaFixture} from '../helpers/arena-fixture.mjs';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
const arg=(flag,fallback)=>{const i=process.argv.indexOf(flag);return i<0?fallback:process.argv[i+1];},sleep=ms=>new Promise(r=>setTimeout(r,ms));
const output=arg('--output',join(tmpdir(),'wild-wheels-photos-browser.json'));
const wait=async(fn,message,ms=10000)=>{const end=performance.now()+ms;while(performance.now()<end){try{if(await fn())return;}catch{}await sleep(50);}throw new Error(message);};
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const origin=`http://127.0.0.1:${port}`;
const app=createGameServer({fixtureWorld:arenaFixture}),server=app.server;
await new Promise(r=>server.listen(port,'127.0.0.1',r));let serverLog='';
const created=await(await fetch(origin+'/api/rooms',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'Host',driver:0,arena:0,bots:0})})).json();
const room=app.multiplayer.rooms.get(created.code);

const profile=await mkdtemp(join(tmpdir(),'wild-wheels-dedicated-chrome-'));
const chrome=spawn(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--window-size=1100,850','about:blank'],{stdio:['ignore','ignore','pipe']});let chromeLog='',ws,id=0;const pending=new Map(),errors=[],contexts=[];chrome.stderr.on('data',b=>chromeLog+=b);
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const number=++id,timer=setTimeout(()=>{pending.delete(number);reject(new Error('CDP timeout: '+method));},15000);pending.set(number,{resolve,reject,timer});ws.send(JSON.stringify({id:number,method,params,...(sessionId?{sessionId}:{})}));});}
async function evaluate(session,expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},session);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;}
try{
  await wait(async()=>{try{return(await fetch(origin+'/api/info')).ok;}catch{return false;}},'Photo test server did not start');
  await wait(()=>/DevTools listening on (ws:\/\/[^\s]+)/.test(chromeLog),'Chrome did not start');ws=new WebSocket(chromeLog.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);await new Promise(r=>ws.once('open',r));
  ws.on('message',async bytes=>{const msg=JSON.parse(bytes);if(msg.id){const task=pending.get(msg.id);if(!task)return;pending.delete(msg.id);clearTimeout(task.timer);if(msg.error)task.reject(new Error(JSON.stringify(msg.error)));else task.resolve(msg.result);return;}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.exception?.description??msg.params.exceptionDetails.text);
    if(msg.method==='Fetch.requestPaused'){try{const {requestId}=msg.params;const reply=await call('Fetch.getResponseBody',{requestId},msg.sessionId);const source=Buffer.from(reply.body,reply.base64Encoded?'base64':'utf8').toString()+'\nglobalThis.__game={network,renderer,keys,audio,photography,get race(){return race}};';await call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(source).toString('base64')},msg.sessionId);}catch(e){errors.push(e.message);}}
  });
  const sessions=[];for(let index=0;index<2;index++){
    const {browserContextId}=await call('Target.createBrowserContext');contexts.push(browserContextId);const {targetId}=await call('Target.createTarget',{url:'about:blank',browserContextId});const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});sessions.push(sessionId);
    await call('Runtime.enable',{},sessionId);await call('Page.enable',{},sessionId);await call('Fetch.enable',{patterns:[{urlPattern:'*/game.js',requestStage:'Response'}]},sessionId);if(index===0)await call('Network.setCookie',{name:'wild-wheels-session',value:created.token,url:origin},sessionId);
    if(index===1){await call('Emulation.setDeviceMetricsOverride',{width:430,height:900,deviceScaleFactor:1,mobile:true},sessionId);await call('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5},sessionId);}
    await call('Page.navigate',{url:origin+'/?room='+created.code},sessionId);
    if(index===1){
      await wait(()=>evaluate(sessionId,'Boolean(globalThis.__game?.network.nameFields.some(input=>input.getClientRects().length))'),'New bomber did not see name entry');
      await evaluate(sessionId,"(async()=>{const n=__game.network,input=n.nameFields.find(input=>input.getClientRects().length);input.value='BomberCam';input.dispatchEvent(new Event('input',{bubbles:true}));await n.connect('/api/join');if(!n.state)throw new Error('Bomber could not join: '+n.status.textContent);})()");
    }
    await wait(()=>evaluate(sessionId,'Boolean(globalThis.__game?.network.active&&__game.network.state)'),`Browser ${index} failed to auto-join`);
  }
  const [host,guest]=sessions;
  await wait(()=>evaluate(guest,'__game.race.bomber'),'Phone did not become a bomber');
  await evaluate(guest,"__game.network.request('/api/name',{name:'BomberCam'})");
  for(const session of sessions)await evaluate(session,"{const original=__game.audio.event.bind(__game.audio);__game.photoSounds=[];__game.audio.event=kind=>{__game.photoSounds.push(kind);return original(kind);};}");
  await evaluate(host,"__game.network.control('start')");await wait(()=>evaluate(guest,"__game.race.phase==='racing'"),'Match did not start');
  const before=await evaluate(guest,'({bomb:__game.race.bombAmmo,stink:__game.race.stinkAmmo})');
  for(let photo=0;photo<3;photo++){
    if(photo===1)await evaluate(guest,"document.getElementById('bomber-view-map').click()");
    if(photo===2)await evaluate(guest,"document.getElementById('bomber-view-3d').click();document.getElementById('bomber-zoom-in').click()");
    await wait(()=>evaluate(guest,"!document.getElementById('take-photo').disabled"),'Camera did not become ready');
    await evaluate(guest,"document.getElementById('take-photo').click()");
    await wait(()=>room.photoAlbum.photos.length===photo+1,'Camera upload failed');
  }
  const after=await evaluate(guest,'({bomb:__game.race.bombAmmo,stink:__game.race.stinkAmmo})');assert.ok(after.bomb>=before.bomb&&after.stink>=before.stink,'Camera spent bomb ammunition');
  for(const photo of room.photoAlbum.photos){
    const url='data:image/jpeg;base64,'+Buffer.from(photo.bytes).toString('base64');
    const colors=await evaluate(guest,`(async()=>{const image=new Image();image.src=${JSON.stringify(url)};await image.decode();const c=document.createElement('canvas');c.width=image.width;c.height=image.height;const g=c.getContext('2d');g.drawImage(image,0,0);const p=g.getImageData(0,0,c.width,c.height).data,set=new Set();for(let i=0;i<p.length;i+=16)set.add(p[i]*65536+p[i+1]*256+p[i+2]);return set.size;})()`);assert.ok(colors>30,'Photograph was blank');
  }
  assert.notDeepEqual(room.photoAlbum.photos[0].bytes,room.photoAlbum.photos[1].bytes,'3D and 2D photos should differ');
  room.world.phase='finished';room.world.finishRank=1;room.world.finishTime=room.world.elapsed;room.world.finishCountdown=0;app.multiplayer.broadcast(room);
  for(const session of sessions)await wait(()=>evaluate(session,"!document.getElementById('photo-slideshow').classList.contains('hidden')&&document.querySelector('#photo-slideshow img').naturalWidth>0"),'A player did not see the slideshow');
  const first=await evaluate(host,"document.querySelector('#photo-slideshow img').src");assert.equal(await evaluate(guest,"document.querySelector('#photo-slideshow img').src"),first);
  await wait(()=>evaluate(host,`document.querySelector('#photo-slideshow img').src!==${JSON.stringify(first)}`),'Photo reel did not advance',6000);
  assert.equal(await evaluate(guest,"__game.photoSounds.filter(k=>k==='cameraShutter').length"),3);
  for(const session of sessions)assert.ok(await evaluate(session,"__game.photoSounds.filter(k=>k==='photoSlide').length>=2"));
  await evaluate(host,"__game.photography.advance(1)");await sleep(100);const manual=await evaluate(host,"document.querySelector('#photo-slideshow img').src");await wait(()=>evaluate(host,`document.querySelector('#photo-slideshow img').src!==${JSON.stringify(manual)}`),'Slideshow stopped after manual browsing',6000);
  await evaluate(host,"document.getElementById('photo-slideshow').scrollIntoView({block:'center'})");
  const screenshot=await call('Page.captureScreenshot',{format:'png'},host);await writeFile(output+'.png',Buffer.from(screenshot.data,'base64'));
  await evaluate(host,"__game.network.control('reset')");await wait(()=>evaluate(guest,"document.getElementById('photo-slideshow').classList.contains('hidden')&&__game.photography.photos.length===0"),'Next match retained the old gallery');
  assert.deepEqual(errors,[]);const report={pass:true,photos:3,nonblankCapture:true,threeDAndMap:true,ammoUnchanged:true,sharedSlideshow:true,slideshowAdvances:true,shutterAndSlideSounds:true,nextMatchClearsAlbum:true,errors};await writeFile(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));

}catch(e){console.error(serverLog);throw e;}finally{for(const browserContextId of contexts){try{await call('Target.disposeBrowserContext',{browserContextId});}catch{}}ws?.close();chrome.kill('SIGTERM');app.multiplayer.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
