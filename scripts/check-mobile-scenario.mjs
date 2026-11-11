export async function checkMobile(evaluate,app,room,id,sleep,capture,rotate,tap,drag){
  const fixtureHeartbeat=setInterval(()=>{for(const member of room.members.values())if(member.id!==id&&!member.socket)member.lastSeen=Date.now();},1000);fixtureHeartbeat.unref();
  try{
  const host=room.members.get(room.host),enemy=id===host.id?app.join(room,{name:'Target <img>',driver:1}):host;
  enemy.name='Target <img>';
  let readyRequestPass=false;
  if(id===host.id){
    await evaluate(`fetch('/api/ready',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ${enemy.token}'},body:JSON.stringify({ready:true})})`);
    for(let i=0;i<100;i++){if(await evaluate('__game.network.readyDialog.open'))break;await sleep(10);}
    const shown=await evaluate("__game.network.readyDialog.open&&__game.network.readyCountdown.textContent.includes('AUTO-START IN')&&__game.network.readyLaterButton.textContent==='REFUSE'");
    if(capture)await capture('host-play-request');
    await evaluate('__game.network.readyLaterButton.click()');
    for(let i=0;i<100;i++){if(!room.startRequest&&!enemy.wantsToPlay)break;await sleep(10);}
    readyRequestPass=shown&&!room.startRequest&&!enemy.wantsToPlay;
  }
  const bomberName=id===host.id?'Bomber Oren':'Bomber Sam';
  await evaluate(`{const input=__game.network.name;input.value=${JSON.stringify(bomberName)};input.dispatchEvent(new Event('input'));}`);
  await evaluate("document.getElementById('start').click()");
  if(id!==room.host){
    for(let i=0;i<100;i++){if(room.startRequest)break;await sleep(10);}
    const deadline=room.startRequest?.deadline;
    for(let i=0;i<200;i++){if(room.world.phase==='countdown')break;await sleep(25);}
    readyRequestPass=Number.isFinite(deadline)&&app.startNow()>=deadline&&room.world.phase==='countdown';
  }
  for(let i=0;i<200;i++){if(room.world.phase==='countdown')break;await sleep(25);}
  const bomberNamePass=await evaluate(`__game.network.name.value===${JSON.stringify(bomberName)}&&!__game.network.name.disabled&&!__game.network.panel.textContent.includes('SAVE NAME')`)&&room.members.get(id).name===bomberName;
  const actor=[room.world,...room.world.bots][id],other=[room.world,...room.world.bots][enemy.id];
  Object.assign(room.world,{phase:'racing',supplies:[],projectiles:[]});
  Object.assign(other,{wx:-65,wz:30,speed:0,shield:0,health:3,destroyed:0,name:'Target <img>'});
  const initialAmmo=actor.bomber&&actor.bombAmmo===2&&actor.stinkAmmo===2;
  for(let i=0;i<100;i++){if(await evaluate("__game.race.phase==='racing'&&__game.race.bomber&&document.getElementById('bomb-count').textContent==='2 A-BOMBS'"))break;await sleep(10);}
  const fullscreen=await evaluate(`(()=>{const panel=document.querySelector('.race-panel'),r=panel.getBoundingClientRect();return panel.classList.contains('mobile-fullscreen')&&Math.abs(r.width-innerWidth)<2&&Math.abs(r.height-innerHeight)<2;})()`);
  const overhead=await evaluate("document.querySelector('.viewport').classList.contains('bomber-view')&&!document.getElementById('enable-tilt')&&!document.getElementById('auto-fire')&&getComputedStyle(document.querySelector('.touch-controls')).display==='none'");
  const default3D=await evaluate("__game.renderer.bomberView==='3d'&&document.getElementById('bomber-view-3d').getAttribute('aria-pressed')==='true'");
  for(let i=0;i<100;i++){if(await evaluate("__game.network.state.world.bots.some(actor=>actor.wx===-65&&actor.wz===30)"))break;await sleep(10);}
  await evaluate("document.getElementById('bomber-center').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
  for(let i=0;i<100;i++){if(await evaluate("[...document.querySelectorAll('.kart-nameplate')].some(node=>node.textContent==='Target <img>')"))break;await sleep(10);}
  const namedTarget=await evaluate("[...document.querySelectorAll('.kart-nameplate')].some(node=>node.textContent==='Target <img>')&&!document.querySelector('.kart-nameplates img')");
  await evaluate(`{
    __game.bombTrace=[];__game.lastTapFrames=[];__game.bombTap=null;
    document.getElementById('game').addEventListener('pointerup',()=>{__game.bombTap=performance.now();__game.lastTapFrames=[];});
    const render=__game.network.render.bind(__game.network);__game.network.render=(...args)=>{const view=render(...args);if(__game.bombTap!==null){const frame={delay:performance.now()-__game.bombTap,ammo:view.bombAmmo,stinkAmmo:view.stinkAmmo,bombs:view.bombs.map(b=>({wx:b.wx,wz:b.wz,owner:b.owner,kind:b.kind}))};__game.bombTrace.push(frame);__game.lastTapFrames.push(frame);}return view;};
  }`);
  const targetPixel=async(wx,wz)=>evaluate(`(()=>{const r=document.getElementById('game').getBoundingClientRect(),matrix=__game.renderer.bomberMatrix,point=[${wx},0,${wz},1],clip=[0,1,2,3].map(row=>point.reduce((sum,value,column)=>sum+matrix[column*4+row]*value,0));return {x:r.left+(clip[0]/clip[3]+1)*r.width/2,y:r.top+(1-clip[1]/clip[3])*r.height/2};})()`);
  const chooseCamera=async view=>{await evaluate(`document.getElementById('bomber-view-${view}').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);};
  const kartWidth=async(wx,wz)=>{const left=await targetPixel(wx-2,wz),right=await targetPixel(wx+2,wz);return Math.hypot(right.x-left.x,right.y-left.y);};
  const portraitKartWidth=await kartWidth(-65,30),closeView=portraitKartWidth>=16;
  const point=await targetPixel(-65,30);await tap(point.x,point.y);
  for(let i=0;i<100;i++){if(room.world.bombs.length)break;await sleep(10);}
  const dropped=room.world.bombs.find(bomb=>bomb.owner===id),accurate=Boolean(dropped&&Math.abs(dropped.wx+65)<.6&&Math.abs(dropped.wz-30)<.6),spent=actor.bombAmmo===1;
  const desktopSawDrop=app.snapshot(room,enemy).world.bombs.some(bomb=>bomb.owner===id)&&!app.snapshot(room,enemy).world.bomber;
  await tap(point.x,point.y);await tap(point.x,point.y);
  for(let i=0;i<100;i++){if(room.world.bombSequence===2)break;await sleep(10);}
  const boundedDrops=room.world.bombSequence===2&&actor.bombAmmo===0;
  if(capture)await capture('portrait-3d-drop');
  for(let i=0;i<150;i++){if(other.deaths===1&&await evaluate("__game.race.effects.some(effect=>effect.type==='ash')"))break;await sleep(10);}
  const blast=other.deaths===1&&actor.kills===1&&app.snapshot(room,enemy).world.effects.some(effect=>effect.type==='abomb')&&app.snapshot(room,enemy).world.effects.some(effect=>effect.type==='ash')&&await evaluate("__game.race.effects.some(effect=>effect.type==='ash')");
  const noKillBonus=actor.bombAmmo===0&&actor.stinkAmmo===2&&room.world.elapsed<5;
  if(capture){await sleep(350);await capture('portrait-3d-blast');}
  const feedback=await evaluate("__game.bombTrace[0]??null");
  const immediate=Boolean(feedback&&feedback.ammo===1&&feedback.bombs.some(bomb=>bomb.owner===id));
  for(let i=0;i<600;i++){if(actor.stinkAmmo===3)break;await sleep(10);}
  const stinkRefill=actor.stinkAmmo===3&&actor.bombAmmo===0&&room.world.elapsed>=4.999;
  Object.assign(other,{wx:-65,wz:30,health:3,shield:0,destroyed:0,speed:0});
  await evaluate("document.getElementById('bomber-weapon-stink').click()");
  for(let i=0;i<100;i++){if(await evaluate('__game.race.stinkAmmo===3&&__game.race.bots.some(actor=>actor.wx===-65&&actor.wz===30)'))break;await sleep(10);}
  const stinkPoint=await targetPixel(-65,30);await tap(stinkPoint.x,stinkPoint.y);
  for(let i=0;i<100;i++){if(room.world.bombs.some(bomb=>bomb.kind==='stink'))break;await sleep(10);}
  const stinkShot=room.world.bombs.some(bomb=>bomb.kind==='stink'&&bomb.owner===id)&&actor.bombAmmo===0&&actor.stinkAmmo===2;
  for(let i=0;i<150;i++){if(other.dizzy>0)break;await sleep(10);}
  const stinkWorks=other.dizzy>0&&other.health===3&&actor.kills===1&&room.world.stinkClouds.length>0;
  const stinkFeedback=await evaluate('__game.lastTapFrames[0]??null'),stinkImmediate=Boolean(stinkFeedback&&stinkFeedback.ammo===0&&stinkFeedback.stinkAmmo===2&&stinkFeedback.bombs.some(bomb=>bomb.kind==='stink'));
  if(capture)await capture('stink-cloud');
  for(let i=0;i<1000;i++){if(actor.bombAmmo===1&&other.dizzy===0)break;await sleep(10);}
  const refillAt=room.world.elapsed,refill=actor.bombAmmo===1&&actor.stinkAmmo===3&&refillAt>=9.999,dizzyExpired=other.dizzy===0&&other.health===3;
  await evaluate("document.getElementById('bomber-weapon-abomb').click()");
  const margin=await evaluate("(()=>{const r=document.getElementById('game').getBoundingClientRect();return {x:r.left+2,y:r.top+2};})()");
  const before=room.world.bombSequence;await tap(margin.x,margin.y);await sleep(200);
  const marginsIgnored=room.world.bombSequence===before&&actor.bombAmmo===1;
  await chooseCamera('map');
  const mapOption=await evaluate("__game.renderer.bomberView==='map'&&document.getElementById('bomber-view-map').getAttribute('aria-pressed')==='true'");
  const switchPreservesGame=actor.bombAmmo===1&&actor.kills===1&&room.world.phase==='racing';
  if(capture)await capture('portrait-2d-map');
  const landscape=[];
  for(const angle of [0,90,270])for(const view of ['3d','map']){
    await rotate(angle);
    for(let i=0;i<100;i++){if(await evaluate(`__game.network.state.actionSequence>=${room.members.get(id).actionAck??-1}`))break;await sleep(10);}
    actor.bombAmmo=1;actor.bombReload=0;Object.assign(other,{wx:65,wz:-30,health:6,shield:99,destroyed:0,speed:0});await chooseCamera(view);
    for(let i=0;i<100;i++){if(await evaluate('__game.race.bombAmmo===1'))break;await sleep(10);}
    for(let i=0;i<100;i++){if(await evaluate('__game.network.state.world.bots.some(actor=>actor.wx===65&&actor.wz===-30)'))break;await sleep(10);}
    let panPass=true,zoomPass=true,width=null;
    if(view==='3d'){
      await evaluate("document.getElementById('bomber-center').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      width=await kartWidth(65,-30);
      const start=await targetPixel(65,-30),end={x:start.x+80,y:start.y},sequenceBeforePan=room.world.bombSequence;
      await drag(start,end);await sleep(200);
      const moved=await targetPixel(65,-30);
      panPass=Math.hypot(moved.x-end.x,moved.y-end.y)<2&&room.world.bombSequence===sequenceBeforePan&&actor.bombAmmo===1;
      const beforeZoom=await kartWidth(65,-30);
      await evaluate("document.getElementById('bomber-zoom-in').click();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))");
      const afterZoom=await kartWidth(65,-30);zoomPass=afterZoom>beforeZoom*1.2;
    }
    const location=await targetPixel(65,-30),sequence=room.world.bombSequence;
    await tap(location.x,location.y);
    for(let i=0;i<100;i++){if(room.world.bombSequence>sequence)break;await sleep(10);}
    const bomb=room.world.bombs.find(bomb=>bomb.id>sequence);
    const hit=Boolean(bomb&&Math.abs(bomb.wx-65)<.6&&Math.abs(bomb.wz+30)<.6);
    landscape.push({angle,view,hit,panPass,zoomPass,kartWidthPx:width,detailPass:width===null||width>=(angle===0?16:8),ammo:actor.bombAmmo,bomb: bomb?{wx:bomb.wx,wz:bomb.wz}:null});if(capture)await capture(`camera-${angle}-${view}`);
    if(view==='3d')await evaluate("document.getElementById('bomber-zoom-out').click()");
  }
  const landscapePass=landscape.every(test=>test.hit&&test.panPass&&test.zoomPass&&test.detailPass);
  await chooseCamera('3d');
  await evaluate("document.getElementById('mobile-fullscreen').click()");
  const exited=await evaluate("!document.querySelector('.race-panel').classList.contains('mobile-fullscreen')");
  return {bomberNamePass,readyRequestPass,initialAmmo,fullscreen,overhead,default3D,closeView,portraitKartWidth,mapOption,switchPreservesGame,namedTarget,accurate,spent,immediate,feedbackDelayMs:feedback?.delay,boundedDrops,desktopSawDrop,blast,noKillBonus,stinkRefill,stinkShot,stinkWorks,stinkImmediate,dizzyExpired,refill,refillAt,marginsIgnored,landscape,landscapePass,exited,pass:bomberNamePass&&readyRequestPass&&initialAmmo&&fullscreen&&overhead&&default3D&&closeView&&mapOption&&switchPreservesGame&&namedTarget&&accurate&&spent&&immediate&&boundedDrops&&desktopSawDrop&&blast&&noKillBonus&&stinkRefill&&stinkShot&&stinkWorks&&stinkImmediate&&dizzyExpired&&refill&&marginsIgnored&&landscapePass&&exited};
  }finally{clearInterval(fixtureHeartbeat);}
}
