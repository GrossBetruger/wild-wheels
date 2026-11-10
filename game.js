import { LENGTH, drivers, tracks, createRace, tick, useItem, useTurbo, selectItem, cycleItem } from './engine.js';
import { Renderer } from './renderer.js';
import { RaceAudio } from './audio.js';
import { sampleTrack, branches } from './track.js';
import { createBattle, tickBattle, fireBattle, releaseChaff, useBattleTurbo, somersaultBattle, arenas, standings, incomingMissiles, VULCAN_DURATION, MAX_HEALTH } from './combat.js';
import { NetworkGame } from './network.js';
import { matchResults } from './results.js';
import { KillCelebration, ChaffNotice } from './combat-notices.js';
import { TiltSteering, allowTilt, usesMobileControls, mobileLockTarget } from './mobile.js';
const $ = id => document.getElementById(id);
const canvas = $('game'), map = $('map').getContext('2d');
const keys = new Set(), audio = new RaceAudio(), renderer = new Renderer(canvas);
const mobile=usesMobileControls(navigator.maxTouchPoints,matchMedia('(pointer:coarse)').matches),tilt=new TiltSteering();let autoFire=mobile;
const racePanel=document.querySelector('.race-panel');let mobileImmersive=false,mobileNativeFullscreen=false;
function exitMobileFullscreen(){mobileImmersive=false;mobileNativeFullscreen=false;racePanel.classList.remove('mobile-fullscreen');document.body.classList.remove('mobile-playing');mobileScreenButton.textContent='FULL SCREEN';if(document.fullscreenElement===racePanel)document.exitFullscreen().catch(()=>{});}
function enterMobileFullscreen(){
  if(!mobile)return;mobileImmersive=true;racePanel.classList.add('mobile-fullscreen');document.body.classList.add('mobile-playing');mobileScreenButton.textContent='EXIT FULL SCREEN';
  if(!document.fullscreenElement&&racePanel.requestFullscreen)racePanel.requestFullscreen().then(()=>{mobileNativeFullscreen=true;}).catch(()=>{});
}
document.addEventListener('fullscreenchange',()=>{if(document.fullscreenElement===racePanel)mobileNativeFullscreen=true;if(mobileNativeFullscreen&&!document.fullscreenElement)exitMobileFullscreen();});
let race = createRace(), lastTime = 0, selected = 0, track = 0, mode='race', lastPhase = '', lastCount = -1;
const renderControls=document.createElement('div');renderControls.className='render-controls';const graphicsLabel=document.createElement('label');graphicsLabel.textContent='GRAPHICS ';
const qualitySelect=document.createElement('select');qualitySelect.setAttribute('aria-label','Graphics quality');for(const [value,label] of [['auto','Auto'],['high','High'],['balanced','Balanced'],['low','Low']]){const option=document.createElement('option');option.value=value;option.textContent=label;qualitySelect.append(option);}qualitySelect.onchange=()=>renderer.setQuality(qualitySelect.value);graphicsLabel.append(qualitySelect);
const fpsMeter=document.createElement('span');fpsMeter.id='render-fps';fpsMeter.textContent='Measuring FPS…';fpsMeter.title=renderer.gpuName;renderControls.append(graphicsLabel,fpsMeter);if(renderer.softwareGPU){const warning=document.createElement('span');warning.textContent='SOFTWARE GPU';warning.title='Chrome is rendering graphics without hardware acceleration.';renderControls.append(warning);}document.querySelector('.race-panel').append(renderControls);
const buildLabel=document.createElement('span');buildLabel.id='build-version';buildLabel.textContent='BUILD …';buildLabel.title='Compare this build ID on both computers after refreshing.';renderControls.append(buildLabel);
fetch('/build.json',{cache:'no-store',signal:AbortSignal.timeout(4000)}).then(response=>{if(!response.ok)throw new Error();return response.json();}).then(info=>{buildLabel.textContent=`BUILD ${info.build}`;}).catch(()=>{buildLabel.textContent='BUILD UNAVAILABLE';});
const newGame=()=>mode==='combat'?createBattle(selected,track):createRace(selected,track);
const useWeapon=()=>network.active?network.action('fire'):mode==='combat'?fireBattle(race):useItem(race);
const switchWeapon=()=>network.active?network.action('cycle'):cycleItem(race);
const chaff=()=>network.active?network.action('chaff'):mode==='combat'?releaseChaff(race):false;
const turbo=()=>network.active?network.action('turbo'):mode==='combat'?useBattleTurbo(race):useTurbo(race);
const somersault=()=>network.active?network.action('somersault'):mode==='combat'?somersaultBattle(race):false;
const mobilePanel=document.createElement('div');mobilePanel.className='mobile-panel';mobilePanel.classList.toggle('hidden',!mobile);
const tiltButton=document.createElement('button'),centerButton=document.createElement('button'),autoButton=document.createElement('button'),mobileHint=document.createElement('span');
const mobileScreenButton=document.createElement('button');mobileScreenButton.id='mobile-fullscreen';mobileScreenButton.textContent='FULL SCREEN';mobileScreenButton.onclick=()=>mobileImmersive?exitMobileFullscreen():enterMobileFullscreen();
tiltButton.id='enable-tilt';tiltButton.textContent='ENABLE TILT';centerButton.textContent='RECENTER';autoButton.id='auto-fire';autoButton.textContent='AUTO FIRE: ON';autoButton.setAttribute('aria-pressed',String(autoFire));mobileHint.textContent='Tilt mode steers and drives. Brake and other touch controls stay available.';
const orientation=event=>{if(!document.hidden)tilt.sample(event.beta,event.gamma,screen.orientation?.angle??0);};
tiltButton.onclick=async()=>{
  if(tilt.enabled){tilt.enabled=false;tilt.recenter();window.removeEventListener('deviceorientation',orientation);tiltButton.textContent='ENABLE TILT';mobileHint.textContent='Tilt off. Use the touch controls.';return;}
  try{
    await allowTilt({mobile,secure:isSecureContext,orientation:window.DeviceOrientationEvent});
    tilt.enabled=true;tilt.recenter();window.addEventListener('deviceorientation',orientation);tiltButton.textContent='TILT: ON';mobileHint.textContent='Hold your phone comfortably, then tilt left or right. Brake to slow down.';
    setTimeout(()=>{if(tilt.enabled&&tilt.baseline===null)mobileHint.textContent='No motion data yet. Tilt your phone or use the touch controls.';},2500);
  }catch(error){mobileHint.textContent=error.message;}
};
centerButton.onclick=()=>{tilt.recenter();mobileHint.textContent='Hold your phone in your preferred position to recenter.';};
autoButton.onclick=()=>{autoFire=!autoFire;autoButton.textContent=`AUTO FIRE: ${autoFire?'ON':'OFF'}`;autoButton.setAttribute('aria-pressed',String(autoFire));};
mobilePanel.append(tiltButton,centerButton,autoButton,mobileScreenButton,mobileHint);racePanel.append(mobilePanel);if(mobile)racePanel.append(document.querySelector('.touch-controls'));
const modeSwitch=document.createElement('nav');modeSwitch.className='mode-switch';modeSwitch.setAttribute('aria-label','Game mode');
const selectedMaps={race:0,combat:0};
for(const [value,label] of [['race','🏁 GRAND PRIX'],['combat','⚔ ARENA BATTLE']]){const button=document.createElement('button');button.id=`mode-${value}`;button.textContent=label;button.setAttribute('aria-pressed',String(value===mode));button.onclick=()=>{if(mode===value)return;mode=value;track=selectedMaps[mode];resetMap();};modeSwitch.append(button);}
document.querySelector('.game-layout').before(modeSwitch);
const mapSwitch=document.createElement('nav');mapSwitch.className='map-switch';mapSwitch.setAttribute('aria-label','Choose map');
const mapCaption=document.createElement('strong');mapCaption.textContent='CHOOSE MAP';mapSwitch.append(mapCaption);
const mapButtons=Array.from({length:2},(_,index)=>{const button=document.createElement('button');button.id=`map-choice-${index}`;button.type='button';button.onclick=()=>chooseMap(index);mapSwitch.append(button);return button;});
const mapHelp=document.createElement('small');mapHelp.textContent='Choosing another map starts a fresh game.';mapSwitch.append(mapHelp);modeSwitch.after(mapSwitch);
function resetMap(){race=newGame();lastPhase='';lastCount=-1;keys.clear();updateMapLabels();}
function chooseMap(index){if(index===track)return;if(network.active){if(network.isHost)network.control('arena',index);return;}track=index;selectedMaps[mode]=index;resetMap();}
const network=new NetworkGame({anchor:modeSwitch,keys,driver:()=>selected,arena:()=>track,unlock:()=>audio.unlock(),sound:type=>audio.event(type),onState:world=>{
  const changed=mode!=='combat'||track!==world.arena;
  const driverChanged=selected!==world.driver;
  race=world;mode='combat';track=world.arena;if(changed){lastPhase='';updateMapLabels();}
  document.querySelector('.race-meta').textContent=`10 KILLS · 3 MIN · ${network.state.players.length+network.state.bots} FIGHTERS`;
  if(changed||driverChanged)showDriver(world.driver);
},onLeave:()=>{race=newGame();lastPhase='';keys.clear();updateMapLabels();}});
const leaderboard=document.createElement('section');leaderboard.className='leaderboard hidden';document.querySelector('aside').append(leaderboard);
const finalResults=document.createElement('section');finalResults.id='match-results';finalResults.className='match-results hidden';finalResults.setAttribute('aria-label','Final leaderboard');$('start').before(finalResults);let resultsKey='';
function showResults(){
  const visible=race.phase==='finished';finalResults.classList.toggle('hidden',!visible);$('message').classList.toggle('results-visible',visible);
  if(!visible){resultsKey='';return;}
  const rows=matchResults(race),version=JSON.stringify([mode,rows]);if(version===resultsKey)return;resultsKey=version;
  const table=document.createElement('table'),caption=document.createElement('caption');caption.textContent='FINAL LEADERBOARD';table.append(caption);
  const header=table.createTHead().insertRow();for(const label of mode==='combat'?['Place','Player','Kills','Deaths']:['Place','Player','Time']){const cell=document.createElement('th');cell.scope='col';cell.textContent=label;header.append(cell);}
  const body=table.createTBody();
  for(const result of rows){const row=body.insertRow();row.classList.toggle('you',result.you);for(const value of mode==='combat'?[result.place,result.name,result.kills,result.deaths]:[result.place,result.name,result.time===null?'DNF':timeLabel(result.time)])row.insertCell().textContent=String(value);}
  finalResults.replaceChildren(table);
}
const routeHint=document.createElement('div');routeHint.className='route-hint';document.querySelector('.viewport').append(routeHint);
const nameplateLayer=document.createElement('div');nameplateLayer.className='kart-nameplates';nameplateLayer.setAttribute('aria-hidden','true');document.querySelector('.viewport').append(nameplateLayer);const nameplateNodes=new Map();
const mobileLock=document.createElement('div');mobileLock.id='mobile-lock';mobileLock.className='mobile-lock hidden';document.querySelector('.viewport').append(mobileLock);
const driftMeter=document.createElement('div');driftMeter.className='drift-meter hidden';const driftLabel=document.createElement('strong'),driftCharge=document.createElement('progress'),driftHelp=document.createElement('small');driftCharge.max=1.2;driftCharge.setAttribute('aria-label','Drift boost charge');driftHelp.textContent='RELEASE DRIFT TO BOOST';driftMeter.append(driftLabel,driftCharge,driftHelp);document.querySelector('.viewport').append(driftMeter);
const brakeButton=document.createElement('button');brakeButton.dataset.key='arrowdown';brakeButton.textContent='BRAKE';brakeButton.className='hidden';document.querySelector('.touch-controls').append(brakeButton);
const chaffButton=document.createElement('button');chaffButton.id='release-chaff';chaffButton.className='chaff-button hidden';chaffButton.type='button';chaffButton.onclick=chaff;document.querySelector('.viewport').append(chaffButton);
const somersaultButton=document.createElement('button');somersaultButton.id='somersault';somersaultButton.className='chaff-button somersault-button hidden';somersaultButton.type='button';somersaultButton.onclick=somersault;document.querySelector('.viewport').append(somersaultButton);
const incomingWarning=document.createElement('div');incomingWarning.id='incoming-warning';incomingWarning.className='incoming-warning hidden';incomingWarning.setAttribute('role','alert');incomingWarning.setAttribute('aria-atomic','true');
const incomingTitle=document.createElement('strong'),incomingHelp=document.createElement('span');incomingWarning.append(incomingTitle,incomingHelp);document.querySelector('.viewport').append(incomingWarning);
const killCelebration=new KillCelebration(),whackBanner=document.createElement('div');whackBanner.id='whack-banner';whackBanner.className='whack-banner hidden';whackBanner.setAttribute('role','status');whackBanner.setAttribute('aria-atomic','true');document.querySelector('.viewport').append(whackBanner);let whackKey=null;
const chaffNotice=new ChaffNotice(),avertedBanner=document.createElement('div');avertedBanner.id='averted-notice';avertedBanner.className='incoming-warning averted-notice hidden';avertedBanner.setAttribute('role','status');avertedBanner.setAttribute('aria-atomic','true');const avertedTitle=document.createElement('strong'),avertedHelp=document.createElement('span');avertedTitle.textContent='✓ MISSILE AVERTED';avertedHelp.textContent='CHAFF BROKE THE LOCK';avertedBanner.append(avertedTitle,avertedHelp);document.querySelector('.viewport').append(avertedBanner);
function updateMapLabels(){const maps=mode==='combat'?arenas:tracks,info=maps[track];$('track-name').textContent=info.name;$('track-label').textContent=info.name.toUpperCase();$('track-desc').textContent=info.desc;$('difficulty').textContent=mode==='combat'?'MELEE':info.difficulty;document.querySelector('.race-meta').textContent=mode==='combat'?'10 KILLS · 3 MIN · 6 FIGHTERS':'3 LAPS · 6 RACERS';document.querySelector('.race-bar .divider').nextElementSibling.textContent=mode==='combat'?'DEATHMATCH':'GRAND PRIX';for(const button of modeSwitch.children)button.setAttribute('aria-pressed',String(button.id===`mode-${mode}`));for(const [index,button] of mapButtons.entries()){button.textContent=maps[index].name;button.setAttribute('aria-pressed',String(index===track));}const next=maps[(track+1)%maps.length];$('change-track').textContent='NEXT MAP →';$('change-track').setAttribute('aria-label',`Switch to ${next.name}`);}
const ammoRack=document.createElement('div');ammoRack.className='ammo-rack';const ammoCards=new Map();
for(const [type,icon,label] of [['hedgehog','🦔','HEDGEHOGS'],['missile','🚀','MISSILES'],['boost','ϟ','TURBOS']]){
  const button=document.createElement('button');button.className='ammo-card';button.id=`ammo-${type}`;button.type='button';
  const symbol=document.createElement('span');symbol.className='ammo-icon';symbol.textContent=icon;
  const count=document.createElement('b');count.id=`${type}-count`;const name=document.createElement('span');name.className='ammo-label';name.textContent=label;
  button.append(symbol,count,name);button.onclick=()=>type==='boost'?turbo():network.active?network.action('select',type):selectItem(race,type);ammoRack.append(button);ammoCards.set(type,{button,count,label,name});
}
document.querySelector('.item-box').prepend(ammoRack);document.querySelector('.item-box small').textContent='SPACE TO FIRE · TAB / Q WEAPONS · X TURBO';
const vulcanStatus=document.createElement('div');vulcanStatus.className='vulcan-status hidden';const vulcanTitle=document.createElement('strong'),vulcanTime=document.createElement('progress');vulcanTime.max=VULCAN_DURATION;vulcanTime.setAttribute('aria-label','Hedgehog Vulcan seconds remaining');vulcanStatus.append(vulcanTitle,vulcanTime);document.querySelector('.item-box').prepend(vulcanStatus);
const finishFlash=document.createElement('div');finishFlash.className='finish-flash hidden';finishFlash.setAttribute('role','status');finishFlash.setAttribute('aria-live','polite');
const finishTitle=document.createElement('strong'),finishDetail=document.createElement('span');finishFlash.append(finishTitle,finishDetail);document.querySelector('.viewport').append(finishFlash);
function announceFinish(){
  finishTitle.textContent=`${race.finishRank}${ordinal(race.finishRank)} PLACE`;
  finishDetail.textContent=finishText();finishFlash.classList.remove('hidden');
}
function finishText(){return `${mode==='combat'?`${race.kills} KILLS`:timeLabel(race.finishTime)} · ${mode==='combat'?'BATTLE':'RACE'} ENDING IN ${Math.ceil(race.finishCountdown)}…`;}
function draw(){
  renderer.draw(race,race.elapsed);drawMap();
  const visible=new Set();
  for(const plate of renderer.nameplates??[]){
    visible.add(plate.id);let label=nameplateNodes.get(plate.id);
    if(!label){label=document.createElement('span');label.className='kart-nameplate';nameplateNodes.set(plate.id,label);nameplateLayer.append(label);}
    if(label.textContent!==plate.name)label.textContent=plate.name;
    label.style.left=`${plate.x}%`;label.style.top=`${plate.y}%`;label.style.borderColor=plate.color;
  }
  for(const [id,label] of nameplateNodes)if(!visible.has(id)){label.remove();nameplateNodes.delete(id);}
}
function mapPoint(t,route=0){const p=sampleTrack(t/(Math.PI*2),0,route);return [140+p.x*.29,64+p.z*.16];}
function drawMap(){
  map.clearRect(0,0,280,126);
  if(mode==='combat'){
    map.fillStyle='#e5e0d9';map.fillRect(78,3,124,120);map.fillStyle='#92839d';for(const [x,z,w,d] of arenas[track].blocks)map.fillRect(140+(x-w/2)*.6,63+(z-d/2)*.6,w*.6,d*.6);
    for(const actor of [race,...race.bots]){if(actor.destroyed)continue;map.fillStyle=actor.color;map.beginPath();map.arc(140+actor.wx*.6,63+actor.wz*.6,actor===race?4:3,0,7);map.fill();}return;
  }
  map.beginPath();for(let i=0;i<=120;i++){const [x,y]=mapPoint(i/120*Math.PI*2);if(i===0)map.moveTo(x,y);if(i>0)map.lineTo(x,y);}map.closePath();map.strokeStyle='#ded9cf';map.lineWidth=17;map.stroke();map.strokeStyle='#faf8f0';map.lineWidth=10;map.stroke();
  for(const [i,branch] of branches.entries()){map.beginPath();for(let j=0;j<=40;j++){const[x,y]=mapPoint((branch.start+(branch.end-branch.start)*j/40)*Math.PI*2,i+1);if(j===0)map.moveTo(x,y);if(j>0)map.lineTo(x,y);}map.strokeStyle='#c6a258';map.lineWidth=4;map.stroke();}
  for(const b of race.bots){const[x,y]=mapPoint(b.s/LENGTH*Math.PI*2,b.route);map.fillStyle=b.color;map.beginPath();map.arc(x,y,3,0,7);map.fill();}const[x,y]=mapPoint(race.s/LENGTH*Math.PI*2,race.route);map.fillStyle='#7251d2';map.beginPath();map.arc(x,y,5,0,7);map.fill();map.strokeStyle='#fff';map.lineWidth=2;map.stroke();map.font='9px monospace';map.fillStyle='#9a91a0';map.textAlign='center';map.fillText('CHOOSE YOUR ROUTE',140,69);
}
function tone(freq,duration=.1){ audio.tone(freq,duration); }
const ordinal=n=>['','ST','ND','RD','TH','TH','TH'][n];
function timeLabel(t){return `${String(Math.floor(t/60)).padStart(2,'0')}:${(t%60).toFixed(2).padStart(5,'0')}`;}
let scoreboardKey='';
function put(id,value){const node=$(id);if(node.textContent!==String(value))node.textContent=value;}
function hud(){
  showResults();
  const whack=killCelebration.sample(race,performance.now()/1000);whackBanner.classList.toggle('hidden',!whack);
  if(!whack)whackKey=null;
  if(whack&&whackKey!==whack.key){
    whackKey=whack.key;const card=document.createElement('div');card.className='whack-card';card.style.setProperty('--victim-color',whack.color);
    const title=document.createElement('span'),name=document.createElement('strong');title.textContent='✦ YOU WHACKED ✦';name.textContent=`“${whack.name}”`;card.append(title,name);whackBanner.replaceChildren(card);
  }
  const threats=incomingMissiles(race);
  avertedBanner.classList.toggle('hidden',!chaffNotice.sample(race,performance.now()/1000)||threats>0);
  incomingWarning.classList.toggle('hidden',threats===0);
  if(threats){
    const title=threats===1?'⚠ INCOMING MISSILE':'⚠ INCOMING MISSILES';
    const help=race.chaff>0&&race.chaffCooldown<=0?'C / CHAFF TO BREAK THE LOCK':'EVADE THE MISSILE';
    if(incomingTitle.textContent!==title)incomingTitle.textContent=title;
    if(incomingHelp.textContent!==help)incomingHelp.textContent=help;
  }
  for(const button of modeSwitch.children)button.disabled=network.active;
  for(const button of mapButtons)button.disabled=network.active&&!network.isHost;
  $('change-track').disabled=network.active&&!network.isHost;$('restart').disabled=network.active&&!network.isHost;
  $('start').disabled=network.active&&!network.isHost&&race.phase!=='paused'&&(network.wantsToPlay||network.readyPending||!['ready','finished'].includes(race.phase));
  if(network.active&&!network.isHost&&['ready','finished'].includes(race.phase)){
    $('start').textContent=network.wantsToPlay?'WAITING FOR HOST ✓':network.readyPending?'SENDING…':'LET’S PLAY ↗';
    $('message').querySelector('small').textContent=network.wantsToPlay?'You’re ready! The host has been notified.':'Let the host know you want to play.';
  }
  for(const button of $('drivers').children)button.disabled=!['ready','finished'].includes(race.phase);
  if(mode==='race'){
    $('position').replaceChildren(document.createTextNode(String(race.rank)),Object.assign(document.createElement('span'),{textContent:ordinal(race.rank)}));
    $('lap').replaceChildren(document.createTextNode(String(Math.min(3,Math.floor(race.s/LENGTH)+1)).padStart(2,'0')+' '),Object.assign(document.createElement('span'),{textContent:'/ 03'}));
    put('timer',timeLabel(race.finishTime??race.elapsed));
  }
  const speedNode=$('speed').querySelector('b'),speedText=String(Math.round(race.speed*.24));if(speedNode.textContent!==speedText)speedNode.textContent=speedText;put('toast',race.finishRank===null&&race.noticeTime>0?race.notice:'');
  document.querySelector('.position small').textContent=mode==='combat'?'KILLS':'POSITION';document.querySelector('.lap small').textContent=mode==='combat'?'HEALTH':'LAP';document.querySelector('.timer small').textContent=mode==='combat'?'TIME LEFT':'RACE TIME';
  leaderboard.classList.toggle('hidden',mode!=='combat');
  chaffButton.classList.toggle('hidden',mode!=='combat');chaffButton.textContent=`C · CHAFF ${race.chaff??0}`;chaffButton.disabled=mode!=='combat'||race.phase!=='racing'||race.finishCountdown!==null||race.destroyed>0||race.chaff<=0||race.chaffCooldown>0;chaffButton.setAttribute('aria-label',`Release chaff, ${race.chaff??0} charges remaining. Keyboard C.`);
  somersaultButton.classList.toggle('hidden',mode!=='combat');somersaultButton.disabled=race.phase!=='racing'||race.finishCountdown!==null||race.destroyed>0||(race.somersaultCooldown??0)>1e-8;somersaultButton.textContent=(race.somersaultCooldown??0)>1e-8?`Z · ${race.somersaultCooldown.toFixed(1)}s`:'Z · SOMERSAULT';somersaultButton.setAttribute('aria-label','Somersault: jump and turn 180 degrees. Keyboard Z.');
  routeHint.textContent='';
  driftMeter.classList.toggle('hidden',mode!=='combat'||!race.wasDrifting||race.phase!=='racing');driftCharge.value=race.drift;driftLabel.textContent=race.drift>=.85?'SUPER BOOST READY':race.drift>=.45?'BOOST READY':'DRIFT CHARGING';driftMeter.classList.toggle('charged',race.drift>=.45);driftMeter.classList.toggle('super',race.drift>=.85);
  if(mode==='combat'){
    put('position',`${race.kills} / ${race.targetScore}`);put('lap','♥'.repeat(race.health));$('lap').setAttribute('aria-label',`${race.health} of ${MAX_HEALTH} hearts`);put('timer',timeLabel(Math.max(0,race.duration-(race.finishTime??race.elapsed))));
    const order=standings(race),version=JSON.stringify(order.map(actor=>[actor.id,actor.name,actor.driver,actor.kills,actor.deaths,actor===race]));
    if(version!==scoreboardKey){scoreboardKey=version;const title=document.createElement('strong');title.textContent='LEADERBOARD · KILLS / DEATHS';leaderboard.replaceChildren(title,...order.map(actor=>{const line=document.createElement('div');line.textContent=`${actor===race?'YOU':actor.name??drivers[actor.driver].name.split(' ')[0]}  ${actor.kills} / ${actor.deaths}`;line.classList.toggle('you',actor===race);return line;}));}
    if(race.destroyed>0)routeHint.textContent=`WRECKED · RESPAWN IN ${Math.ceil(race.destroyed)}`;
    if(race.shield>0&&!race.destroyed)routeHint.textContent='SPAWN SHIELD';
    const latest=race.killFeed[0];if(latest&&race.elapsed-latest.time<3&&!(race.vulcan>0&&race.noticeTime>0&&race.notice.startsWith('2-KILL')))$('toast').textContent=latest.text;
  }
  if(mode==='race'&&race.phase==='racing'){
    const progress=(race.s%LENGTH)/LENGTH,upcoming=branches.find(b=>b.start-progress>0&&b.start-progress<.035);
    if(upcoming)routeHint.textContent=`${upcoming.side<0?'← KEEP LEFT':'KEEP RIGHT →'} FOR ${upcoming.name}`;
    if(race.route)routeHint.textContent=branches[race.route-1].name;
  }
  if(mode==='race')$('lap').removeAttribute('aria-label');
  if(race.finishRank!==null&&race.phase==='racing'){finishDetail.textContent=finishText();$('status').textContent=`FINISHED ${race.finishRank}${ordinal(race.finishRank)}`;}
  $('item').textContent=({boost:'ϟ',hedgehog:'🦔',missile:'🚀'})[race.item]||'–';$('item-name').textContent=({boost:'AFTERBURNER READY',hedgehog:`HEDGEHOG × ${race.ammo}`,missile:`MISSILE × ${race.missiles} · HOMING`})[race.item]||'EMPTY · COLLECT AMMO';
  const vulcan=mode==='combat'&&race.vulcan>0;
  const vulcanVisible=vulcan&&race.phase==='racing'&&race.finishCountdown===null;
  document.querySelector('.viewport').classList.toggle('vulcan-active',vulcanVisible);routeHint.classList.toggle('vulcan-banner',vulcanVisible);routeHint.classList.toggle('vulcan-ending',vulcanVisible&&race.vulcan<=3);
  if(vulcanVisible)routeHint.textContent=`${race.vulcan<=3?'VULCAN ENDING':'VULCAN ACTIVE'} · ${race.vulcan.toFixed(1)}s`;
  vulcanStatus.classList.toggle('hidden',!vulcan||race.phase!=='racing');vulcanTitle.textContent=`HEDGEHOG VULCAN · ${(race.vulcan??0).toFixed(1)}s`;vulcanTime.value=race.vulcan??0;
  if(vulcan&&race.item==='hedgehog')$('item-name').textContent='VULCAN · HOLD SPACE TO SPRAY';
  for(const [type,card] of ammoCards){const count={hedgehog:race.ammo,missile:race.missiles,boost:race.turbos}[type],powered=vulcan&&type==='hedgehog',boost=type==='boost';card.count.textContent=powered?'∞':count;card.name.textContent=powered?'VULCAN':boost?'X · TURBO':card.label;card.button.disabled=(!powered&&count===0)||race.phase==='finished'||boost&&(race.phase!=='racing'||race.destroyed>0||race.finishCountdown!==null||race.boost>0);card.button.classList.toggle('selected',!boost&&race.item===type);card.button.classList.toggle('vulcan',powered);card.button.setAttribute('aria-pressed',String(!boost&&race.item===type));card.button.setAttribute('aria-label',boost?`Use turbo, ${count} charges remaining. Keyboard X.`:`${powered?'Unlimited Vulcan hedgehogs':`${count} ${card.label.toLowerCase()}`}${race.item===type?', selected':''}`);}
  if(race.phase==='countdown'){const n=Math.ceil(race.countdown);if(n!==lastCount){tone(300+n*100);lastCount=n;}$('message').querySelector('h2').textContent=n;}
  if(lastPhase===race.phase)return;lastPhase=race.phase;
  const battle=mode==='combat',controls=document.querySelectorAll('.control');brakeButton.classList.toggle('hidden',!battle);
  controls[0].querySelector('span').textContent=battle?'WASD works · ↓ / S reverses':'WASD works, too';
  controls[1].querySelector('kbd').textContent='SHIFT';controls[1].querySelector('strong').textContent=battle?'Slide into a U-turn':'Drift the corners';controls[1].querySelector('span').textContent=battle?'Hold + steer, release to launch':'Hold + steer, release to boost';
  controls[2].querySelector('span').textContent=battle?'Q weapons · X turbo · C chaff · Z flip':'Space fires · Q weapons · X turbo';controls[3].querySelector('span').textContent=battle?'Pause your battle':'Pause your race';
  canvas.setAttribute('aria-label',battle?'Combat arena. Arrow keys drive, Shift and steering drift into a U-turn, release Shift to boost. Hold Space to shoot, Tab or Q changes weapons, X uses turbo, Z jumps and turns 180 degrees, C releases chaff to distract missiles.':'Kart racing track. Arrow keys drive, Shift drifts, Space fires, Tab or Q changes weapons, X uses turbo.');
  $('map').setAttribute('aria-label',battle?'Arena map with cover and fighter positions':'Track map with alternate routes and racer positions');
  if(['ready','countdown','finished','paused'].includes(race.phase))finishFlash.classList.add('hidden');
  if(race.phase==='racing'&&race.finishRank!==null)finishFlash.classList.remove('hidden');
  $('message').classList.toggle('hidden',race.phase==='racing');
  const button=$('start'),message=$('message');button.classList.toggle('hidden',race.phase==='countdown');
  $('pause').textContent=race.phase==='paused'?'▶':'Ⅱ';
  switch(race.phase){
    case 'ready':message.querySelector('.pill').textContent=mode==='combat'?'EVERY KART FOR ITSELF':'THE GRID IS WAITING';message.querySelector('h2').textContent=mode==='combat'?'Small karts. Big trouble.':'Born to be wild.';message.querySelector('p').textContent=mode==='combat'?'First to 10 kills · 3 minutes · Hold Space to fire':'Six racers. Three laps. Two alternate routes.';message.querySelector('small').textContent=`${mode==='combat'?arenas[track].name:tracks[track].name} · Press Enter to start`;button.textContent=mode==='combat'?'LET’S BATTLE ↗':'LET’S RACE ↗';$('status').textContent='READY WHEN YOU ARE';break;
    case 'countdown':message.querySelector('.pill').textContent='ON YOUR MARKS';message.querySelector('p').textContent='Hold ↑ or W to accelerate';message.querySelector('small').textContent='';$('status').textContent='LIGHTS OUT IN 3…';break;
    case 'racing':tone(850,.3);$('status').textContent='MAKE SOME PIXEL DUST';break;
    case 'paused':message.querySelector('.pill').textContent='PIT STOP';message.querySelector('h2').textContent='Catch your breath.';message.querySelector('p').textContent=network.active?'The match continues while you are away.':'Your rivals can wait.';button.textContent='BACK TO THE RACE ↗';$('status').textContent='RACE PAUSED';break;
    case 'finished':keys.clear();message.querySelector('.pill').textContent=mode==='combat'?'BATTLE COMPLETE':'RACE COMPLETE';message.querySelector('h2').textContent=`${race.finishRank}${ordinal(race.finishRank)} PLACE`;message.querySelector('p').textContent=mode==='combat'?`${race.kills} kills · ${race.deaths} deaths · ${timeLabel(race.finishTime)}`:`Finished ${race.finishRank}${ordinal(race.finishRank).toLowerCase()} of 6 · ${timeLabel(race.finishTime)}`;message.querySelector('small').textContent='';button.textContent='PLAY AGAIN ↗';$('status').textContent='MATCH COMPLETE';break;
  }
}
function showDriver(index){selected=index;[...$('drivers').children].forEach((b,i)=>{b.classList.toggle('selected',i===index);b.setAttribute('aria-pressed',String(i===index));});const d=drivers[index];$('driver-name').textContent=d.name;$('driver-desc').textContent=d.desc;$('driver-number').textContent=String(index+1).padStart(2,'0');for(const [id,value] of [['speed-stat',d.speed],['handling-stat',d.handling],['accel-stat',d.accel]]){$(id).replaceChildren(...Array.from({length:5},(_,i)=>Object.assign(document.createElement('i'),{className:i<value?'on':''})));}}
function selectDriver(index){if(network.active){network.chooseDriver(index);return;}showDriver(index);race=newGame();lastPhase='';}
drivers.forEach((d,i)=>{const b=document.createElement('button');b.className='driver';b.textContent=d.emoji;b.title=d.name;b.setAttribute('aria-label',d.name);b.onclick=()=>selectDriver(i);$('drivers').append(b);});
function start(){if(mobile)enterMobileFullscreen();audio.unlock().catch(()=>{$('sound').textContent='CLICK FOR SOUND';});if(network.active){if(network.paused){network.pause();return;}if(network.isHost){network.control('start');return;}network.requestPlay();return;}if(race.phase==='paused'){race.phase=race.resumePhase||'racing';return;}if(race.phase==='racing'||race.phase==='countdown')return;race=newGame();race.phase='countdown';lastCount=-1;tone(400);}
function pause(){if(network.active){network.pause();return;}if(race.phase==='paused'){race.phase=race.resumePhase;return;}if(!['racing','countdown'].includes(race.phase))return;race.resumePhase=race.phase;race.phase='paused';keys.clear();}
$('start').onclick=start;$('pause').onclick=pause;$('restart').onclick=()=>{if(network.active){network.control('reset');return;}race=newGame();lastPhase='';keys.clear();};
$('change-track').onclick=()=>chooseMap((track+1)%mapButtons.length);
$('sound').textContent='SOUND ON';$('sound').setAttribute('aria-label','Mute sound');
$('sound').onclick=()=>{audio.toggle();$('sound').textContent=audio.enabled?'SOUND ON':'SOUND OFF';$('sound').setAttribute('aria-label',audio.enabled?'Mute sound':'Enable sound');tone(660);};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement){await document.exitFullscreen();return;}await document.querySelector('.viewport').requestFullscreen();}catch{race.notice='Fullscreen unavailable in this browser';race.noticeTime=3;}};
window.addEventListener('keydown',e=>{
  if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||e.target instanceof HTMLSelectElement||e.target.isContentEditable)return;
  const playing=['racing','countdown'].includes(race.phase),key=e.key.toLowerCase();
  if(key==='tab'){
    if(!playing||e.shiftKey||e.ctrlKey||e.altKey||e.metaKey)return;
    e.preventDefault();if(!e.repeat)switchWeapon();return;
  }
  if(e.target instanceof HTMLButtonElement&&[' ','Enter'].includes(e.key)&&!playing)return;
  if(['arrowup','arrowdown','arrowleft','arrowright',' ','shift'].includes(key))e.preventDefault();
  keys.add(key);if(e.repeat)return;
  if(network.active)network.input();
  switch(key){case 'enter':start();break;case 'escape':case 'p':pause();break;case ' ':useWeapon();break;case 'q':switchWeapon();break;case 'x':if(!e.ctrlKey&&!e.metaKey&&!e.altKey)turbo();break;case 'z':if(!e.ctrlKey&&!e.metaKey&&!e.altKey)somersault();break;case 'c':if(!e.ctrlKey&&!e.metaKey&&!e.altKey)chaff();break;}
});
window.addEventListener('keyup',e=>{keys.delete(e.key.toLowerCase());if(network.active)network.input();});window.addEventListener('blur',()=>{keys.clear();if(['racing','countdown'].includes(race.phase))pause();});document.addEventListener('visibilitychange',()=>{if(document.hidden&&['racing','countdown'].includes(race.phase))pause();});
window.addEventListener('blur',()=>tilt.recenter());document.addEventListener('visibilitychange',()=>{if(document.hidden)tilt.recenter();});
for(const event of ['pointerdown','keydown'])window.addEventListener(event,()=>{if(network.active)audio.unlock().catch(()=>{});},{once:true});
document.querySelectorAll('[data-key]').forEach(b=>{b.addEventListener('pointerdown',e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys.add(b.dataset.key);if(b.dataset.key===' ')useWeapon();if(network.active)network.input();});for(const name of ['pointerup','pointercancel','lostpointercapture'])b.addEventListener(name,()=>{keys.delete(b.dataset.key);if(network.active)network.input();});});
selectDriver(0);updateMapLabels();
let nextVisualFrame=0;
function frame(t){if(t+1<nextVisualFrame){requestAnimationFrame(frame);return;}nextVisualFrame=Math.max(nextVisualFrame+1000/60,t+1);const dt=lastTime?Math.min((t-lastTime)/1000,.05):0;lastTime=t;renderer.recordFrame(t);const performanceText=`${renderer.fps||'…'} FPS · ${renderer.pixelRatio().toFixed(2)}×${network.active?` · ${network.rtt?Math.round(network.rtt*1000):'…'} ms ping`:''}`;if(fpsMeter.textContent!==performanceText)fpsMeter.textContent=performanceText;const driving=tilt.keys(keys,mobile&&race.phase==='racing'&&!document.hidden);if(network.active){race=network.render(dt,driving)??race;}if(!network.active&&mode==='combat')tickBattle(race,driving,dt);if(!network.active&&mode==='race')tick(race,driving,dt);const lock=mobileLockTarget(race,mobile,autoFire&&!document.hidden);mobileLock.classList.toggle('hidden',!lock);if(lock){mobileLock.textContent='LOCKED · AUTO FIRE';if(useWeapon()&&network.active)race=network.render(0,driving)??race;}for(const event of race.events){audio.event(event);if(event==='victory'||event==='finish')announceFinish();}race.events.length=0;const priority={win:5,lap:4,cheer:3,hurt:2,pass:1};race.voices.sort((a,b)=>priority[b.cue]-priority[a.cue]);for(const call of race.voices)audio.voice(call);race.voices.length=0;audio.update(race);draw();hud();requestAnimationFrame(frame);}requestAnimationFrame(frame);
