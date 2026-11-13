import { damageBattle } from '../../gameplay/combat.js';

export async function checkControls(evaluate,app,room,id,sleep,captureFlip,captureChaff,captureNotices,captureReady,captureBomb,captureStink){
  // Simulated peers have no browser socket to send their usual session heartbeats.
  const fixtureHeartbeat=setInterval(()=>{for(const member of room.members.values())if(member.id!==id&&!member.socket)member.lastSeen=Date.now();},1000);fixtureHeartbeat.unref();
  try{
  const host=room.members.get(room.host);
  const guest=id===room.host?app.join(room,{name:'Ready Friend',driver:1}):room.members.get(id);
  const displayName=id===room.host?'Alex <b>':'Sam <b>';
  const editable=await evaluate(`!__game.network.name.disabled`);
  await evaluate(`{const input=__game.network.name;input.value=${JSON.stringify(displayName)};input.dispatchEvent(new Event('input'));}`);
  for(let i=0;i<100;i++){if(await evaluate("document.getElementById('start').disabled===false"))break;await sleep(25);}
  if(id!==room.host)await evaluate("document.getElementById('start').click()");
  if(id===room.host)await evaluate(`fetch('/api/ready',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ${guest.token}'},body:JSON.stringify({ready:true})})`);
  for(let i=0;i<100;i++){if(await evaluate(`__game.network.state.players.some(p=>p.id===${guest.id}&&p.wantsToPlay)&&(${id===room.host}||document.getElementById('start').textContent.includes('STARTING IN')&&document.getElementById('start').disabled)`))break;await sleep(25);}
  const readyUI=await evaluate(`({status:__game.network.status.textContent,button:document.getElementById('start').textContent,disabled:document.getElementById('start').disabled,roster:__game.network.players.textContent})`);
  const readyPass=Boolean(guest.wantsToPlay)&&(id===room.host?readyUI.status.includes('Ready Friend')&&readyUI.status.includes('wants to play')&&readyUI.status.includes('Auto-start'):readyUI.status.includes('unless the host refuses')&&readyUI.button.includes('STARTING IN')&&readyUI.disabled);
  const popup=await evaluate(`(()=>{const dialog=__game.network.readyDialog,rect=dialog.getBoundingClientRect();return {open:dialog.open,text:dialog.textContent,centered:Math.abs(rect.x+rect.width/2-innerWidth/2)<40&&Math.abs(rect.y+rect.height/2-innerHeight/2)<40};})()`);
  let popupPass=id===host.id?popup.open&&popup.centered&&popup.text.includes('Ready Friend')&&popup.text.includes('AUTO-START IN')&&popup.text.includes('REFUSE')&&!await evaluate("Boolean(__game.network.readyDialog.querySelector('img'))"):!popup.open;
  if(id===host.id){
    if(captureReady){await sleep(400);await captureReady();}
    await evaluate('__game.network.readyLaterButton.click()');
  }
  if(id!==host.id)await evaluate(`fetch('/api/control',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ${host.token}'},body:JSON.stringify({action:'refuse-start',requestId:__game.network.state.startRequest.id})})`);
  for(let i=0;i<100;i++){if(!room.startRequest&&!guest.wantsToPlay&&await evaluate(`!__game.network.readyDialog.open&&(${id===host.id}||__game.network.playRequestRefused&&!document.getElementById('start').disabled)`))break;await sleep(10);}
  const refusalPass=!room.startRequest&&!guest.wantsToPlay&&(id===host.id||await evaluate("__game.network.status.textContent.includes('refused')&&!document.getElementById('start').disabled"));
  popupPass &&= !await evaluate('__game.network.readyDialog.open');
  if(id===host.id){await sleep(3100);popupPass &&= room.world.phase==='ready';}
  const draftPreserved=await evaluate(`__game.network.name.value===${JSON.stringify(displayName)}`);
  for(let i=0;i<100;i++){if(await evaluate(`__game.network.state.world.name===${JSON.stringify(displayName)}`))break;await sleep(25);}
  const namePass=editable&&draftPreserved&&await evaluate(`__game.network.state.world.name===${JSON.stringify(displayName)}&&__game.network.players.textContent.includes(${JSON.stringify(displayName)})&&!__game.network.players.querySelector('b')`);
  if(id===host.id)await evaluate(`fetch('/api/ready',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ${guest.token}'},body:JSON.stringify({ready:true})})`);
  if(id!==host.id)await evaluate("document.getElementById('start').click()");
  for(let i=0;i<100;i++){if(room.startRequest)break;await sleep(10);}
  const deadline=room.startRequest?.deadline;
  for(let i=0;i<500;i++){if(await evaluate("__game.network.state.world.phase==='countdown'&&!__game.network.readyDialog.open"))break;await sleep(10);}
  const autoStartPass=Number.isFinite(deadline)&&app.startNow()>=deadline&&app.startNow()-deadline<1000&&room.world.phase==='countdown';
  popupPass &&= !await evaluate('__game.network.readyDialog.open');
  const readyCleared=[...room.members.values()].every(player=>!player.wantsToPlay)&&room.world.phase==='countdown';
  Object.assign(room.world,{phase:'racing',supplies:[]});
  const actor=[room.world,...room.world.bots][id];
  Object.assign(actor,{wx:-65,wz:70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:300,vulcan:10,item:'hedgehog',missiles:0,ammo:5,turbos:1,boost:0,fireCooldown:0});
  room.world.supplies=[{id:0,version:0,wx:-65,wz:70,kind:'missile',cooldown:0}];
  if(id!==room.host)room.world.destroyed=999;
  for(let i=0;i<100;i++){if(await evaluate('__game.network.state.world.phase==="racing"&&__game.network.state.world.vulcan>9&&__game.network.state.world.missiles===1&&__game.network.state.world.turbos===1'))break;await sleep(25);}
  const pickupKeptVulcan=actor.item==='hedgehog'&&await evaluate("__game.network.state.world.item==='hedgehog'");
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Meta',metaKey:true,bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'Meta',metaKey:true,repeat:true,bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{key:'Meta',bubbles:true}));");
  for(let i=0;i<100;i++){if(actor.item==='missile'&&await evaluate("__game.race.item==='missile'"))break;await sleep(10);}
  const commandOnce=actor.item==='missile'&&await evaluate("__game.race.item==='missile'");
  await evaluate("__game.network.name.dispatchEvent(new KeyboardEvent('keydown',{key:'Meta',metaKey:true,bubbles:true}));");
  const typingSafe=await evaluate("__game.race.item==='missile'");
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Tab',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{key:'Tab',bubbles:true}));");
  for(let i=0;i<100;i++){if(actor.item==='hedgehog'&&await evaluate("__game.race.item==='hedgehog'"))break;await sleep(10);}
  const commandPass=commandOnce&&typingSafe&&actor.item==='hedgehog'&&await evaluate("__game.race.item==='hedgehog'");
  await evaluate(`{
    const game=__game,render=game.network.render.bind(game.network),start=performance.now();let boosted=false,fired=false;
    game.controlsTrace=[];game.controlsDone=false;game.keys.add('arrowup');
    game.network.render=dt=>{
      const time=(performance.now()-start)/1000;let request=false;
      if(!boosted&&time>=.1){window.dispatchEvent(new KeyboardEvent('keydown',{key:'x'}));boosted=true;request=true;}
      if(!fired&&time>=.3){window.dispatchEvent(new KeyboardEvent('keydown',{key:' '}));window.dispatchEvent(new KeyboardEvent('keyup',{key:' '}));fired=true;}
      const view=render(dt);
      game.controlsTrace.push({time,dt,request,boost:view.boost,speed:view.speed,turbos:view.turbos,item:view.item,vulcanShot:view.projectiles.some(p=>p.owner===view.id&&p.vulcan),turboSelected:document.getElementById('ammo-boost').classList.contains('selected')});
      if(time>=1){game.controlsDone=true;game.network.render=render;game.keys.clear();game.network.input();}
      return view;
    };
  }`);
  for(let i=0;i<100;i++){if(await evaluate('__game.controlsDone'))break;await sleep(25);}
  const trace=await evaluate('__game.controlsTrace'),request=trace.find(frame=>frame.request);
  for(let i=0;i<100&&actor.turbos!==0;i++)await sleep(10);
  const turboPass=Boolean(request&&request.boost>2.4&&request.turbos===0)&&trace.every(frame=>frame.item==='hedgehog'&&!frame.turboSelected)&&trace.some(frame=>frame.vulcanShot)&&actor.turbos===0;
  Object.assign(actor,{wx:-65,wz:70,heading:0,motionHeading:0,cameraHeading:0,speed:180,boost:0,vulcan:0,somersault:0,somersaultCooldown:0,fireCooldown:0,item:'hedgehog',ammo:5});room.world.supplies=[];
  for(let i=0;i<100;i++){if(await evaluate('__game.network.state.world.vulcan===0&&__game.network.state.world.heading===0&&__game.network.state.world.wz>69'))break;await sleep(25);}
  await evaluate(`(async()=>{
    const {somersaultPose}=await import('/gameplay/combat.js');
    const game=__game,render=game.network.render.bind(game.network),start=performance.now();let flipped=false,again=false;
    game.flipTrace=[];game.flipDone=false;
    game.network.render=dt=>{
      const time=(performance.now()-start)/1000;
      if(!flipped){window.dispatchEvent(new KeyboardEvent('keydown',{key:'z'}));window.dispatchEvent(new KeyboardEvent('keyup',{key:'z'}));window.dispatchEvent(new KeyboardEvent('keydown',{key:' '}));window.dispatchEvent(new KeyboardEvent('keyup',{key:' '}));flipped=true;}
      if(!again&&time>.1){window.dispatchEvent(new KeyboardEvent('keydown',{key:'z'}));window.dispatchEvent(new KeyboardEvent('keyup',{key:'z'}));again=true;}
      const view=render(dt),jump=somersaultPose(view);
      game.flipTrace.push({time,heading:view.heading,cameraHeading:view.cameraHeading,height:jump?.height??0,pitch:jump?.pitch??0,remaining:view.somersault,shot:view.projectiles.filter(p=>p.owner===view.id).at(-1)?.heading??null,item:view.item});
      if(time>=.8){game.flipDone=true;game.network.render=render;}
      return view;
    };
  })()`);
  let remoteSawFlip=false,flipCaptured=false;
  for(let i=0;i<100;i++){
    const remote=app.snapshot(room,room.members.get(id===host.id?guest.id:host.id));
    remoteSawFlip ||= remote.world.bots.some(player=>player.id===id&&player.somersault>0);
    if(captureFlip&&!flipCaptured&&await evaluate('__game.race.somersault>.15&&__game.race.somersault<.45')){await captureFlip();flipCaptured=true;}
    if(await evaluate('__game.flipDone'))break;await sleep(25);
  }
  const flipTrace=await evaluate('__game.flipTrace');
  const flippedHeading=frame=>Math.abs(Math.atan2(Math.sin(frame.heading-Math.PI),Math.cos(frame.heading-Math.PI)))<.01;
  const cameraSteps=flipTrace.slice(1).map((frame,index)=>Math.atan2(Math.sin(frame.cameraHeading-flipTrace[index].cameraHeading),Math.cos(frame.cameraHeading-flipTrace[index].cameraHeading)));
  // Rendering timestamps include scheduling jitter; judge rotation against the
  // jump's simulation clock, which drives the actual camera animation.
  const cameraPass=flipTrace[0].cameraHeading<.15&&flipTrace.some(frame=>frame.cameraHeading>1.2&&frame.cameraHeading<1.9)&&Math.abs(flipTrace.at(-1).cameraHeading-Math.PI)<.02&&cameraSteps.every((step,index)=>step>=-.001&&step<=(Math.max(0,flipTrace[index].remaining-flipTrace[index+1].remaining)+.002)*Math.PI*1.5/.55+.02);
  const flipPass=flipTrace.length>0&&flippedHeading(flipTrace[0])&&flipTrace.every(flippedHeading)&&flipTrace.some(frame=>frame.height>4)&&flipTrace.at(-1).height===0&&flipTrace[0].shot!==null&&Math.abs(flipTrace[0].shot-Math.PI)<.01&&remoteSawFlip&&cameraPass;
  const other=[room.world,...room.world.bots].find(player=>!player.inactive&&player.id!==id);
  Object.assign(actor,{wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,boost:0,shield:0,chaff:2,chaffCooldown:0,ammo:5});
  Object.assign(other,{wx:-65,wz:60,heading:Math.PI,motionHeading:Math.PI,cameraHeading:Math.PI,speed:0,boost:0,destroyed:0,shield:0,fireCooldown:0,item:'missile',missiles:1,vulcan:0});
  room.world.projectiles=[];
  for(let i=0;i<100;i++){if(await evaluate("document.querySelector('.kart-nameplate')?.textContent==="+JSON.stringify(other.name)))break;await sleep(25);}
  await sleep(150);
  const desktopManual=actor.ammo>=5&&room.world.projectiles.every(shot=>shot.owner!==id);
  other.wz=-65;other.heading=0;other.motionHeading=0;other.cameraHeading=0;
  room.world.projectiles=[];room.world.chaffClouds=[];
  const shooter=room.members.get(other.id);
  app.controls(shooter,{sequence:shooter.sequence+1,keys:[],actions:[{type:'fire'}]});
  for(let i=0;i<100;i++){if(await evaluate("!document.getElementById('incoming-warning').classList.contains('hidden')"))break;await sleep(10);}
  const warning=await evaluate(`(()=>{
    const element=document.getElementById('incoming-warning'),animation=element.getAnimations()[0];
    if(animation)animation.currentTime=0;const first=getComputedStyle(element).backgroundColor;
    if(animation)animation.currentTime=600;const second=getComputedStyle(element).backgroundColor;
    return {visible:!element.classList.contains('hidden'),text:element.textContent,blinks:first!==second};
  })()`);
  await evaluate(`{
    __game.chaffSounds=[];const play=__game.audio.event.bind(__game.audio);
    __game.audio.event=type=>{if(type==='chaffDivert')__game.chaffSounds.push(type);play(type);};
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'c'}));
  }`);
  for(let i=0;i<100;i++){if(actor.chaff===1&&await evaluate("document.getElementById('incoming-warning').classList.contains('hidden')&&__game.chaffSounds.length===1"))break;await sleep(10);}
  const warningPass=warning.visible&&warning.blinks&&warning.text.includes('INCOMING MISSILE')&&warning.text.includes('CHAFF')&&actor.chaff===1&&await evaluate("document.getElementById('incoming-warning').classList.contains('hidden')");
  const ownCloud=room.world.chaffClouds.map(cloud=>({...cloud})).find(cloud=>cloud.owner===id);
  const colorPass=ownCloud?.color===actor.color&&await evaluate(`__game.network.state.world.chaffClouds.some(cloud=>cloud.owner===${id}&&cloud.color===${JSON.stringify(actor.color)})`);
  if(captureChaff)await captureChaff();
  await sleep(150);
  const chaffSoundCount=await evaluate('__game.chaffSounds.length'),chaffPass=colorPass&&chaffSoundCount===1;
  const greenNoticePass=await evaluate("!document.getElementById('averted-notice').classList.contains('hidden')&&document.getElementById('averted-notice').textContent.includes('MISSILE AVERTED')&&document.getElementById('incoming-warning').classList.contains('hidden')");
  const orbitTrace=[];let sawOrbit=false,orbitCaptured=false;
  for(let i=0;i<220;i++){
    const shot=await evaluate("(()=>{const p=__game.race.projectiles.find(p=>p.decoy!=null);return p?{wx:p.wx,wz:p.wz,height:p.height,heading:p.heading,direction:p.orbitDirection,entryHeight:p.orbitHeight,age:p.orbitAge??null}:null;})()");
    if(shot){orbitTrace.push(shot);if(shot.age!==null)sawOrbit=true;}
    if(captureChaff&&!orbitCaptured&&shot?.age>.4){await captureChaff();orbitCaptured=true;}
    if(sawOrbit&&!shot)break;await sleep(20);
  }
  let orbitRotation=0,previousAngle=null;
  for(const shot of orbitTrace.filter(shot=>shot.age!==null)){if(previousAngle!==null)orbitRotation+=Math.atan2(Math.sin(shot.heading-previousAngle),Math.cos(shot.heading-previousAngle));previousAngle=shot.heading;}
  const descendsWhileCircling=orbitTrace.some(shot=>shot.age>0&&shot.age<.6&&shot.height<shot.entryHeight-.02);
  const movesWhileFalling=orbitTrace.some((shot,index)=>index>0&&shot.age>.65&&shot.height<orbitTrace[index-1].height&&Math.hypot(shot.wx-orbitTrace[index-1].wx,shot.wz-orbitTrace[index-1].wz)>.2);
  const orbitPass=sawOrbit&&Math.abs(orbitRotation)>Math.PI*1.6&&Math.abs(orbitRotation)<=Math.PI*2.2&&descendsWhileCircling&&movesWhileFalling&&room.world.projectiles.every(shot=>shot.decoy==null);
  const bomber=app.join(room,{name:'Phone Bomber',driver:2,role:'bomber'});
  app.controls(bomber,{sequence:0,keys:[],actions:[{type:'bomb',id:0,afterMove:-1,wx:-65,wz:30}],epoch:room.world.soundEpoch});
  for(let i=0;i<100;i++){if(await evaluate('__game.race.bombs.some(bomb=>bomb.wx===-65&&bomb.wz===30)'))break;await sleep(10);}
  const desktopSawBomb=await evaluate("!__game.race.bomber&&!document.querySelector('.viewport').classList.contains('bomber-view')&&__game.race.bombs.some(bomb=>bomb.wx===-65&&bomb.wz===30)");
  if(captureBomb)await captureBomb();
  for(let i=0;i<150;i++){if(await evaluate("__game.race.effects.some(effect=>effect.type==='abomb'&&effect.wx===-65&&effect.wz===30)"))break;await sleep(10);}
  const desktopBombPass=desktopSawBomb&&await evaluate("__game.race.effects.some(effect=>effect.type==='abomb'&&effect.wx===-65&&effect.wz===30)");
  if(captureBomb)await captureBomb();
  const bomberActor=[room.world,...room.world.bots][bomber.id];bomberActor.stinkAmmo=1;const healthBefore=actor.health;
  app.controls(bomber,{sequence:1,keys:[],actions:[{type:'bomb',id:1,afterMove:-1,kind:'stink',wx:actor.wx,wz:actor.wz}],epoch:room.world.soundEpoch});
  for(let i=0;i<150;i++){if(await evaluate("__game.race.dizzy>0&&!document.getElementById('dizzy-notice').classList.contains('hidden')"))break;await sleep(10);}
  const dizzySeen=actor.dizzy>0&&await evaluate("document.getElementById('dizzy-notice').textContent.includes('DIZZY')");
  const stinkSpent=bomberActor.stinkAmmo===0;
  if(captureStink)await captureStink();
  // Staying inside gas refreshes dizziness: five seconds of gas plus eight
  // seconds of dizziness can outlast the old nine-second observation window.
  const stinkDeadline=performance.now()+20000;
  while(performance.now()<stinkDeadline){if(actor.dizzy===0&&await evaluate("document.getElementById('dizzy-notice').classList.contains('hidden')"))break;await sleep(25);}
  const stinkResult={dizzySeen,stinkSpent,dizzyRemaining:actor.dizzy,healthBefore,healthAfter:actor.health,gasRemaining:Math.max(0,...room.world.stinkClouds.map(c=>c.life-c.age))};
  const stinkPass=dizzySeen&&stinkResult.dizzyRemaining===0&&stinkResult.healthAfter===healthBefore&&stinkSpent;
  app.remove(bomber);
  await evaluate(`fetch('/api/name',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer ${shooter.token}'},body:JSON.stringify({name:'Rival <img>'})})`);
  room.world.projectiles=[];Object.assign(other,{health:3,shield:0,destroyed:0});damageBattle(room.world,other,id,3);
  for(let i=0;i<100;i++){if(await evaluate("!document.getElementById('whack-banner').classList.contains('hidden')"))break;await sleep(10);}
  const whack=await evaluate(`(()=>{
    const banner=document.getElementById('whack-banner'),card=banner.firstElementChild,animation=card?.getAnimations()[0];
    if(animation)animation.currentTime=0;const start=card?.getBoundingClientRect().top;
    if(animation)animation.currentTime=325;const peak=card?.getBoundingClientRect().top;
    const viewport=document.querySelector('.viewport').getBoundingClientRect();
    return {background:getComputedStyle(card).backgroundImage,text:banner.textContent,visible:!banner.classList.contains('hidden'),jumps:matchMedia('(prefers-reduced-motion: reduce)').matches||peak<start-5,aboveAction:card?.getBoundingClientRect().bottom<viewport.top+viewport.height*.4,safe:!banner.querySelector('img')};
  })()`);
  if(captureNotices)await captureNotices();
  await sleep(2100);
  const whackPass=whack.visible&&whack.text.includes('YOU WHACKED')&&whack.text.includes('Rival <img>')&&whack.jumps&&whack.aboveAction&&whack.safe&&await evaluate("document.getElementById('whack-banner').classList.contains('hidden')&&document.getElementById('averted-notice').classList.contains('hidden')");
  room.world.killFeed.unshift({id:++room.world.killSequence,attacker:id,victim:other.id,victimName:other.name,assist:true,time:room.world.elapsed});
  for(let i=0;i<100;i++){if(await evaluate("document.getElementById('whack-banner').textContent.includes('CO-WHACKED')"))break;await sleep(10);}
  const coWhackPass=await evaluate("(()=>{const banner=document.getElementById('whack-banner'),card=banner.firstElementChild;return !banner.classList.contains('hidden')&&banner.textContent.includes('CO-WHACKED')&&banner.textContent.includes('Rival <img>')&&!banner.querySelector('img')&&getComputedStyle(card).backgroundImage!=="+JSON.stringify(whack.background)+"})()");
  Object.assign(actor,{kills:3,deaths:4});Object.assign(other,{kills:10,deaths:2});
  room.world.projectiles=[];room.world.bombs=[];room.world.stinkClouds=[];room.world.chaffClouds=[];room.world.supplies=[];
  Object.assign(actor,{wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:0,health:3,shield:0,destroyed:0,item:'missile',missiles:1,fireCooldown:0,dizzy:0});
  Object.assign(other,{wx:-65,wz:20,speed:0,health:3,shield:0,destroyed:0});
  Object.assign(room.world,{finishRank:1,finishTime:20,finishCountdown:3});
  for(let i=0;i<100;i++){if(await evaluate("__game.race.finishCountdown!==null&&__game.race.item==='missile'&&__game.race.fireCooldown===0&&__game.race.destroyed===0"))break;await sleep(10);}
  await evaluate("window.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{key:' ',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowUp',bubbles:true}));");
  for(let i=0;i<150;i++){if(other.destroyed>0&&actor.wz>1)break;await sleep(10);}
  const endingPass=other.destroyed>0&&actor.wz>1&&actor.kills===3&&actor.deaths===4&&other.kills===10&&other.deaths===2&&room.world.finishTime===20;
  await evaluate("window.dispatchEvent(new KeyboardEvent('keyup',{key:'ArrowUp',bubbles:true}));");
  for(let i=0;i<150;i++){if(room.world.phase==='finished')break;await sleep(25);}
  for(let i=0;i<100;i++){if(await evaluate("!document.getElementById('match-results').classList.contains('hidden')&&document.querySelectorAll('#match-results tbody tr').length===2"))break;await sleep(25);}
  const leaderboard=await evaluate("[...document.querySelectorAll('#match-results tbody tr')].map(row=>[...row.cells].map(cell=>cell.textContent))");
  const resultsPass=JSON.stringify(leaderboard)===JSON.stringify([['1',other.name,'10','2'],['2',displayName+' · YOU','3','4']])&&await evaluate("document.querySelectorAll('#match-results tbody .you').length===1&&!document.querySelector('#match-results b')");
  const hostActor=[room.world,...room.world.bots].find(actor=>actor.id===room.host),guestActor=[room.world,...room.world.bots].find(actor=>actor.id!==room.host);
  Object.assign(hostActor,{kills:7,deaths:9});Object.assign(guestActor,{kills:7,deaths:1});
  for(let i=0;i<100;i++){if(await evaluate("document.querySelector('#match-results caption').textContent==='TIE ON POINTS · HOST WINS'"))break;await sleep(25);}
  const tiedRows=await evaluate("[...document.querySelectorAll('#match-results tbody tr')].map(row=>[...row.cells].map(cell=>cell.textContent))");
  const tiePass=tiedRows[0]?.[1]===hostActor.name+(id===room.host?' · YOU':'')&&tiedRows[0]?.[2]==='7'&&tiedRows[0]?.[3]==='9'&&tiedRows[1]?.[2]==='7'&&tiedRows[1]?.[3]==='1'&&await evaluate("document.querySelector('#match-results caption').textContent==='TIE ON POINTS · HOST WINS'");
  return {readyPass,readyCleared,readyUI,popupPass,popup,refusalPass,autoStartPass,namePass,pickupKeptVulcan,commandPass,turboPass,flipPass,cameraPass,remoteSawFlip,flipTrace,desktopManual,warningPass,warning,chaffPass,chaffColor:ownCloud?.color,chaffSoundCount,greenNoticePass,orbitPass,orbitRotation,orbitTrace,desktopBombPass,stinkPass,stinkResult,whackPass,coWhackPass,whack,endingPass,resultsPass,leaderboard,tiePass,tiedRows,pass:readyPass&&readyCleared&&popupPass&&refusalPass&&autoStartPass&&namePass&&pickupKeptVulcan&&commandPass&&turboPass&&flipPass&&desktopManual&&warningPass&&chaffPass&&greenNoticePass&&orbitPass&&desktopBombPass&&stinkPass&&whackPass&&coWhackPass&&endingPass&&resultsPass&&tiePass,trace};
  }finally{clearInterval(fixtureHeartbeat);}
}
