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
  const host=await post('/api/rooms',{name:'Alice',driver:0,arena:0,bots:0,color:'#a4198b'});
  const bob=await post('/api/join',{name:'Bob',driver:1,code:host.code,color:'#3c75d8'});
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
  const emojiCheck=await evaluate(alice,`(()=>{
    const toggle=document.querySelector('.chat-emoji-toggle'),picker=document.querySelector('.chat-emoji-picker'),input=document.querySelector('.chat-compose input');
    toggle.click();
    const opened=!picker.classList.contains('hidden');
    picker.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    const insideStayedOpen=!picker.classList.contains('hidden');
    document.querySelector('.chat-heading').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));
    const outsideClosed=picker.classList.contains('hidden') && toggle.getAttribute('aria-expanded')==='false';
    toggle.click();
    const icon=toggle.querySelector('svg');
    icon.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
    icon.dispatchEvent(new MouseEvent('click',{bubbles:true}));
    const toggleStillCloses=picker.classList.contains('hidden');
    input.value='Hello world';input.setSelectionRange(6,6);toggle.click();
    const choice=picker.querySelector('button');
    choice.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));choice.click();
    const inserted=input.value==='Hello 😀world' && picker.classList.contains('hidden');input.value='';
    return {opened,insideStayedOpen,outsideClosed,toggleStillCloses,inserted};
  })()`);
  assert.deepEqual(emojiCheck,{opened:true,insideStayedOpen:true,outsideClosed:true,toggleStillCloses:true,inserted:true});
  for(const [index,player] of [host,bob,eve].entries()){
    await wait(()=>evaluate(sessions[index],`document.querySelector('.color-swatch[data-color="${player.world.color}"]')?.getAttribute('aria-pressed')==='true'`),'Automatic player color was not selected in the palette');
  }
  await evaluate(alice,`document.querySelector('.color-swatch[data-color="#a4198b"]').click()`);
  await wait(()=>evaluate(alice,`document.querySelector('.color-swatch[data-color="#a4198b"]').getAttribute('aria-pressed')==='true'`),'Host color selection did not apply');
  await wait(()=>evaluate(bobSession,`document.querySelector('.color-swatch[data-color="#a4198b"]').disabled`),'Another human’s color was not disabled');
  const takenColorStyle=await evaluate(bobSession,`(()=>{const button=document.querySelector('.color-swatch[data-color="#a4198b"]'),style=getComputedStyle(button),line=getComputedStyle(button,'::after');return {disabled:button.disabled,taken:button.classList.contains('taken'),title:button.title,color:style.backgroundColor,filter:style.filter,opacity:style.opacity,lineWidth:line.width};})()`);
  assert.deepEqual(takenColorStyle,{disabled:true,taken:true,title:'Color taken',color:'rgb(164, 25, 139)',filter:'none',opacity:'1',lineWidth:'32px'});
  await evaluate(bobSession,`document.querySelector('.color-swatch[data-color="#3c75d8"]').click()`);
  await wait(()=>evaluate(bobSession,`document.querySelector('.color-swatch[data-color="#3c75d8"]').getAttribute('aria-pressed')==='true'`),'Guest color selection did not apply');
  async function choose(session,to=''){
    await evaluate(session,`document.querySelector('.chat-tab[data-conversation="${to}"]').click()`);
  }
  async function send(session,text,to=''){
    await choose(session,to);
    await wait(()=>evaluate(session,"!document.querySelector('.chat-compose button').disabled"),'Send button did not become available');
    await evaluate(session,`{const form=document.querySelector('.chat-compose');form.querySelector('input').value=${JSON.stringify(text)};form.requestSubmit();}`);
    await wait(()=>evaluate(session,"document.querySelector('.chat-compose input').value===''") ,'Message was not sent');
  }
  await evaluate(alice,`{
    const arc=CanvasRenderingContext2D.prototype.arc;
    CanvasRenderingContext2D.prototype.arc=function(...args){if(this.canvas.id==='map'&&(args[2]===4||args[2]===5))window.__fixedChatMapColor=this.fillStyle;return arc.apply(this,args);};
    document.querySelector('.color-swatch[data-color="#3b6329"]').click();
  }`);
  await wait(()=>evaluate(alice,`window.__fixedChatMapColor==='#3b6329' && document.querySelector('.color-swatch[data-color="#3b6329"]').getAttribute('aria-pressed')==='true'`),'Vehicle color did not change independently of chat color');
  await call('Page.bringToFront',{},bobSession);
  await call('Emulation.setFocusEmulationEnabled',{enabled:true},bobSession);
  await evaluate(bobSession,"document.querySelector('.viewport').scrollIntoView({block:'center'})");
  await send(alice,'Hello everyone');
  for(const session of sessions)await wait(()=>evaluate(session,"document.querySelector('.chat-messages').textContent.includes('Hello everyone')"),'Public message missing');
  const floatingMessageStarted=performance.now();
  for(const session of [bobSession,eveSession]) {
    await wait(()=>evaluate(session,"document.querySelector('.viewport .game-chat-notice')?.textContent.includes('Hello everyone')"),'Incoming public message did not float inside the game');
    assert.equal(await evaluate(session,"getComputedStyle(document.querySelector('.game-chat-notice strong')).color"),'rgb(164, 25, 139)');
  }
  assert.equal(await evaluate(bobSession,"getComputedStyle(document.querySelector('.game-chat-notice')).animationName"),'game-chat-drop','Game message did not use the drop-in animation');
  assert.equal(await evaluate(bobSession,"getComputedStyle(document.querySelector('.game-chat-notice')).backgroundColor"),'rgba(255, 253, 247, 0.8)','Game message background is not translucent');
  await wait(()=>evaluate(bobSession,"(()=>{const card=document.querySelector('.game-chat-notice');return card && card.getAnimations().every(animation=>animation.playState==='finished');})()"),'Game message entrance did not finish');
  assert.equal(await evaluate(bobSession,"(()=>{const card=document.querySelector('.game-chat-notice').getBoundingClientRect(),counter=document.querySelector('.position').getBoundingClientRect(),viewport=document.querySelector('.viewport').getBoundingClientRect();return card.top>=counter.bottom && Math.abs(card.top-viewport.top-88)<2;})()"),true,'Game message is not positioned just below the kills counter');
  assert.equal(await evaluate(alice,"document.querySelectorAll('.game-chat-notice').length"),0,'Own message produced a game notification');
  await evaluate(eveSession,"document.querySelector('.game-chat-notice button[aria-label=\"Dismiss message notification\"]').click()");
  assert.equal(await evaluate(eveSession,"document.querySelectorAll('.game-chat-notice').length"),0);
  await wait(()=>evaluate(bobSession,"document.querySelectorAll('.game-chat-notice').length===0"),'Game message notification did not expire');
  assert.ok(performance.now()-floatingMessageStarted<6500,'Game message did not expire after the shortened four-second interval');
  assert.equal(await evaluate(alice,"getComputedStyle(document.querySelector('.chat-own .chat-meta strong')).color"),'rgb(164, 25, 139)','Changing the vehicle changed the chat name color');
  await evaluate(alice,`document.querySelector('.color-swatch[data-color="#a4198b"]').click()`);
  await wait(()=>evaluate(alice,`document.querySelector('.color-swatch[data-color="#a4198b"]').getAttribute('aria-pressed')==='true'`),'Vehicle color did not restore');
  await send(alice,'<b>Private hello</b>',String(bob.you));
  await choose(bobSession,String(host.you));
  await wait(()=>evaluate(bobSession,"document.querySelector('.chat-messages').textContent.includes('<b>Private hello</b>')"),'Private message missing');
  assert.equal(await evaluate(eveSession,"document.querySelector('.chat-messages').textContent.includes('Private hello')"),false);
  assert.equal(await evaluate(bobSession,"document.querySelector('.chat-messages b')!==null"),false,'Message text became HTML');
  await wait(()=>evaluate(bobSession,"document.querySelector('.game-chat-notice')?.textContent.includes('<b>Private hello</b>')"),'Private message notification did not arrive');
  assert.equal(await evaluate(bobSession,"document.querySelector('.game-chat-notice p b')!==null"),false,'Notification interpreted message text as HTML');
  assert.equal(await evaluate(eveSession,"document.querySelector('.game-chat-notices').textContent.includes('Private hello')"),false,'Private message leaked into another player’s notification');
  await evaluate(bobSession,"document.querySelector('.game-chat-notice .game-chat-reply').click()");
  assert.equal(await evaluate(bobSession,"document.activeElement===document.querySelector('.chat-compose input')"),true,'Notification reply did not focus the chat input');
  assert.equal(await evaluate(bobSession,"getComputedStyle(document.querySelector('.chat-reply-preview strong')).color"),'rgb(164, 25, 139)','Reply preview lost the original author color');
  assert.equal(await evaluate(bobSession,"document.querySelector('.chat-reply-preview strong').textContent"),'Alice');
  assert.equal(await evaluate(bobSession,"document.querySelector('.chat-reply-preview b')!==null"),false,'Preview text became HTML');
  await send(bobSession,'Private reply',String(host.you));
  await wait(()=>evaluate(alice,"document.querySelector('.chat-messages').textContent.includes('Private reply')"),'Private reply missing');
  assert.equal(await evaluate(eveSession,"document.querySelector('.chat-messages').textContent.includes('Private reply')"),false);
  assert.equal(await evaluate(alice,"document.querySelector('.chat-quote').textContent.includes('Private hello')"),true,'Reply quote missing');
  assert.equal(await evaluate(alice,"getComputedStyle(document.querySelector('.chat-quote strong')).color"),'rgb(164, 25, 139)','Sent quote lost the original author color');
  assert.equal(await evaluate(alice,"getComputedStyle(document.querySelector('.chat-other .chat-meta strong')).color"),'rgb(60, 117, 216)','Reply used the quoted author color for its sender');
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
  // Hold a real background poll open so a delete click exercises the queue.
  await evaluate(alice,`(() => {
    const original=window.fetch;
    window.__chatPollHeld=false;
    window.fetch=async(...args)=>{
      const response=await original(...args);
      const body=String(args[0]).endsWith('/api/chat')?JSON.parse(args[1]?.body??'{}'):{};
      if(String(args[0]).endsWith('/api/chat') && !('text' in body) && !('deleteId' in body)) {
        window.fetch=original;
        await new Promise(resolve=>{window.__releaseChatPoll=resolve;window.__chatPollHeld=true;});
      }
      return response;
    };
  })()`);
  await wait(()=>evaluate(alice,"window.__chatPollHeld"),'Background poll was not held');
  assert.equal(await evaluate(alice,"document.querySelector('.chat-own .chat-delete').disabled"),false,'Polling disabled the bin icon');
  assert.equal(await evaluate(alice,"getComputedStyle(document.querySelector('.chat-own .chat-delete')).opacity"),'1','Polling faded the bin icon');
  await evaluate(alice,"document.querySelector('.chat-own .chat-delete').click()");
  assert.equal(await evaluate(alice,"document.querySelector('.chat-own .chat-delete').disabled"),true,'Queued deletion did not prevent duplicate clicks');
  await evaluate(alice,"window.__releaseChatPoll()");
  await wait(()=>evaluate(alice,"document.querySelector('.chat-deleted')?.textContent==='Message deleted'"),'Own message was not deleted');
  await wait(()=>evaluate(bobSession,"document.querySelector('.chat-deleted')?.textContent==='Message deleted'"),'Deletion did not reach recipient');
  assert.equal(await evaluate(alice,"document.querySelector('.chat-quote').textContent"),'Message deleted');
  assert.equal(await evaluate(alice,"document.querySelector('.chat-quote strong')!==null"),false,'Deleted quote still shows an author');
  assert.equal(await evaluate(alice,"document.querySelector('.chat-panel').parentElement.matches('.game-layout > aside')"),true);
  assert.equal(await evaluate(alice,"(()=>{const game=document.querySelector('.race-panel').getBoundingClientRect(),chat=document.querySelector('.chat-panel').getBoundingClientRect();return chat.left>=game.right&&Math.abs(chat.top-game.top)<2;})()"),true,'Chat is not beside the game');
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
  // Exercise the real DOM: payloads must remain literal text, including names and reply quotes.
  const attacks=['<script>globalThis.__chatXss=1</script>','<img src=x onerror="globalThis.__chatXss=1">','<svg onload="globalThis.__chatXss=1"></svg>',"' OR 1=1; DROP TABLE messages; --"];
  await call('Emulation.setDeviceMetricsOverride',{width:1200,height:1000,deviceScaleFactor:1,mobile:false},alice);
  for(const payload of attacks){
    await sleep(550);await send(alice,payload);
    for(const session of sessions){
      await choose(session);
      await wait(()=>evaluate(session,`document.querySelector('.chat-messages').textContent.includes(${JSON.stringify(payload)})`),'Attack payload did not arrive as text');
      assert.equal(await evaluate(session,"document.querySelector('.chat-panel script,.chat-panel img,.chat-bubble > span svg,.chat-quote svg,.chat-meta svg,.chat-tab svg')!==null"),false,'Attack payload created executable markup');
      assert.equal(await evaluate(session,"globalThis.__chatXss??0"),0,'XSS payload executed');
    }
  }
  // New messages follow the open conversation, even after scrolling up.
  await choose(alice);
  await evaluate(alice,"document.querySelector('.chat-messages').scrollTop=0");
  await send(bobSession,'Auto-scroll public');
  await wait(()=>evaluate(alice,"document.querySelector('.chat-messages').textContent.includes('Auto-scroll public')"),'Public auto-scroll message did not arrive');
  await wait(()=>evaluate(alice,"(()=>{const log=document.querySelector('.chat-messages');return log.scrollHeight-log.clientHeight-log.scrollTop<=8;})()"),'New public message did not scroll Everyone to the bottom');
  await evaluate(alice,"document.querySelector('.chat-messages').scrollTop=0");
  await sleep(550);await send(bobSession,'Background private '+ 'old text '.repeat(35),String(host.you));
  await wait(()=>evaluate(alice,"document.querySelector('.game-chat-notices').textContent.includes('Background private')"),'Background private message did not arrive');
  assert.equal(await evaluate(alice,"document.querySelector('.chat-messages').scrollTop"),0,'A different conversation scrolled the open chat');
  await choose(alice,String(bob.you));
  assert.equal(await evaluate(alice,"(()=>{const log=document.querySelector('.chat-messages');return log.scrollHeight>log.clientHeight;})()"),true,'Private auto-scroll check needs overflowing history');
  await evaluate(alice,"document.querySelector('.chat-messages').scrollTop=0");
  await sleep(550);await send(bobSession,'Auto-scroll private',String(host.you));
  await wait(()=>evaluate(alice,"document.querySelector('.chat-messages').textContent.includes('Auto-scroll private')"),'Private auto-scroll message did not arrive');
  await wait(()=>evaluate(alice,"(()=>{const log=document.querySelector('.chat-messages');return log.scrollHeight-log.clientHeight-log.scrollTop<=8;})()"),'New private message did not scroll the active chat to the bottom');
  for(const session of sessions)await choose(session);
  const evilName='<svg/onload=alert(1)>';
  await evaluate(bobSession,`fetch('/api/name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:${JSON.stringify(evilName)}})}).then(r=>{if(!r.ok)throw new Error('Rename failed');})`);
  await sleep(550);await send(bobSession,'Name safety check');
  await wait(()=>evaluate(alice,`document.querySelector('.chat-messages').textContent.includes(${JSON.stringify(evilName)})`),'Malicious name did not arrive as text');
  await evaluate(alice,"document.querySelector('.chat-other:last-child .chat-reply-button').click()");
  assert.equal(await evaluate(alice,"document.querySelector('.chat-reply-preview svg')!==null"),false,'Name became markup in reply preview');
  await sleep(550);await send(alice,'Safe quoted name');
  await wait(()=>evaluate(bobSession,"document.querySelector('.chat-quote')?.textContent.includes('Name safety check')"),'Quoted reply missing');
  for(const session of sessions){
    assert.equal(await evaluate(session,"document.querySelector('.chat-bubble > span svg,.chat-quote svg,.chat-meta svg,.chat-tab svg,.chat-panel script,.chat-panel img')!==null"),false);
    assert.equal(await evaluate(session,"globalThis.__chatXss??0"),0);
  }
  // Missing/invalid colors must keep the default styling and names must remain text.
  for(const color of [null, 'red; background:url(https://attacker.invalid)', '#123', 'javascript:alert(1)']){
    const result=await evaluate(alice,`(async()=>{
      const {GameChat}=await import('/ui/chat.js');
      const reply={name:'<img src=x onerror=alert(1)>',text:'<script>alert(1)</script>',color:${JSON.stringify(color)}};
      const preview=document.createElement('div');
      const chat={conversation:'',replies:new Map([['',reply]]),replyPreview:preview};
      GameChat.prototype.renderReply.call(chat);
      return {color:preview.querySelector('strong').style.color,name:preview.querySelector('strong').textContent,text:preview.textContent,markup:Boolean(preview.querySelector('img,script,svg'))};
    })()`);
    assert.equal(result.color,'');assert.equal(result.name,'<img src=x onerror=alert(1)>');assert.equal(result.markup,false);assert.ok(result.text.includes('<script>alert(1)</script>'));
  }
  // A normal refresh restores the server-confirmed preference without a new click.
  await evaluate(alice,"window.__beforeColorReload=true");
  await call('Page.reload',{},alice);
  await wait(async()=>{try{return await evaluate(alice,`!window.__beforeColorReload && document.querySelector('.color-swatch[data-color="#a4198b"]')?.getAttribute('aria-pressed')==='true' && document.querySelector('.chat-compose input')?.disabled===false`);}catch{return false;}},'Chosen color was lost after refresh');
  assert.equal(await evaluate(alice,"document.cookie.includes('wild-wheels-color=%23a4198b')"),true);

  async function colorPage(name,preferred){
    const {browserContextId}=await call('Target.createBrowserContext');contexts.push(browserContextId);
    const {targetId}=await call('Target.createTarget',{url:'about:blank',browserContextId});
    const {sessionId}=await call('Target.attachToTarget',{targetId,flatten:true});
    await call('Runtime.enable',{},sessionId);await call('Page.enable',{},sessionId);
    await call('Network.setCookie',{name:'wild-wheels-name',value:encodeURIComponent(name),url:origin},sessionId);
    if(preferred)await call('Network.setCookie',{name:'wild-wheels-color',value:encodeURIComponent(preferred),url:origin},sessionId);
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`{
      const arc=CanvasRenderingContext2D.prototype.arc;
      CanvasRenderingContext2D.prototype.arc=function(...args){
        if(this.canvas.id==='map'&&(args[2]===4||args[2]===5))window.__playerMapColor=this.fillStyle;
        return arc.apply(this,args);
      };
    }`},sessionId);
    await call('Page.bringToFront',{},sessionId);
    await call('Emulation.setFocusEmulationEnabled',{enabled:true},sessionId);
    return sessionId;
  }
  const solo=await colorPage('Solo color tester');
  await call('Page.navigate',{url:origin+'/'},solo);
  await wait(()=>evaluate(solo,`document.querySelector('.color-swatch[data-color="#edd040"]')?.disabled===false && Boolean(window.__playerMapColor) && [...document.querySelectorAll('.network-controls button')].some(button=>button.textContent==='HOST ARENA'&&!button.disabled)`),'Solo palette did not initialize');
  await evaluate(solo,`document.querySelector('.color-swatch[data-color="#edd040"]').click()`);
  await wait(()=>evaluate(solo,`window.__playerMapColor==='#edd040' && document.querySelector('.color-swatch[data-color="#edd040"]').getAttribute('aria-pressed')==='true'`),'Grand Prix map ignored the selected color');
  await evaluate(solo,"document.querySelector('#drivers .driver:nth-child(2)').click()");
  await wait(()=>evaluate(solo,"window.__playerMapColor==='#edd040'"),'Character change reset the solo color');
  async function checkSoloColorLock(label) {
    await call('Page.bringToFront',{},solo);
    await call('Emulation.setFocusEmulationEnabled',{enabled:true},solo);
    const cookie=await evaluate(solo,'document.cookie');
    await evaluate(solo,"document.querySelector('#start').click()");
    await wait(()=>evaluate(solo,"document.querySelector('#status').textContent==='LIGHTS OUT IN 3…' && [...document.querySelectorAll('.color-swatch')].every(button=>button.disabled)"),`${label} palette did not lock during countdown`);
    assert.equal(await evaluate(solo,"[...document.querySelectorAll('.color-swatch')].every(button=>getComputedStyle(button).filter===(button.getAttribute('aria-pressed')==='true'?'none':'grayscale(1)'))"),true,'Compact match layout must preserve the assigned color while keeping every swatch locked');
    await evaluate(solo,`document.querySelector('.color-swatch[data-color="#a4198b"]').click()`);
    assert.equal(await evaluate(solo,'document.cookie'),cookie,'Disabled swatch changed the saved preference');
    await evaluate(solo,"document.querySelector('#pause').click()");
    await wait(()=>evaluate(solo,"document.querySelector('#status').textContent==='RACE PAUSED' && [...document.querySelectorAll('.color-swatch')].every(button=>button.disabled)"),`${label} palette unlocked while paused`);
    assert.equal(await evaluate(solo,"document.querySelector('.color-swatch[aria-pressed=true]').dataset.color"),'#edd040');
    await evaluate(solo,"document.querySelector('#restart').click()");
    await wait(()=>evaluate(solo,"[...document.querySelectorAll('.color-swatch')].every(button=>!button.disabled)"),`${label} palette did not unlock before the next match`);
  }
  await checkSoloColorLock('Grand Prix');
  await evaluate(solo,"document.querySelector('#mode-combat').click()");
  await wait(()=>evaluate(solo,"window.__playerMapColor==='#edd040' && document.querySelector('#mode-combat').getAttribute('aria-pressed')==='true'"),'Solo arena ignored the selected color');
  await checkSoloColorLock('Solo arena');
  await evaluate(solo,"window.__beforeColorReload=true");await call('Page.reload',{},solo);
  await wait(async()=>{try{return await evaluate(solo,"!window.__beforeColorReload && window.__playerMapColor==='#edd040'");}catch{return false;}},'Solo color preference did not survive refresh');
  await call('Page.navigate',{url:`${origin}/?room=${host.code}`},solo);
  await wait(()=>evaluate(solo,`document.querySelector('.chat-compose input')?.disabled===false && document.querySelector('.color-swatch[data-color="#edd040"]')?.getAttribute('aria-pressed')==='true' && window.__playerMapColor==='#edd040'`),'Pre-join color was not applied to multiplayer');

  const returning=await colorPage('Returning color tester','#a4198b');
  await call('Page.navigate',{url:`${origin}/?room=${host.code}`},returning);
  await wait(()=>evaluate(returning,`document.querySelector('.chat-compose input')?.disabled===false && document.querySelector('.color-feedback')?.textContent.includes('preferred color is in use')`),'Occupied preferred color did not produce a fallback notice');
  const fallback=await evaluate(returning,"document.querySelector('.color-swatch[aria-pressed=true]').dataset.color");
  assert.notEqual(fallback,'#a4198b');
  assert.equal(await evaluate(returning,`document.querySelector('.color-swatch[data-color="#a4198b"]').disabled`),true);
  assert.equal(await evaluate(returning,"document.cookie.includes('wild-wheels-color=%23a4198b')"),true,'Fallback overwrote the preferred color cookie');
  await wait(()=>evaluate(returning,`window.__playerMapColor===${JSON.stringify(fallback)}`),'Fallback color did not reach the map');
  await evaluate(returning,"window.__beforeColorReload=true");await call('Page.reload',{},returning);
  await wait(async()=>{try{return await evaluate(returning,`!window.__beforeColorReload && document.querySelector('.color-swatch[aria-pressed=true]')?.dataset.color===${JSON.stringify(fallback)} && document.querySelector('.chat-compose input')?.disabled===false`);}catch{return false;}},'Fallback assignment changed on reconnect');
  assert.equal(await evaluate(returning,"document.cookie.includes('wild-wheels-color=%23a4198b')"),true);
  // Match transitions must show the latest messages after the sidebar settles.
  await call('Page.bringToFront',{},alice);
  await call('Emulation.setFocusEmulationEnabled',{enabled:true},alice);
  await choose(alice);
  assert.equal(await evaluate(alice,"(()=>{const log=document.querySelector('.chat-messages');return log.scrollHeight>log.clientHeight;})()"),true,'Transition check needs overflowing chat history');
  await evaluate(alice,"document.querySelector('.chat-messages').scrollTop=0;document.querySelector('#start').click()");
  await wait(()=>evaluate(alice,"document.body.classList.contains('match-active')"),'Match layout did not activate');
  await wait(()=>evaluate(alice,"(()=>{const log=document.querySelector('.chat-messages');return log.scrollHeight-log.clientHeight-log.scrollTop<=8;})()"),'Starting the match did not show the latest chat messages');
  assert.equal(await evaluate(alice,"(()=>{const lobby=document.querySelector('.network-panel').getBoundingClientRect(),driver=document.querySelector('.racer-panel').getBoundingClientRect();return Math.abs(lobby.bottom-driver.bottom)<2;})()"),true,'Character panel is not aligned with the bottom of Play Together');
  await evaluate(alice,"document.querySelector('.chat-messages').scrollTop=0");
  const liveRoom=app.multiplayer.rooms.get(host.code);
  for(let n=0;n<100 && liveRoom.core.status.phase==='countdown';n++)liveRoom.core.step(.05);
  app.multiplayer.broadcast(liveRoom);
  await wait(()=>evaluate(alice,"document.querySelector('#status').textContent==='MAKE SOME PIXEL DUST'"),'Keyboard check did not reach active play');
  await evaluate(alice,`(async()=>{
    const {NetworkGame}=await import('/networking/network.js');
    const action=NetworkGame.prototype.action,input=NetworkGame.prototype.input;
    window.__keyboardActions=[];window.__heldGameKeys=[];
    NetworkGame.prototype.action=function(type,...args){window.__keyboardActions.push(type);return action.call(this,type,...args);};
    NetworkGame.prototype.input=function(...args){window.__heldGameKeys=[...this.keys];return input.apply(this,args);};
    document.activeElement?.blur();
  })()`);
  async function gameKeyEvent(key,code,type='keydown',extra={}) {
    await evaluate(alice,`window.dispatchEvent(new KeyboardEvent(${JSON.stringify(type)},{key:${JSON.stringify(key)},code:${JSON.stringify(code)},bubbles:true,...${JSON.stringify(extra)}}))`);
  }
  await gameKeyEvent('ס','KeyX');await gameKeyEvent('x','KeyX','keyup');
  await wait(()=>liveRoom.core.snapshot(host.you).turbos===0,'Hebrew turbo key did not activate a real turbo');
  for(const [key,code] of [['כ','KeyF'],['ב','KeyC'],['ז','KeyZ'],['/','KeyQ']]) {
    await gameKeyEvent(key,code);await gameKeyEvent(key,code,'keyup');
  }
  assert.deepEqual(await evaluate(alice,'window.__keyboardActions'),['turbo','special','chaff','somersault','cycle']);
  await gameKeyEvent("'",'KeyW');
  assert.equal(await evaluate(alice,"window.__heldGameKeys.includes('w')"),true,'Hebrew driving key was not held');
  await gameKeyEvent('w','KeyW','keyup');
  assert.equal(await evaluate(alice,"window.__heldGameKeys.includes('w')"),false,'Switching layout before release left driving stuck');
  await gameKeyEvent('ס','KeyX','keydown',{ctrlKey:true});await gameKeyEvent('ס','KeyX','keyup');
  assert.equal(await evaluate(alice,'window.__keyboardActions.length'),5,'Ctrl+Hebrew turbo key triggered an action');
  await evaluate(alice,`{const input=document.querySelector('.chat-compose input');input.focus();input.value='סכבדש';for(const [key,code] of [['ס','KeyX'],['כ','KeyF'],['ב','KeyC'],['ד','KeyS'],['ש','KeyA']]){input.dispatchEvent(new KeyboardEvent('keydown',{key,code,bubbles:true}));input.dispatchEvent(new KeyboardEvent('keyup',{key,code,bubbles:true}));}}`);
  assert.equal(await evaluate(alice,'window.__keyboardActions.length'),5,'Typing Hebrew in chat activated gameplay');
  assert.deepEqual(await evaluate(alice,'window.__heldGameKeys'),[],'Typing Hebrew in chat held movement keys');
  for(const [key,code,virtualKey,held] of [['ArrowUp','ArrowUp',38,'arrowup'],['ArrowDown','ArrowDown',40,'arrowdown']]) {
    await evaluate(alice,"{const input=document.querySelector('.chat-compose input');input.value='Keep this draft 🙂';input.focus();}");
    await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:virtualKey},alice);
    await wait(()=>evaluate(alice,`document.activeElement===document.querySelector('#game') && window.__heldGameKeys.includes(${JSON.stringify(held)})`),'Arrow key did not transfer focus from chat to driving');
    assert.equal(await evaluate(alice,"document.querySelector('.chat-compose input').value"),'Keep this draft 🙂','Returning to the game lost the chat draft');
    await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:virtualKey},alice);
    await wait(()=>evaluate(alice,`!window.__heldGameKeys.includes(${JSON.stringify(held)})`),'Released arrow remained held after leaving chat');
  }
  await evaluate(alice,"document.querySelector('.chat-compose input').focus()");
  for(const [key,code,modifiers] of [['ArrowLeft','ArrowLeft',0],['ArrowRight','ArrowRight',0],['ArrowUp','ArrowUp',8]]) {
    await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers},alice);
    await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers},alice);
    assert.equal(await evaluate(alice,"document.activeElement===document.querySelector('.chat-compose input')"),true,'Text-editing arrow unexpectedly left chat');
  }
  assert.equal(await evaluate(alice,'window.__keyboardActions.length'),5,'Returning to driving triggered a weapon action');
  await evaluate(alice,"document.querySelector('.chat-compose input').value=''");
  for(let n=0;n<4000 && liveRoom.core.status.phase!=='finished';n++)liveRoom.core.step(.05);
  assert.equal(liveRoom.core.status.phase,'finished');app.multiplayer.broadcast(liveRoom);
  await wait(()=>evaluate(alice,"!document.body.classList.contains('match-active')"),'Match layout did not finish');
  await wait(()=>evaluate(alice,"(()=>{const log=document.querySelector('.chat-messages');return log.scrollHeight-log.clientHeight-log.scrollTop<=8;})()"),'Finishing the match did not show the latest chat messages');
  assert.deepEqual(errors,[]);
  if(process.argv.includes('--screenshot')){
    await evaluate(alice,"document.querySelector('.chat-panel').scrollIntoView()");
    const {data}=await call('Page.captureScreenshot',{format:'png'},alice);const path=join(profile,'chat.png');await writeFile(path,Buffer.from(data,'base64'));console.log(`Screenshot: ${path}`);
  }
  console.log('Chat browser checks passed: public delivery, separate public and private conversations, saved and pre-join preferences, solo/Grand Prix map colors and match palette locks, occupied-color fallbacks, automatic palette selection, occupied colors with diagonal marks and tooltips, fixed chat colors independent of vehicle/map colors, colored reply authors and previews, history, steady bin icons and deletion queued during polling, timed in-game notifications and private replies, safe text and color fallbacks, active-conversation auto-scroll, emoji picker outside-click dismissal, keyboard isolation, Hebrew controls and turbo activation, Up/Down returning from chat to driving without losing drafts, bottom-aligned match setup, latest chat messages after match transitions, placement, and mobile width.');
}finally{
  for(const browserContextId of contexts)try{await call('Target.disposeBrowserContext',{browserContextId});}catch{}
  socket?.close();chrome.kill('SIGTERM');app.multiplayer.close();app.server.closeAllConnections();await new Promise(resolve=>app.server.close(resolve));
}
