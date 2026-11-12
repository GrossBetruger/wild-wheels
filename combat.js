import {boostDuration, createRace, drivers, START_HEDGEHOGS, itemCapacity } from './engine.js';
import {frozen,tickSpecials,useSpecial} from './special-abilities.js';
export const VULCAN_DURATION=15;
export const HEDGEGUARD_DURATION=25;
export const MAX_HEALTH=6;
export const RECOVERY_HEALTH=3;
export function recoveryInterval(driver){return 14-2*drivers[driver].cuteness;}
export function hedgehogRecoveryInterval(driver){return 2.25-.25*drivers[driver].cuteness;}
export const MOVEMENT_DT=1/60;
export const SOMERSAULT_DURATION=.55;
export const BOMB_FALL_TIME=.9;
export const BOMB_RADIUS=22;
export const BOMB_OUTER_RADIUS=28;
export const RADIATION_DURATION=8;
export const RADIATION_INTERVAL=1;
export const CHAFF_RADIUS=40;
export const BOMB_START_AMMO=2;
export const BOMB_RECHARGE=10;
export const STINK_RADIUS=14;
export const DIZZY_DURATION=8;

export const arenas=[
  {name:'Scrapyard',desc:'Container cover. Wide flanking lanes.',size:96,ground:'#8b927d',wall:'#d7794d',sky:'#b5d3d9',blocks:[[-40,-35,34,10],[40,35,34,10],[-35,35,10,34],[35,-35,10,34],[0,0,14,14]]},
  {name:'Crossfire Court',desc:'A central fortress. Four ways around.',size:96,ground:'#8e849b',wall:'#8063b2',sky:'#c8bbd8',blocks:[[0,0,28,28],[-55,0,12,36],[55,0,12,36],[0,-55,36,12],[0,55,36,12]]},
];
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const angleDelta=(a,b)=>Math.atan2(Math.sin(a-b),Math.cos(a-b));
const distance=(a,b)=>Math.hypot(a.wx-b.wx,a.wz-b.wz);
export function combatPose(actor){return {x:actor.wx,z:actor.wz,tx:Math.sin(actor.heading),tz:Math.cos(actor.heading)};}
export function blocked(arena,x,z,padding=2){return Math.abs(x)>arena.size-padding||Math.abs(z)>arena.size-padding||arena.blocks.some(([bx,bz,w,d])=>Math.abs(x-bx)<w/2+padding&&Math.abs(z-bz)<d/2+padding);}
function clearShot(arena,a,b){const d=distance(a,b);for(let t=3;t<d;t+=3)if(blocked(arena,a.wx+(b.wx-a.wx)*t/d,a.wz+(b.wz-a.wz)*t/d,.4))return false;return true;}
function spawn(r,actor,initial=false){
  const actors=[r,...r.bots],candidates=Array.from({length:8},(_,i)=>{const angle=i*Math.PI/4;return {wx:Math.sin(angle)*78,wz:Math.cos(angle)*78};});
  const choice=initial?candidates[Math.floor(actor.id*8/6)]:candidates.sort((a,b)=>Math.min(...actors.filter(k=>k!==actor&&!k.destroyed).map(k=>distance(b,k)),999)-Math.min(...actors.filter(k=>k!==actor&&!k.destroyed).map(k=>distance(a,k)),999))[0];
  actor.wx=choice.wx;actor.wz=choice.wz;actor.heading=Math.atan2(-choice.wx,-choice.wz);actor.speed=0;actor.health=3;actor.destroyed=0;actor.shield=0;actor.ammo=START_HEDGEHOGS;actor.missiles=1;actor.turbos=1;actor.item='hedgehog';actor.fireCooldown=.5;actor.vx=0;actor.boost=0;actor.path=[];
  actor.motionHeading=actor.heading;actor.cameraHeading=actor.heading;actor.drift=0;actor.wasDrifting=false;actor.driftTrail=null;actor.driftEmit=0;
  actor.killStreak=0;actor.vulcan=0;actor.healTimer=0;actor.hedgeShield=0;actor.tehilim=0;
  actor.chaff=4;actor.chaffCooldown=0;
  actor.somersault=0;actor.somersaultCooldown=0;actor.somersaultCameraStart=actor.cameraHeading;
  actor.dizzy=0;actor.stinkContributors=new Map();
}
export function createBattle(driver=0,arena=0,random=Math.random){
  const r=createRace(driver,0,random);r.specialAbilities=true;r.timeStop=0;r.timeOwner=null;r.mode='combat';r.arena=arena;r.duration=180;r.targetScore=10;r.id=0;r.color=drivers[driver].color;r.killFeed=[];r.driftParticles=[];r.chaffClouds=[];r.chaffSequence=0;r.bombs=[];r.bombSequence=0;r.stinkClouds=[];
  const actors=[r,...r.bots];for(const [id,actor] of actors.entries())Object.assign(actor,{id,wx:0,wz:0,heading:0,kills:0,deaths:0,health:3,destroyed:0,shield:0,celebrate:0,fireCooldown:0,reload:0,brain:0,path:[],bomber:false,bombAmmo:0,bombReload:0,stinkAmmo:0});
  for(const actor of actors)spawn(r,actor,true);
  r.supplies=[[-70,-65,'missile'],[70,65,'missile'],[-65,70,'hedgehog'],[65,-70,'hedgehog'],[-12,48,'boost'],[12,-48,'boost'],[-70,0,'health'],[70,0,'health'],[-50,-50,'hedgeproof'],[50,50,'tehilim']].map(([wx,wz,kind],id)=>({id,version:0,wx,wz,kind,cooldown:['hedgeproof','tehilim'].includes(kind)?30:0}));
  return r;
}
export function battleActive(world){return world.mode==='combat'&&world.phase==='racing';}
function humanControlled(world,actor){return actor.human||actor===world&&!world.multiplayer;}
function canAct(world,actor){return !frozen(world,actor.id)&&battleActive(world)&&!actor.inactive&&!actor.bomber&&actor.destroyed<=0&&(world.finishCountdown===null||humanControlled(world,actor));}
export function standings(r){
  const actors=[r,...r.bots].filter(actor=>!actor.inactive),top=Math.max(...actors.map(actor=>actor.kills)),host=r.multiplayer?actors.find(actor=>actor.id===r.host&&actor.kills===top):null;
  return actors.sort((a,b)=>b.kills-a.kills||Number(b===host)-Number(a===host)||a.deaths-b.deaths||a.id-b.id);
}
export function equipBomber(actor){Object.assign(actor,{bomber:true,bombAmmo:BOMB_START_AMMO,stinkAmmo:2,bombReload:0,speed:0,shield:0,destroyed:0,dizzy:0});return actor;}
export function validBombTarget(world,point){return Boolean(point)&&Number.isFinite(point.wx)&&Number.isFinite(point.wz)&&Math.abs(point.wx)<=arenas[world.arena].size&&Math.abs(point.wz)<=arenas[world.arena].size;}
export function dropBomb(world,actor,point,actionId){
  if(frozen(world,actor.id))return false;
  const kind=point?.kind??'abomb',resource=kind==='stink'?'stinkAmmo':'bombAmmo';
  if(!['abomb','stink'].includes(kind)||!actor.bomber||actor.inactive||!battleActive(world)||world.finishCountdown!==null&&!humanControlled(world,actor)||!(actor[resource]>=1)||!validBombTarget(world,point))return false;
  actor[resource]--;world.bombSequence++;
  const bomb={id:world.bombSequence,kind,owner:actor.id,wx:point.wx,wz:point.wz,age:0,color:actor.color,...(actionId==null?{}:{actionId})};world.bombs.push(bomb);
  sound(world,'bombDrop',{...point,owner:actor.id},actionId==null?undefined:`action:${actionId}`);return bomb;
}
export function incomingMissiles(world){
  if(!battleActive(world)||world.destroyed>0)return 0;
  return world.projectiles.filter(shot=>shot.kind==='missile'&&shot.target===world.id&&shot.owner!==world.id&&shot.life>0&&shot.decoy==null&&!shot.chaffed).length;
}
function voice(r,actor,cue){if((actor.voiceCooldown??0)>0&&cue!=='win')return;actor.voiceCooldown=1.5;r.voices.push({driver:actor.driver,cue,pan:actor===r?0:clamp((actor.wx-r.wx)/70,-.8,.8),volume:actor===r?1:.6});}
function sound(r,type,actor,key){r.events.push(r.multiplayer?{type,owner:actor.owner??actor.id,wx:actor.wx,wz:actor.wz,id:`${r.soundEpoch}:${r.soundSequence=(r.soundSequence??0)+1}`,...(key?{key}:{})} :type);}
function fx(r,type,actor,key){sound(r,type,actor,key);r.effects.push({type,wx:actor.wx,wz:actor.wz,age:0,life:type==='ash'?4.3:type==='explosion'?2.5:.65});}
function divertMissiles(r,cloud){
  let diverted=0;
  for(const shot of r.projectiles){
    if(shot.kind!=='missile'||shot.target!==cloud.owner||shot.decoy!=null||distance(shot,cloud)>CHAFF_RADIUS||!clearShot(arenas[r.arena],shot,cloud))continue;
    shot.target=null;shot.decoy=cloud.id;shot.decoyOwner=cloud.owner;shot.decoyCenter={wx:cloud.wx,wz:cloud.wz};shot.life=Math.max(shot.life??0,4.5);diverted++;
  }
  if(diverted){cloud.diversions=(cloud.diversions??0)+diverted;cloud.divertedAt=r.elapsed;sound(r,'chaffDivert',cloud);}
  return diverted;
}
export function releaseChaff(r,actor=r){
  if(!canAct(r,actor)||actor.chaff<=0||actor.chaffCooldown>0)return false;
  const tx=Math.sin(actor.heading),tz=Math.cos(actor.heading),side=r.chaffSequence%2?1:-1;
  const candidates=[18,12,6].flatMap(ahead=>[side,-side].map(s=>({wx:actor.wx+tx*ahead+tz*s*ahead*.55,wz:actor.wz+tz*ahead-tx*s*ahead*.55})));
  const point=candidates.find(p=>!blocked(arenas[r.arena],p.wx,p.wz,.5)&&clearShot(arenas[r.arena],actor,p))??{wx:actor.wx+tx*2,wz:actor.wz+tz*2};
  const cloud={...point,originX:actor.wx,originZ:actor.wz,id:r.chaffSequence++,owner:actor.id,color:actor.color??drivers[actor.driver].color,age:0,life:8};
  actor.chaff--;actor.chaffCooldown=.65;r.chaffClouds.push(cloud);const diverted=divertMissiles(r,cloud);
  if(r.multiplayer||distance(actor,r)<90)sound(r,'chaff',actor);
  actor.notice=diverted?`CHAFF · ${diverted} MISSILE${diverted===1?'':'S'} DIVERTED`:'CHAFF RELEASED';actor.noticeTime=2;
  return true;
}
export function makeProjectile(r,actor){
  const kind=actor.item==='missile'&&actor.missiles>0?'missile':'hedgehog',vulcan=kind==='hedgehog'&&actor.vulcan>0;
  return {kind,vulcan,owner:actor.id,target:targetAhead(r,actor)?.id??null,wx:actor.wx+Math.sin(actor.heading)*3.5,wz:actor.wz+Math.cos(actor.heading)*3.5,heading:actor.heading,speed:kind==='missile'?70:vulcan?125:90,height:1.3,vy:3,life:kind==='missile'?3:vulcan?1.3:2.5,age:0,trail:[],bounces:0};
}
export function targetAhead(world,actor=world,cone=.65){
  return [world,...world.bots].filter(other=>other.id!==actor.id&&!other.bomber&&!other.inactive&&!other.destroyed&&other.shield<=0&&distance(other,actor)<100&&Math.abs(angleDelta(Math.atan2(other.wx-actor.wx,other.wz-actor.wz),actor.heading))<cone&&clearShot(arenas[world.arena],actor,other)).sort((a,b)=>distance(actor,a)-distance(actor,b))[0]??null;
}
export function commandKeys(command){const keys=new Set(command.keys);if(Number.isFinite(command.steer))keys.steer=command.steer;return keys;}
export function useBattleTurbo(r,actor=r,actionId){
  if(!canAct(r,actor)||actor.turbos<=0||actor.boost>0)return false;
  actor.turbos--;actor.boost=boostDuration(actor.driver);fx(r,'boost',actor,actionId==null?undefined:`action:${actionId}`);return true;
}
export function somersaultBattle(world,actor=world){
  if(!canAct(world,actor)||(actor.somersaultCooldown??0)>1e-8)return false;
  actor.somersaultCameraStart=actor.cameraHeading;
  actor.heading+=Math.PI;actor.motionHeading=actor.heading;
  actor.drift=0;actor.wasDrifting=false;actor.driftTrail=null;
  actor.somersault=SOMERSAULT_DURATION;actor.somersaultCooldown=1;return true;
}
export function somersaultPose(actor){
  if(!(actor.somersault>0))return null;
  const progress=clamp(1-actor.somersault/SOMERSAULT_DURATION,0,1);
  if(actor.driver===10){
    const turn=progress*progress*(3-2*progress);
    return {height:Math.sin(progress*Math.PI)*2.8,pitch:-Math.sin(progress*Math.PI*2)*.45,roll:turn*Math.PI*2,yaw:-(1-turn)*Math.PI};
  }
  return {height:Math.sin(progress*Math.PI)*5,pitch:-progress*Math.PI*2};
}
export function fireBattle(r,actor=r,actionId){
  if(!canAct(r,actor)||actor.fireCooldown>0)return;
  const cueKey=actionId==null?undefined:`action:${actionId}`;
  const kind=actor.item==='missile'&&actor.missiles>0?'missile':'hedgehog';
  const vulcan=kind==='hedgehog'&&actor.vulcan>0;
  if(kind==='hedgehog'&&!vulcan&&actor.ammo<=0)return;
  r.projectileSequence=(r.projectileSequence??0)+1;
  const shot={...makeProjectile(r,actor),id:r.projectileSequence,...(actionId==null?{}:{actionId})};r.projectiles.push(shot);
  if(kind==='missile')actor.missiles--;if(kind==='hedgehog'&&!vulcan)actor.ammo--;
  actor.fireCooldown=kind==='missile'?.9:vulcan?.075:.225;
  if(actor.item==='missile'&&!actor.missiles)actor.item='hedgehog';
  if(r.multiplayer||distance(actor,r)<90)sound(r,kind==='missile'?'missile':vulcan?'vulcanFire':'fire',actor,cueKey);
  return shot;
}
export function applySupply(actor,kind){
  switch(kind){
    case 'health':actor.health=Math.min(MAX_HEALTH,actor.health+1);actor.notice=`+1 HEART · ${actor.health} / ${MAX_HEALTH}`;actor.noticeTime=2;break;
    case 'missile':actor.missiles=Math.min(itemCapacity(actor.driver,'missile'),actor.missiles+1);if(!(actor.vulcan>0&&actor.item==='hedgehog'))actor.item='missile';break;
    case 'hedgehog':actor.ammo=itemCapacity(actor.driver,'hedgehog');break;
    case 'hedgeproof':actor.hedgeShield=HEDGEGUARD_DURATION;break;
    case 'tehilim':actor.tehilim=25;break;
    case 'boost':actor.turbos=Math.min(itemCapacity(actor.driver,'boost'),actor.turbos+1);break;
  }
}
function collectSupplies(r,actor){
  if(actor.bomber||actor.destroyed)return;
  for(const supply of r.supplies){
    if(supply.cooldown>0||distance(actor,supply)>=4||supply.kind==='health'&&actor.health>=MAX_HEALTH)continue;
    applySupply(actor,supply.kind);supply.cooldown=['hedgeproof','tehilim'].includes(supply.kind)?45:8;supply.version=(supply.version??0)+1;supply.collector=actor.id;
    if(r.multiplayer||actor===r)fx(r,'pickup',actor,`pickup:${supply.id}:${supply.version}`);
  }
}
// Shared visual trajectory; damage remains exclusively in tickBattle.
function orbitChaff(shot,decoy,dt,arena){
  shot.orbitAge+=dt;
  const direction=shot.orbitDirection<0?-1:1,circling=Math.min(1,shot.orbitAge/.6),fall=Math.max(0,shot.orbitAge-.6),angle=shot.orbitAngle+direction*Math.PI*2*circling;
  const center=shot.orbitCenter??decoy,radius=shot.orbitRadius,speed=radius*Math.PI*2/.6;
  shot.heading=angle+direction*Math.PI/2;
  shot.wx=center.wx+Math.sin(angle)*radius+Math.sin(shot.heading)*speed*fall;shot.wz=center.wz+Math.cos(angle)*radius+Math.cos(shot.heading)*speed*fall;
  const sink=Math.min(.75,Math.max(0,(shot.orbitHeight-.25)/1.2));
  shot.height=shot.orbitHeight-sink*shot.orbitAge-7*fall*fall;shot.vy=-sink-14*fall;
  const impact=shot.height<=.15||fall>0&&blocked(arena,shot.wx,shot.wz,.3);
  if(impact){shot.height=Math.max(.15,shot.height);shot.life=0;}
  return {impact,decoy};
}
export function advanceProjectile(r,shot,dt){
  const actors=[r,...r.bots],arena=arenas[r.arena];
  shot.age=(shot.age??0)+dt;shot.life-=dt;shot.trail.push({wx:shot.wx,wz:shot.wz,height:shot.height});if(shot.trail.length>24)shot.trail.shift();
  if(shot.kind==='missile'&&!shot.reflected&&shot.decoy==null){
    const defender=actors.find(a=>a.id===shot.target&&!a.destroyed&&!a.inactive&&!a.afk&&(a.tehilim>0||r.specialAbilities!==false&&a.driver===11)),shooter=actors.find(a=>a.id===shot.owner&&!a.destroyed&&!a.inactive&&!a.afk&&!a.bomber);
    if(defender&&shooter&&distance(shot,defender)<=distance(shot,shooter)){
      shot.owner=defender.id;shot.target=shooter.id;shot.reflected=true;delete shot.actionId;shot.speed=100;shot.life=Math.max(shot.life,6);
    }
  }
  const decoy=r.chaffClouds?.find(c=>c.id===shot.decoy)??(shot.decoyCenter?{...shot.decoyCenter,owner:shot.decoyOwner}:null),target=decoy??actors.find(k=>k.id===shot.target&&!k.destroyed);
  if(decoy&&shot.orbitAge!==undefined)return orbitChaff(shot,decoy,dt,arena);
  let steering=0;
  if(shot.kind==='missile'&&target){const turnRate=decoy?4.5:shot.reflected?10:1.6,lead=shot.reflected&&!decoy?Math.min(.8,distance(shot,target)/shot.speed):0,heading=target.motionHeading??target.heading??0,speed=(target.speed??0)*.085;steering=clamp(angleDelta(Math.atan2(target.wx+Math.sin(heading)*speed*lead-shot.wx,target.wz+Math.cos(heading)*speed*lead-shot.wz),shot.heading),-turnRate*dt,turnRate*dt);shot.heading+=steering;}
  let impact=false,victim;const steps=Math.ceil(shot.speed*dt/1.5);
  for(let step=0;step<steps&&!impact;step++){
    shot.wx+=Math.sin(shot.heading)*shot.speed*dt/steps;shot.wz+=Math.cos(shot.heading)*shot.speed*dt/steps;
    if(decoy&&distance(shot,decoy)<6){
      shot.orbitAge=0;shot.orbitDirection=steering<0?-1:1;shot.orbitAngle=shot.heading-shot.orbitDirection*Math.PI/2;shot.orbitRadius=shot.speed*.6/(Math.PI*2);shot.orbitHeight=shot.height;
      shot.orbitCenter={wx:shot.wx-Math.sin(shot.orbitAngle)*shot.orbitRadius,wz:shot.wz-Math.cos(shot.orbitAngle)*shot.orbitRadius};shot.chaffed=true;shot.life=Math.max(shot.life,3);
      return orbitChaff(shot,decoy,dt*(steps-step-1)/steps,arena);
    }
    impact=blocked(arena,shot.wx,shot.wz,.3);
    victim=decoy?undefined:actors.find(k=>k.id!==shot.owner&&!k.bomber&&!k.destroyed&&k.shield<=0&&distance(k,shot)<2.7);
    if(victim)impact=true;
  }
  if(impact)shot.life=0;
  return {impact,victim,decoy};
}
export function damageBattle(r,victim,owner,amount,kind='hedgehog'){
  if(victim.bomber||victim.inactive||!battleActive(r)||victim.destroyed>0||victim.shield>0&&kind!=='wall'||victim.hedgeShield>0&&kind!=='missile'&&kind!=='wall'||victim.id===owner)return false;
  victim.health=Math.max(0,victim.health-amount);victim.healTimer=0;voice(r,victim,'hurt');
  if(victim===r)r.shake=.5;
  const attacker=[r,...r.bots].find(k=>k.id===owner);
  if(victim.health>0){fx(r,'hit',victim);if(attacker){attacker.celebrate=1.6;voice(r,attacker,'cheer');}return true;}
  const credited=new Set(attacker?[attacker]:[]);
  if(victim.dizzy>0)for(const [id,expires] of victim.stinkContributors??[]){
    if(expires<=r.elapsed+1e-8)continue;
    const bomber=[r,...r.bots].find(actor=>actor.id===id&&actor.bomber&&!actor.inactive);
    if(bomber&&bomber!==victim)credited.add(bomber);
  }
  victim.stinkContributors=new Map();
  victim.destroyed=3;victim.speed=0;victim.boost=0;if(r.finishCountdown===null)victim.deaths++;fx(r,kind==='abomb'||kind==='radiation'?'ash':'explosion',victim);
  victim.drift=0;victim.wasDrifting=false;victim.driftTrail=null;victim.killStreak=0;victim.vulcan=0;victim.hedgeShield=0;victim.tehilim=0;victim.somersault=0;victim.dizzy=0;
  if(r.finishCountdown!==null)return true;
  for(const scorer of credited){const full=kind==='wall'||scorer===attacker;scorer.kills+=full?1:.5;scorer.celebrate=1.6;voice(r,scorer,'cheer');r.killFeed.unshift({id:r.killSequence=(r.killSequence??0)+1,attacker:scorer.id,assist:!full,radiation:kind==='radiation'&&scorer===attacker,victim:victim.id,victimName:victim.name??drivers[victim.driver].name,victimColor:victim.color??drivers[victim.driver].color,text:`${scorer===r?'YOU':scorer.name??drivers[scorer.driver].name.split(' ')[0]} → ${victim===r?'YOU':victim.name??drivers[victim.driver].name.split(' ')[0]}`,time:r.elapsed});r.killFeed=r.killFeed.slice(0,16);}
  if(attacker&&!attacker.bomber&&!attacker.destroyed){
    attacker.killStreak++;
    if(attacker.killStreak%2===0){attacker.vulcan=VULCAN_DURATION;attacker.health=Math.max(attacker.health,4);attacker.item='hedgehog';attacker.fireCooldown=0;fx(r,'vulcanReady',attacker);attacker.notice='2-KILL STREAK · HEDGEHOG VULCAN!';attacker.noticeTime=3;}
  }
  return true;
}
function navigate(arena,actor,target){
  const size=18,cell=10,toCell=value=>clamp(Math.floor((value+90)/cell),0,size-1),start=toCell(actor.wx)+toCell(actor.wz)*size,goal=toCell(target.wx)+toCell(target.wz)*size;
  const queue=[start],prev=new Map([[start,-1]]);
  for(let i=0;i<queue.length&&!prev.has(goal);i++){
    const n=queue[i],x=n%size,z=Math.floor(n/size);
    for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,next=nx+nz*size;if(nx<0||nx>=size||nz<0||nz>=size||prev.has(next)||blocked(arena,nx*cell-85,nz*cell-85,3))continue;prev.set(next,n);queue.push(next);}
  }
  if(!prev.has(goal))return [];
  const path=[];for(let n=goal;n!==start&&n!==-1;n=prev.get(n))path.unshift({wx:(n%size)*cell-85,wz:Math.floor(n/size)*cell-85});return path;
}
export function driftWheels(actor){
  const tx=Math.sin(actor.heading),tz=Math.cos(actor.heading);
  return [-1,1].map(side=>({wx:actor.wx-tx*1.5+tz*side*1.6,wz:actor.wz-tz*1.5-tx*side*1.6}));
}
export function emitDriftTrail(r,actor,dt){
  actor.driftEmit+=dt;if(actor.driftEmit<.035)return;actor.driftEmit=0;
  const tx=Math.sin(actor.heading),tz=Math.cos(actor.heading),level=actor.drift>=.85?2:actor.drift>=.45?1:0;
  const wheels=driftWheels(actor);
  for(const [index,wheel] of wheels.entries()){
    const previous=actor.driftTrail?.[index];if(previous&&distance(previous,wheel)<6)r.skids.push({owner:actor.id,ax:previous.wx,az:previous.wz,bx:wheel.wx,bz:wheel.wz,time:r.elapsed});
    r.driftParticles.push({...wheel,owner:actor.id,height:.35,vx:-tx*2,vz:-tz*2,vy:1.8,age:0,life:.9,kind:'smoke',level});
    for(let i=0;i<3;i++){const a=r.elapsed*31+i*2.4+index*3;r.driftParticles.push({...wheel,owner:actor.id,height:.2,vx:Math.cos(a)*(3+i*2)-tx*5,vz:Math.sin(a)*(3+i*2)-tz*5,vy:2+i,age:0,life:.3+i*.07,kind:'spark',level});}
  }
  actor.driftTrail=wheels;
}
export function ageDriftEffects(r,dt){
  r.skids=r.skids.filter(s=>r.elapsed-s.time<6).slice(-420);
  for(const particle of r.driftParticles){particle.age+=dt;particle.wx+=particle.vx*dt;particle.wz+=particle.vz*dt;particle.height=Math.max(.08,particle.height+particle.vy*dt);if(particle.kind==='spark')particle.vy-=12*dt;}
  r.driftParticles=r.driftParticles.filter(p=>p.age<p.life).slice(-240);
}
function moveActor(r,actor,steer,gas,brake,dt,handbrake=false){
  if(actor.dizzy>0){const wild=actor.boost>0;steer=clamp(steer*(wild?.25:.4)+Math.sin((DIZZY_DURATION-actor.dizzy)*(wild?14:10))*(wild?1.65:.95),-1,1);}
  // Chassis rotation and travel direction separate while the rear tires slide.
  const drifting=handbrake&&!(actor.somersault>0)&&!brake&&Math.abs(steer)>.1&&actor.speed>(actor.wasDrifting?70:110);
  const before=actor.drift;
  if(drifting){actor.drift=Math.min(1.2,actor.drift+dt);if(before<.45&&actor.drift>=.45)sound(r,'driftCharge',actor);if(before<.85&&actor.drift>=.85)sound(r,'driftChargeMax',actor);}
  if(!drifting&&actor.wasDrifting){
    if(!handbrake&&!brake&&actor.speed>90&&actor.drift>=.45){actor.boost=Math.max(actor.boost,actor.drift>=.85?1.35:.8);actor.motionHeading=actor.heading;fx(r,'boost',actor);}
    actor.drift=0;actor.driftTrail=null;
  }
  actor.wasDrifting=drifting;
  actor.heading-=steer*(drifting?4.8:1.7+Math.min(1,Math.abs(actor.speed)/300)*.7)*dt;
  actor.speed=clamp(actor.speed+(gas?(drifting?100:300):drifting?-90:-170)*dt-(brake?400*dt:0),brake?-160:0,drifting?400:actor.boost>0?850:520);
  if(actor.boost>0&&!drifting)actor.speed=Math.min(850,actor.speed+650*dt);
  actor.motionHeading+=angleDelta(actor.heading,actor.motionHeading)*(1-Math.exp(-(drifting?3.8:14)*dt));
  if(actor.somersault>0){
    const progress=clamp(1-actor.somersault/SOMERSAULT_DURATION,0,1),turn=progress*progress*(3-2*progress);
    actor.cameraHeading=actor.somersaultCameraStart+Math.PI*turn;
  }
  if(!(actor.somersault>0))actor.cameraHeading+=angleDelta(actor.heading,actor.cameraHeading)*(1-Math.exp(-(drifting?5:9)*dt));
  const travel=drifting||actor===r||actor.human?actor.motionHeading:actor.heading;
  const nx=actor.wx+Math.sin(travel)*actor.speed*.085*dt,nz=actor.wz+Math.cos(travel)*actor.speed*.085*dt;
  const arena=arenas[r.arena];
  if(!blocked(arena,nx,nz)){actor.wx=nx;actor.wz=nz;if(drifting)emitDriftTrail(r,actor,dt);return;}
  if(!blocked(arena,nx,actor.wz))actor.wx=nx;
  if(!blocked(arena,actor.wx,nz))actor.wz=nz;
  if(actor.boost>0&&drifting){
    if(!r.prediction){damageBattle(r,actor,-1,MAX_HEALTH,'wall');return;}
    actor.predictedCrash=true;actor.speed=0;actor.boost=0;actor.drift=0;actor.wasDrifting=false;actor.somersault=0;actor.dizzy=0;return;
  }
  actor.speed*=.3;actor.drift=0;actor.wasDrifting=false;actor.driftTrail=null;actor.motionHeading=actor.heading;if(actor===r&&actor.wallCooldown<=0){fx(r,'crash',actor);actor.wallCooldown=.7;r.shake=.3;voice(r,actor,'hurt');}
}
export function predictKartMovement(world,actor,keys,dt){
  if(frozen(world,actor.id))return;
  if(actor.bomber||!battleActive(world)||actor.destroyed>0)return;
  // Reuse movement and wall collisions, without running weapons, damage or AI.
  const scene={prediction:true,mode:'combat',phase:world.phase,arena:world.arena,elapsed:world.elapsed,finishCountdown:null,events:[],effects:[],skids:[],driftParticles:[]};
  advanceKartMovement(scene,actor,keys,dt);return scene.events;
}
function advanceKartMovement(world,actor,keys,dt){
  if(actor.destroyed>0||actor.predictedCrash)return;
  actor.dizzy=Math.max(0,(actor.dizzy??0)-dt);
  actor.somersault=Math.max(0,(actor.somersault??0)-dt);actor.somersaultCooldown=Math.max(0,(actor.somersaultCooldown??0)-dt);
  actor.boost=Math.max(0,(actor.boost??0)-dt);actor.human=true;
  const steer=keys.steer??(Number(keys.has('arrowright')||keys.has('d'))-Number(keys.has('arrowleft')||keys.has('a')));
  moveActor(world,actor,steer,keys.has('arrowup')||keys.has('w'),keys.has('arrowdown')||keys.has('s'),dt,keys.has('shift'));
  actor.yaw=steer*.12;
}
export function tickBattle(r,keys,dt,inputs=null){
  dt=clamp(dt,0,.05);if(!['racing','countdown'].includes(r.phase))return;
  if(r.phase==='countdown'){r.countdown-=dt;if(r.countdown<=0){r.phase='racing';r.notice='BATTLE ON! · FIRST TO 10 KILLS';r.noticeTime=3;}return;}
  tickSpecials(r,dt);const worldDt=r.timeStop>0?0:dt;
  const ending=r.finishCountdown!==null;if(ending)dt=Math.min(dt,r.finishCountdown);
  r.elapsed+=dt;r.noticeTime=Math.max(0,r.noticeTime-dt);r.shake=Math.max(0,r.shake-dt*2);
  for(const supply of r.supplies)supply.cooldown=Math.max(0,supply.cooldown-worldDt);
  for(const effect of r.effects)effect.age+=worldDt;r.effects=r.effects.filter(f=>f.age<f.life);
  for(const cloud of r.chaffClouds)cloud.age+=worldDt;
  r.chaffClouds=r.chaffClouds.filter(c=>c.age<c.life);
  for(const cloud of r.stinkClouds)cloud.age+=worldDt;
  r.stinkClouds=r.stinkClouds.filter(cloud=>cloud.age<cloud.life);
  ageDriftEffects(r,worldDt);
  const actors=[r,...r.bots],arena=arenas[r.arena];
  for(const actor of actors){
    if(frozen(r,actor.id))continue;
    const recoveryHealth=r.specialAbilities!==false&&actor.driver===12?6:RECOVERY_HEALTH;
    if(actor!==r)actor.noticeTime=Math.max(0,(actor.noticeTime??0)-dt);
    for(const key of ['fireCooldown','shield','hedgeShield','tehilim','celebrate','voiceCooldown','wallCooldown','vulcan','chaffCooldown']){if(inputs?.get(actor.id)?.actionClock&&['fireCooldown','chaffCooldown'].includes(key))continue;actor[key]=Math.max(0,(actor[key]??0)-dt);}
    if(actor.bomber){
      if(!actor.inactive&&!ending){
        const before=actor.bombReload;actor.bombReload+=dt;
        if(before<5-1e-8&&actor.bombReload>=5-1e-8){actor.stinkAmmo=Math.min(itemCapacity(actor.driver,'stink'),actor.stinkAmmo+1);actor.bombReload=Math.max(5,actor.bombReload);}
        if(actor.bombReload>=BOMB_RECHARGE-1e-8){actor.bombAmmo=Math.min(itemCapacity(actor.driver,'abomb'),actor.bombAmmo+1);actor.stinkAmmo=Math.min(itemCapacity(actor.driver,'stink'),actor.stinkAmmo+1);actor.bombReload=Math.max(0,actor.bombReload-BOMB_RECHARGE);}
      }
      continue;
    }
    if(actor.destroyed>0){actor.destroyed=Math.max(0,actor.destroyed-dt);if(actor.destroyed===0&&!ending)spawn(r,actor);continue;}
    if(!ending&&!actor.inactive&&!actor.afk&&actor.health>0&&actor.health<recoveryHealth){
      actor.healTimer=(actor.healTimer??0)+dt;const interval=recoveryInterval(actor.driver);
      if(actor.healTimer>=interval-1e-8){actor.health=Math.min(recoveryHealth,actor.health+1);actor.healTimer=actor.health>=recoveryHealth?0:Math.max(0,actor.healTimer-interval);}
    }
    if(actor.health>=recoveryHealth)actor.healTimer=0;
    actor.reload+=dt;const reloadInterval=hedgehogRecoveryInterval(actor.driver);if(actor.reload>=reloadInterval-1e-8){actor.ammo=Math.min(itemCapacity(actor.driver,'hedgehog'),actor.ammo+1);actor.reload=Math.max(0,actor.reload-reloadInterval);}
    if((actor===r&&!r.multiplayer)||actor.human){
      const control=inputs?.get(actor.id)??(actor===r?keys:new Set());
      const held=control.keys instanceof Set?control.keys:control;
      if(Array.isArray(control.moves))for(const command of control.moves){
        if(control.actionClock)for(const key of ['fireCooldown','chaffCooldown']){const remaining=(actor[key]??0)-MOVEMENT_DT;actor[key]=remaining<1e-8?0:remaining;}
        advanceKartMovement(r,actor,commandKeys(command),MOVEMENT_DT);collectSupplies(r,actor);control.afterMove?.(command.sequence);
      }
      if(!Array.isArray(control.moves))advanceKartMovement(r,actor,held,dt);
      if(held.has(' '))fireBattle(r,actor);continue;
    }
    if(ending){actor.speed=0;actor.boost=0;continue;}
    actor.dizzy=Math.max(0,(actor.dizzy??0)-dt);actor.somersault=Math.max(0,(actor.somersault??0)-dt);actor.somersaultCooldown=Math.max(0,(actor.somersaultCooldown??0)-dt);
    actor.boost=Math.max(0,actor.boost-dt);
    const target=actors.filter(k=>k!==actor&&!k.bomber&&!k.inactive&&!k.destroyed).sort((a,b)=>distance(actor,a)-distance(actor,b))[0];if(!target)continue;
    actor.brain-=dt;const visible=clearShot(arena,actor,target);
    if(visible&&distance(actor,target)<50)useSpecial(r,actor);
    if(actor.brain<=0){actor.path=visible?[]:navigate(arena,actor,target);actor.brain=.4+(1-actor.skill)*.4;}
    while(actor.path.length&&distance(actor,actor.path[0])<7)actor.path.shift();
    const waypoint=visible?target:actor.path[0]??target,desired=Math.atan2(waypoint.wx-actor.wx,waypoint.wz-actor.wz),turn=angleDelta(desired,actor.heading);
    const ahead={wx:actor.wx+Math.sin(actor.heading)*9,wz:actor.wz+Math.cos(actor.heading)*9};
    let steer=-clamp(turn*1.8,-1,1);if(blocked(arena,ahead.wx,ahead.wz,3)&&Math.abs(steer)<.4)steer=1;
    moveActor(r,actor,steer,Math.abs(turn)<1.3||actor.speed<100,false,dt);
    const aim=angleDelta(Math.atan2(target.wx-actor.wx,target.wz-actor.wz),actor.heading);
    if(visible&&Math.abs(aim)<.18+(1-actor.skill)*.12&&distance(actor,target)<85){actor.item=actor.vulcan>0?'hedgehog':actor.missiles>0?'missile':'hedgehog';fireBattle(r,actor);}
  }
  for(let i=0;i<actors.length;i++)for(let j=i+1;j<actors.length;j++){
    const a=actors[i],b=actors[j],d=distance(a,b);if(frozen(r,a.id)||frozen(r,b.id)||a.bomber||b.bomber||a.destroyed||b.destroyed||d>=3.8)continue;
    const dx=(a.wx-b.wx)/(d||1),dz=d===0?1:(a.wz-b.wz)/d,push=(3.8-d)/2;
    if(!blocked(arena,a.wx+dx*push,a.wz+dz*push)){a.wx+=dx*push;a.wz+=dz*push;}
    if(!blocked(arena,b.wx-dx*push,b.wz-dz*push)){b.wx-=dx*push;b.wz-=dz*push;}
    a.speed*=.8;b.speed*=.8;if((a===r||b===r)&&r.wallCooldown<=0){fx(r,'crash',r);r.wallCooldown=.6;voice(r,r,'hurt');}
  }
  for(const actor of actors)if(!frozen(r,actor.id))collectSupplies(r,actor);
  for(const cloud of r.chaffClouds)divertMissiles(r,cloud);
  for(const shot of r.projectiles){
    if(frozen(r,shot.owner))continue;
    const {impact,victim,decoy}=advanceProjectile(r,shot,dt);
    if(victim&&shot.kind==='hedgehog')damageBattle(r,victim,shot.owner,1);
    if(!impact&&shot.life>0)continue;
    shot.life=0;
    if(shot.kind==='missile'){
      fx(r,'explosion',shot);
      if(shot.chaffed){const defender=actors.find(actor=>actor.id===decoy.owner);if(defender){defender.notice='CHAFF INTERCEPT · MISSILE DESTROYED';defender.noticeTime=2;}if(decoy.owner===r.id)r.shake=Math.max(r.shake,.12);continue;}
      for(const victim of actors)if(distance(victim,shot)<10&&clearShot(arena,shot,victim))damageBattle(r,victim,shot.owner,3,'missile');
    }
  }
  r.projectiles=r.projectiles.filter(p=>p.life>0);
  for(const bomb of r.bombs){
    if(frozen(r,bomb.owner))continue;
    bomb.age+=dt;if(bomb.age<BOMB_FALL_TIME-1e-8)continue;
    if(bomb.kind==='stink'){
      r.stinkClouds.push({id:bomb.id,owner:bomb.owner,wx:bomb.wx,wz:bomb.wz,age:0,life:5,hits:[]});sound(r,'stinkBurst',bomb);continue;
    }
    sound(r,'bombExplosion',bomb);r.effects.push({type:'abomb',wx:bomb.wx,wz:bomb.wz,age:0,life:3,color:bomb.color});
    r.effects.push({type:'radiation',owner:bomb.owner,wx:bomb.wx,wz:bomb.wz,age:0,life:RADIATION_DURATION,doses:{}});
    for(const victim of actors){const radius=distance(victim,bomb);if(radius<=BOMB_OUTER_RADIUS)damageBattle(r,victim,bomb.owner,radius<=BOMB_RADIUS?5:3,'abomb');}
    if(!r.bomber&&distance(r,bomb)<BOMB_RADIUS*2)r.shake=Math.max(r.shake,.7);
  }
  r.bombs=r.bombs.filter(bomb=>bomb.age<BOMB_FALL_TIME-1e-8);
  for(const cloud of r.stinkClouds)for(const actor of actors){
    if(frozen(r,actor.id)||actor.bomber||actor.inactive||actor.destroyed||actor.shield>0||actor.hedgeShield>0||cloud.hits.includes(actor.id)||distance(actor,cloud)>STINK_RADIUS)continue;
    cloud.hits.push(actor.id);if(!(actor.dizzy>0))sound(r,'dizzy',actor);actor.dizzy=DIZZY_DURATION;
    actor.stinkContributors??=new Map();
    for(const [id,expires] of actor.stinkContributors)if(expires<=r.elapsed+1e-8)actor.stinkContributors.delete(id);
    if(!ending)actor.stinkContributors.set(cloud.owner,r.elapsed+DIZZY_DURATION);
  }
  for(const zone of r.effects.filter(f=>f.type==='radiation'&&f.age<f.life-1e-8))for(const actor of actors){
    if(frozen(r,actor.id))continue;
    zone.doses??={};
    if(actor.bomber||actor.inactive||actor.afk||actor.destroyed||actor.shield>0||actor.hedgeShield>0||distance(actor,zone)>BOMB_OUTER_RADIUS){delete zone.doses[actor.id];continue;}
    if(zone.age+1e-8<(zone.doses[actor.id]??0))continue;
    zone.doses[actor.id]=zone.age+RADIATION_INTERVAL;damageBattle(r,actor,zone.owner,1,'radiation');
  }
  const order=standings(r);r.rank=order.findIndex(k=>k.id===0)+1;
  if(!ending&&(order[0].kills>=r.targetScore||r.elapsed>=r.duration)){
    r.winner=order[0].id===0?'player':order[0].id-1;r.finishRank=r.rank;r.finishTime=Math.min(r.elapsed,r.duration);r.finishCountdown=3;r.events.push(r.rank===1?'victory':'finish');voice(r,order[0],'win');
  }
  if(!ending)return;
  r.finishCountdown=Math.max(0,r.finishCountdown-dt);if(r.finishCountdown>1e-8)return;
  r.phase='finished';r.finishCountdown=0;for(const actor of actors){actor.speed=0;actor.boost=0;actor.celebrate=0;actor.wasDrifting=false;actor.drift=0;actor.somersault=0;}
}
