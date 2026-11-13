import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import WebSocket from 'ws';
import {createGameServer} from '../../server.js';

const app=createGameServer();
await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${app.server.address().port}`;
const profile=await mkdtemp(join(tmpdir(),'wild-wheels-chat-browser-'));
const chrome=spawn(process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profile}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--window-size=1200,1000','about:blank'],{stdio:['ignore','ignore','pipe']});
let logs='',socket,sequence=0;
chrome.stderr.on('data',data=>logs+=data);
const pending=new Map(),contexts=[],errors=[];
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function wait(check,message){for(let n=0;n<150;n++){if(await check())return;await sleep(100);}throw new Error(message);}
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const id=++sequence;const timer=setTimeout(()=>{pending.delete(id);reject(new Error(`Timeout: ${method}`));},15000);pending.set(id,{resolve,reject,timer});socket.send(JSON.stringify({id,method,params,...(sessionId?{sessionId}:{})}));});}
async function evaluate(session,expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true},session);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;}
async function post(path,body,token){const response=await fetch(origin+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});assert.equal(response.status,200);return response.json();}
try{
  const host=await post('/api/rooms',{name:'Alice',driver:0,arena:0,bots:0});
  const bob=await post('/api/join',{name:'Bob',driver:1,code:host.code});
  const eve=await post('/api/join',{name:'Eve',driver:2,code:host.code});
  await wait(()=>/DevTools listening on (ws:\/\/[^\s]+)/.test(logs),'Chrome did not start');
  socket=new WebSocket(logs.match(/DevTools listening on (ws:\/\/[^\s]+)/)[1]);await new Promise(resolve=>socket.once('open',resolve));
  socket.on('message',bytes=>{const message=JSON.parse(bytes);if(message.id){const task=pending.get(message.id);if(!task)return;pending.delete(message.id);clearTimeout(task.timer);if(message.error)task.reject(new Error(JSON.stringify(message.error)));else task.resolve(message.result);}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description??message.params.exceptionDetails.text);});
  const sessions=[];
  for(const player of [host,bob,eve]){
    const {browserContextId}=await call('Target.createBrowserContext');contexts.push(browserContextId);
    const {targetId}=await call('Target.createTarget',{url:'about:blank',browserContextId});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});sessions.push(sessionId);
    await call('Runtime.enable',{},sessionId);await call('Page.enable',{},sessionId);
    await call('Network.setCookie',{name:'wild-wheels-session',value:player.token,url:origin},sessionId);
    await call('Page.navigate',{url:`${origin}/?room=${host.code}`},sessionId);
  }
  const [alice,bobSession,eveSession]=sessions;
  for(const session of sessions)await wait(()=>evaluate(session,"document.querySelector('.chat-compose input')?.disabled===false && document.querySelector('.chat-recipient select').options.length===3"),'Chat did not connect');
  async function choose(session,to=''){
    await evaluate(session,`document.querySelector('.chat-tab[data-conversation="${to}"]').click()`);
  }
  async function send(session,text,to=''){
    await choose(session,to);
    await wait(()=>evaluate(session,"!document.querySelector('.chat-compose button').disabled"),'Send button did not become available');
    await evaluate(session,`{const form=document.querySelector('.chat-compose');form.querySelector('input').value=${JSON.stringify(text)};form.requestSubmit();}`);
    await wait(()=>evaluate(session,"document.querySelector('.chat-compose input').value===''") ,'Message was not sent');
  }
  await send(alice,'Hello everyone');
  for(const session of sessions)await wait(()=>evaluate(session,"document.querySelector('.chat-messages').textContent.includes('Hello everyone')"),'Public message missing');
  await send(alice,'<b>Private hello</b>',String(bob.you));
  await choose(bobSession,String(host.you));
  await wait(()=>evaluate(bobSession,"document.querySelector('.chat-messages').textContent.includes('<b>Private hello</b>')"),'Private message missing');
  assert.equal(await evaluate(eveSession,"document.querySelector('.chat-messages').textContent.includes('Private hello')"),false);
  assert.equal(await evaluate(bobSession,"document.querySelector('.chat-messages b')!==null"),false,'Message text became HTML');
  await evaluate(bobSession,"document.querySelector('.chat-other .chat-reply-button').click()");
  await send(bobSession,'Private reply',String(host.you));
  await wait(()=>evaluate(alice,"document.querySelector('.chat-messages').textContent.includes('Private reply')"),'Private reply missing');
  assert.equal(await evaluate(eveSession,"document.querySelector('.chat-messages').textContent.includes('Private reply')"),false);
  assert.equal(await evaluate(alice,"document.querySelector('.chat-quote').textContent.includes('Private hello')"),true,'Reply quote missing');
  await choose(alice);
  assert.equal(await evaluate(alice,"document.querySelector('.chat-messages').textContent.includes('Private hello')"),false,'Private messages leaked into Everyone');
  assert.equal(await evaluate(alice,"document.querySelector('.chat-messages').textContent.includes('Hello everyone')"),true);
  await choose(alice,String(eve.you));
  assert.equal(await evaluate(alice,"document.querySelector('.chat-messages').textContent.includes('Private reply')"),false,'Bob messages leaked into Eve conversation');
  await choose(alice,String(bob.you));
  await send(eveSession,'Only Alice and Eve',String(host.you));
  await wait(()=>evaluate(alice,"!document.querySelector('.chat-notification').classList.contains('hidden')"),'New-message notification missing');
  assert.equal(await evaluate(alice,`document.querySelector('.chat-tab[data-conversation="${eve.you}"] .chat-unread').textContent==='1'`),true,'Unread badge missing');
  await evaluate(alice,"document.querySelector('.chat-notification').click()");
  await wait(()=>evaluate(alice,"document.querySelector('.chat-messages').textContent.includes('Only Alice and Eve')"),'Second private conversation missing');
  await choose(alice,String(bob.you));
  assert.equal(await evaluate(alice,"document.querySelector('.chat-messages').textContent.includes('Private reply')"),true,'Private history missing after switching');
  assert.equal(await evaluate(alice,"document.querySelector('.chat-messages').textContent.includes('Only Alice and Eve')"),false);
  await evaluate(alice,"document.querySelector('.chat-compose input').value='Draft for Bob'");
  await choose(alice);await sleep(1700);await choose(alice,String(bob.you));
  assert.equal(await evaluate(alice,"document.querySelector('.chat-compose input').value"),'Draft for Bob');
  await evaluate(alice,"document.querySelector('.chat-compose input').value=''");
  await wait(()=>evaluate(alice,"!document.querySelector('.chat-own .chat-delete').disabled"),'Delete did not become available');
  await evaluate(alice,"document.querySelector('.chat-own .chat-delete').click()");
  await wait(()=>evaluate(alice,"document.querySelector('.chat-deleted')?.textContent==='Message deleted'"),'Own message was not deleted');
  await wait(()=>evaluate(bobSession,"document.querySelector('.chat-deleted')?.textContent==='Message deleted'"),'Deletion did not reach recipient');
  assert.equal(await evaluate(alice,"document.querySelector('.chat-quote').textContent"),'Message deleted');
  assert.equal(await evaluate(alice,"document.querySelector('.race-panel').nextElementSibling.classList.contains('chat-panel')"),true);
  assert.equal(await evaluate(alice,"(()=>{const game=document.querySelector('.race-panel').getBoundingClientRect(),chat=document.querySelector('.chat-panel').getBoundingClientRect();return chat.top-game.bottom<=20&&Math.abs(chat.width-game.width)<2;})()"),true,'Chat is not directly beneath the game');
  assert.equal(await evaluate(alice,"document.querySelector('.chat-recipient').getBoundingClientRect().bottom < document.querySelector('.chat-messages').getBoundingClientRect().top"),true);
  assert.equal(await evaluate(alice,"document.querySelector('.chat-compose button').getAttribute('aria-label')"),'Send message');
  if(process.argv.includes('--screenshot')){
    await evaluate(alice,"document.querySelector('.chat-panel').scrollIntoView({block:'center'})");
    const {data}=await call('Page.captureScreenshot',{format:'png'},alice);const path=join(profile,'chat-desktop.png');await writeFile(path,Buffer.from(data,'base64'));console.log(`Desktop screenshot: ${path}`);
  }
  await evaluate(alice,"document.querySelector('.chat-compose input').focus()");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter'},alice);
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter'},alice);
  assert.equal(app.multiplayer.rooms.get(host.code).core.status.phase,'ready','Typing started the game');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true},alice);
  assert.equal(await evaluate(alice,"document.querySelector('.chat-panel').getBoundingClientRect().right<=innerWidth"),true,'Chat overflows a mobile screen');
  assert.deepEqual(errors,[]);
  if(process.argv.includes('--screenshot')){
    await evaluate(alice,"document.querySelector('.chat-panel').scrollIntoView()");
    const {data}=await call('Page.captureScreenshot',{format:'png'},alice);const path=join(profile,'chat.png');await writeFile(path,Buffer.from(data,'base64'));console.log(`Screenshot: ${path}`);
  }
  console.log('Chat browser checks passed: public delivery, separate public and private conversations, replies and history, safe text, keyboard isolation, placement, and mobile width.');
}finally{
  for(const browserContextId of contexts)try{await call('Target.disposeBrowserContext',{browserContextId});}catch{}
  socket?.close();chrome.kill('SIGTERM');app.multiplayer.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));
}
