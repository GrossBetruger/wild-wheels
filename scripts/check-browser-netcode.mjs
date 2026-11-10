import { createServer } from 'node:http';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import WebSocket from 'ws';
import { pathToFileURL } from 'node:url';
import { checkFeedback } from './check-feedback-scenario.mjs';
import { checkDrift } from './check-drift-scenario.mjs';
import { checkControls } from './check-controls-scenario.mjs';

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const quantile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.min(values.length-1,Math.floor(values.length*p))]??0;
const chrome=process.env.CHROME_PATH??'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const outputIndex=process.argv.indexOf('--output');
const output=outputIndex>=0?process.argv[outputIndex+1]:join(tmpdir(),'wild-wheels-browser.json');
const functional=process.argv.includes('--functional');
const sourceIndex=process.argv.indexOf('--source');
const source=sourceIndex>=0?pathToFileURL(process.argv[sourceIndex+1]+'/'):new URL('../',import.meta.url);
const repeatIndex=process.argv.indexOf('--repeat'),repeat=repeatIndex>=0?Number(process.argv[repeatIndex+1]):1;
if(!Number.isInteger(repeat)||repeat<1||repeat>10)throw new Error('Repeat must be 1–10');
const {createGameServer}=await import(new URL('server.js',source));
const app=createGameServer();
const serverGaps=[];let activeProfile;
const originalAdvance=app.multiplayer.advance.bind(app.multiplayer);
app.multiplayer.advance=now=>{const gap=now-app.multiplayer.lastAdvance;if(gap>100)serverGaps.push({profile:activeProfile,gapMs:+gap.toFixed(2)});originalAdvance(now);};
const transportErrors=[];
const originalControls=app.multiplayer.controls.bind(app.multiplayer);
app.multiplayer.controls=(member,body)=>{try{return originalControls(member,body);}catch(error){transportErrors.push({error:error.message,accepted:member.acceptedMove,received:body.moves?.map(move=>move.sequence),messageSequence:body.sequence});throw error;}};
// Test-only access to the actual game objects. Production files remain untouched.
const gameSource=await readFile(new URL('game.js',source),'utf8');
const server=createServer((req,res)=>{
  if(req.url==='/game.js'){res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'});res.end(gameSource+'\nglobalThis.__game={network,renderer,keys,audio,get race(){return race}};');return;}
  app.server.emit('request',req,res);
});
server.on('upgrade',(...args)=>app.server.emit('upgrade',...args));
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
const profileDir=await mkdtemp(join(tmpdir(),'wild-wheels-browser-'));
const child=spawn(chrome,['--headless=new','--remote-debugging-port=0',`--user-data-dir=${profileDir}`,'--no-first-run','--no-default-browser-check','--disable-background-timer-throttling','--disable-renderer-backgrounding','--disable-backgrounding-occluded-windows','--window-size=1100,850','about:blank'],{stdio:['ignore','ignore','pipe']});
process.once('exit',()=>child.kill('SIGTERM'));
let chromeErrors='';child.stderr.on('data',data=>{chromeErrors+=data.toString();});
const debug=await Promise.race([
  new Promise((resolve,reject)=>{child.on('error',reject);const poll=setInterval(()=>{const match=chromeErrors.match(/DevTools listening on (ws:\/\/[^\s]+)/);if(match){clearInterval(poll);resolve(match[1]);}},50);poll.unref();}),
  sleep(10000).then(()=>{throw new Error('Chrome did not expose its local debugging endpoint: '+chromeErrors.slice(-1500));})
]);
const ws=new WebSocket(debug);await new Promise(resolve=>ws.once('open',resolve));
let id=0;const pending=new Map(),errors=[];
ws.on('message',data=>{const msg=JSON.parse(data);if(msg.id){const task=pending.get(msg.id);if(!task)return;pending.delete(msg.id);clearTimeout(task.timeout);if(msg.error)task.reject(new Error(JSON.stringify(msg.error)));else task.resolve(msg.result);return;}if(msg.method==='Runtime.exceptionThrown')errors.push(msg.params.exceptionDetails.text+': '+msg.params.exceptionDetails.exception?.description);});
function call(method,params={},sessionId){return new Promise((resolve,reject)=>{const number=++id,timeout=setTimeout(()=>{pending.delete(number);reject(new Error('Browser command timed out: '+method));},15000);pending.set(number,{resolve,reject,timeout});ws.send(JSON.stringify({id:number,method,params,...(sessionId?{sessionId}:{})}));});}
let session;
async function evaluate(expression){const result=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true},session);if(result.exceptionDetails)throw new Error(result.exceptionDetails.exception?.description??result.exceptionDetails.text);return result.result.value;}
const results=[];
try{
  const profiles=[{name:'local-host',delay:0,jitter:0},{name:'local-guest',delay:0,jitter:0,guest:true},{name:'160ms-guest',delay:80,jitter:0,guest:true},{name:'160ms-jitter-guest',delay:80,jitter:30,guest:true}];
  for(const profile of Array.from({length:repeat},(_,run)=>profiles.map(profile=>({...profile,run:run+1}))).flat()){
    activeProfile=`${profile.run}:${profile.name}`;
    const {targetId}=await call('Target.createTarget',{url:'about:blank'});({sessionId:session}=await call('Target.attachToTarget',{targetId,flatten:true}));
    await call('Page.enable',{},session);await call('Runtime.enable',{},session);
    await call('Page.addScriptToEvaluateOnNewDocument',{source:`{
      const Original=window.WebSocket;let seed=71;
      const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/4294967296);
      window.WebSocket=class extends Original{
        up=[];down=[];handler=null;
        flush(direction){const queue=this[direction],next=queue[0];if(!next)return;setTimeout(()=>{if(queue[0]!==next)return;queue.shift();next.action();this.flush(direction);},Math.max(0,next.at-performance.now()));}
        delay(direction,action){const queue=this[direction],at=Math.max(queue.at(-1)?.at??0,performance.now()+Math.max(0,${profile.delay}+(random()-.5)*2*${profile.jitter}));queue.push({at,action});if(queue.length===1)this.flush(direction);}
        constructor(...args){super(...args);super.addEventListener('message',event=>this.delay('down',()=>this.handler?.(event)));super.addEventListener('close',()=>{this.up.length=0;this.down.length=0;});}
        set onmessage(handler){this.handler=handler;}
        get onmessage(){return this.handler;}
        send(data){this.delay('up',()=>{if(this.readyState===Original.OPEN)super.send(data);});}
      };
    }`},session);
    await call('Page.navigate',{url:origin},session);
    for(let attempt=0;attempt<100;attempt++){if(await evaluate('Boolean(globalThis.__game)'))break;await sleep(50);}
    if(profile.guest){const room={code:'07',arena:0,botCount:0,host:0,members:new Map()};app.multiplayer.makeWorld(room);app.multiplayer.rooms.set('07',room);app.multiplayer.join(room,{name:'Host',driver:1});}
    const identity=await evaluate(`(async()=>{__game.network.botCount.value='0';__game.network.invitation='07';await __game.network.connect('${profile.guest?'/api/join':'/api/rooms'}');return {code:__game.network.state.code,you:__game.network.state.you};})()`);
    const room=app.multiplayer.rooms.get(identity.code);
    if(process.argv.includes('--controls')){
      const captureScene=label=>async()=>{
        await evaluate("document.querySelector('.viewport').scrollIntoView({block:'center'})");
        const screenshot=await call('Page.captureScreenshot',{format:'png'},session);
        await writeFile(`${output}.${profile.run}.${profile.name}.${label}.png`,Buffer.from(screenshot.data,'base64'));
      };
      const captureFlip=process.argv.includes('--flip-screenshots')?captureScene('flip'):undefined;
      const captureChaff=process.argv.includes('--chaff-screenshots')?captureScene('chaff'):undefined;
      const result={profile:profile.name,run:profile.run,...await checkControls(evaluate,app.multiplayer,room,identity.you,sleep,captureFlip,captureChaff)};
      results.push(result);console.log(JSON.stringify({...result,trace:undefined,flipTrace:undefined}));
      await evaluate("document.querySelector('.viewport').scrollIntoView({block:'center'})");
      const screenshot=await call('Page.captureScreenshot',{format:'png'},session);
      await writeFile(`${output}.${profile.run}.${profile.name}.png`,Buffer.from(screenshot.data,'base64'));
      await evaluate('__game.network.leave()');await call('Target.closeTarget',{targetId});
      for(const member of [...room.members.values()])app.multiplayer.remove(member);
      continue;
    }
    Object.assign(room.world,{phase:'racing',supplies:[]});
    if(profile.guest)room.world.destroyed=999;
    Object.assign([room.world,...room.world.bots][identity.you],{wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:0});
    for(let attempt=0;attempt<100;attempt++){if(await evaluate("__game.network.state?.world.phase==='racing'"))break;await sleep(50);}
    if(process.argv.includes('--feedback')||process.argv.includes('--drift')){
      const check=process.argv.includes('--drift')?checkDrift:checkFeedback;
      const result={profile:profile.name,run:profile.run,...await check(evaluate,room,identity.you,sleep)};
      if(functional&&result.behaviorPass!==undefined)result.pass=result.behaviorPass;
      results.push(result);console.log(JSON.stringify({...result,trace:undefined,requests:undefined,sounds:undefined}));
      await evaluate('__game.network.leave()');await call('Target.closeTarget',{targetId});
      for(const member of [...room.members.values()])app.multiplayer.remove(member);
      continue;
    }
    await evaluate(`(async()=>{
      const {createBattle,tickBattle,predictKartMovement}=await import('/combat.js');
      const game=__game,render=game.network.render.bind(game.network),start=performance.now();
      const reference=createBattle();Object.assign(reference,{phase:'racing',wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:0,supplies:[]});
      for(const bot of reference.bots)bot.destroyed=999;
      game.trace=[];game.done=false;let previous='',accumulator=game.network.prediction.accumulator??0;
      game.network.render=dt=>{
        const now=performance.now(),t=(now-start)/1000;
        const keys=t<.5?[]:t<1.5?['arrowup']:t<2.5?['arrowup','arrowright']:t<3.3?['arrowup','arrowright','shift']:t<4.8?['arrowup','arrowleft']:t<6?['arrowup','arrowright']:['arrowup','arrowleft','shift'];
        const key=keys.join(',');if(key!==previous){game.keys.clear();for(const k of keys)game.keys.add(k);game.network.input();previous=key;}
        accumulator+=dt;
        while(accumulator>=1/60-1e-8){tickBattle(reference,new Set(keys),1/60);accumulator-=1/60;}
        const future={...reference};predictKartMovement(reference,future,new Set(keys),1/60);
        const fraction=accumulator*60,expectedX=reference.wx+(future.wx-reference.wx)*fraction,expectedZ=reference.wz+(future.wz-reference.wz)*fraction;
        const expectedCamera=reference.cameraHeading+Math.atan2(Math.sin(future.cameraHeading-reference.cameraHeading),Math.cos(future.cameraHeading-reference.cameraHeading))*fraction;
        const view=render(dt);
        game.trace.push({time:t,dt,wx:view.wx,wz:view.wz,cameraHeading:view.cameraHeading,speed:view.speed,keys:key,ping:game.network.rtt,sinceUpdate:now/1000-game.network.prediction.received,pendingCommands:game.network.prediction.history.length,socketState:game.network.socket.readyState,expectedX,expectedZ,expectedCamera,positionError:Math.hypot(view.wx-expectedX,view.wz-expectedZ),cameraError:Math.abs(Math.atan2(Math.sin(view.cameraHeading-expectedCamera),Math.cos(view.cameraHeading-expectedCamera)))*180/Math.PI});
        if(t>=8){game.done=true;game.network.render=render;game.keys.clear();game.network.input();}
        return view;
      };
    })()`);
    for(let attempt=0;attempt<100;attempt++){if(await evaluate('__game.done'))break;await sleep(100);}
    const frames=await evaluate('__game.trace'),gpu=await evaluate('__game.renderer.gpuName');
    const frameTimes=frames.filter(f=>f.time>.5).map(f=>f.dt*1000);
    const measured=frames.filter(f=>f.time>.5);
    let freezes=0,backwards=0;
    for(let i=1;i<measured.length;i++){const a=measured[i-1],b=measured[i],dx=b.wx-a.wx,dz=b.wz-a.wz,rx=b.expectedX-a.expectedX,rz=b.expectedZ-a.expectedZ;if(Math.hypot(rx,rz)>.05&&Math.hypot(dx,dz)<.005)freezes++;if(Math.hypot(rx,rz)>.05&&dx*rx+dz*rz<-.001)backwards++;}
    const result={profile:profile.name,run:profile.run,frames:frames.length,frameP95Ms:+quantile(frameTimes,.95).toFixed(2),frameP99Ms:+quantile(frameTimes,.99).toFixed(2),positionP95:+quantile(measured.map(f=>f.positionError),.95).toFixed(4),positionMax:+Math.max(...measured.map(f=>f.positionError)).toFixed(4),cameraP95Degrees:+quantile(measured.map(f=>f.cameraError),.95).toFixed(4),cameraMaxDegrees:+Math.max(...measured.map(f=>f.cameraError)).toFixed(4),freezeFrames:freezes,backwardFrames:backwards,maxUpdateAgeMs:+Math.max(...measured.map(f=>f.sinceUpdate*1000)).toFixed(2),gpu,trace:frames};
    const host=results.find(row=>row.run===profile.run&&row.profile==='local-host');
    result.behaviorPass=result.positionP95<=.15&&result.positionMax<=.5&&result.cameraP95Degrees<=1&&result.cameraMaxDegrees<=3&&freezes===0&&backwards===0;
    result.frameBudgetPass=result.frameP95Ms<=20&&result.frameP95Ms<=(host?.frameP95Ms??result.frameP95Ms)+2;
    result.pass=result.behaviorPass&&(functional||result.frameBudgetPass);
    results.push(result);console.log(JSON.stringify({...result,trace:undefined}));
    await evaluate('__game.network.leave()');await call('Target.closeTarget',{targetId});
    for(const member of [...room.members.values()])app.multiplayer.remove(member);
  }
  await writeFile(output,JSON.stringify({frameBudgetEnforced:!functional,errors,transportErrors,serverGaps,results},null,2)+'\n');
  if(transportErrors.length)console.log(JSON.stringify({transportErrors}));
  if(errors.length)throw new Error(errors.join('\n'));
  if(transportErrors.length||results.some(result=>!result.pass))process.exitCode=1;
}finally{ws.close();child.kill('SIGTERM');app.multiplayer.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
