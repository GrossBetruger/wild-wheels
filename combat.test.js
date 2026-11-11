import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle,fireBattle,releaseChaff,damageBattle,arenas,blocked} from './combat.js';
import {createRace,tick,LENGTH,useItem,selectItem,cycleItem} from './engine.js';
import {sampleTrack,branches,chooseRoute} from './track.js';

test('keeping left at the woodland fork chooses the detour and merges back',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.s=.12*LENGTH-5;r.x=-.7;r.speed=400;
  tick(r,new Set(['arrowup']),.05);assert.equal(r.route,1);
  const main=sampleTrack(.175),detour=sampleTrack(.175,0,1);assert.ok(Math.hypot(main.x-detour.x,main.z-detour.z)>60);
  const before=.23*LENGTH-5;r.s=.23*LENGTH+5;chooseRoute(r,before,LENGTH);assert.equal(r.route,0);
});
test('staying central at a fork keeps the main road',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.s=.12*LENGTH-5;r.x=0;r.speed=400;
  tick(r,new Set(['arrowup']),.05);assert.equal(r.route??0,0);
});
test('both alternate routes connect continuously to the main circuit',()=>{
  for(const [i,branch] of branches.entries())for(const progress of [branch.start,branch.end]){const main=sampleTrack(progress),fork=sampleTrack(progress,0,i+1);assert.ok(Math.hypot(main.x-fork.x,main.z-fork.z)<.01);}
});
test('driving either detour never abruptly reverses the road or camera heading',()=>{
  for(const [route,start,end] of [[1,.12,.23],[2,.58,.71]]){
    let previous=sampleTrack(start,0,route);
    for(let step=1;step<=1000;step++){
      const current=sampleTrack(start+(end-start)*step/1000,0,route);
      assert.ok(current.tx*previous.tx+current.tz*previous.tz>.98);
      assert.ok(Math.hypot(current.x-previous.x,current.z-previous.z)<1);
      previous=current;
    }
  }
});
test('a projectile on the detour cannot hit a kart at the same progress on the main road',()=>{
  const r=createRace(0,0,()=>.5);r.phase='racing';r.s=.17*LENGTH;r.route=1;r.bots[0].s=r.s+160;r.bots[0].x=0;r.bots[0].route=0;
  useItem(r);tick(r,new Set(),.05);assert.equal(r.bots[0].stun,0);
});
test('arena kills award one point to the attacker and one death to the victim',()=>{
  const r=createBattle(0,0,()=>.5);r.phase='racing';const victim=r.bots[0];victim.shield=0;
  damageBattle(r,victim,0,3);damageBattle(r,victim,0,3);
  assert.equal(r.kills,1);assert.equal(victim.deaths,1);assert.equal(victim.destroyed,3);
});
test('rivals can kill each other and kill credit goes to the firing rival',()=>{
  const r=createBattle(0,0,()=>.5);r.phase='racing';const attacker=r.bots[0],victim=r.bots[1];victim.shield=0;
  damageBattle(r,victim,attacker.id,3);assert.equal(attacker.kills,1);assert.equal(r.kills,0);assert.equal(victim.deaths,1);
});
test('spawn protection prevents damage and self-hits never award kills',()=>{
  const r=createBattle(0,0,()=>.5);r.phase='racing';
  damageBattle(r,r,1,3);assert.equal(r.health,3);r.shield=0;
  damageBattle(r,r,0,3);assert.equal(r.health,3);assert.equal(r.kills,0);
});
test('a killed player respawns with health, weapons, and temporary protection',()=>{
  const r=createBattle(0,0,()=>.5);r.phase='racing';r.shield=0;r.bots=[];
  damageBattle(r,r,99,3);for(let i=0;i<61;i++)tickBattle(r,new Set(),.05);
  assert.equal(r.destroyed,0);assert.equal(r.health,3);assert.equal(r.ammo,5);assert.equal(r.missiles,1);assert.ok(r.shield>1);assert.equal(blocked(arenas[0],r.wx,r.wz),false);
});
test('hedgehogs fired in an arena can hit an opponent and consume ammo',()=>{
  const r=createBattle(0,0,()=>.5);r.phase='racing';r.wx=-70;r.wz=-70;r.heading=0;r.fireCooldown=0;r.shield=0;
  const victim=r.bots[0];victim.wx=-70;victim.wz=-60;victim.shield=0;victim.health=1;victim.fireCooldown=10;
  fireBattle(r);for(let i=0;i<6;i++)tickBattle(r,new Set(),.05);
  assert.equal(r.ammo,4);assert.equal(victim.destroyed>0,true);assert.equal(r.kills,1);
});
test('cover blocks direct shots in both arena layouts',()=>{
  for(const arena of [0,1]){const r=createBattle(0,arena,()=>.5);r.phase='racing';r.wx=0;r.wz=-25;r.heading=0;r.fireCooldown=0;r.shield=0;r.bots=[];fireBattle(r);for(let i=0;i<10;i++)tickBattle(r,new Set(),.05);assert.equal(r.projectiles.length,0);}
});
test('the tenth kill ends combat after the result announcement',()=>{
  const r=createBattle(0,0,()=>.5);r.phase='racing';r.kills=9;r.bots[0].shield=0;
  damageBattle(r,r.bots[0],0,3);tickBattle(r,new Set(),.05);
  assert.equal(r.kills,10);assert.equal(r.finishRank,1);assert.equal(r.finishCountdown,3);
  for(let i=0;i<60;i++)tickBattle(r,new Set(),.05);
  assert.equal(r.phase,'finished');assert.equal(r.speed,0);
});
test('arena play continues at five and nine kills',()=>{
  const r=createBattle(0,0,()=>.5);r.phase='racing';r.bots=[];r.kills=5;
  tickBattle(r,new Set(),.05);assert.equal(r.phase,'racing');assert.equal(r.finishCountdown,null);
  r.kills=9;tickBattle(r,new Set(),.05);assert.equal(r.phase,'racing');assert.equal(r.finishCountdown,null);
});
test('the time limit ranks combatants by kills and then fewer deaths',()=>{
  const r=createBattle(0,1,()=>.5);r.phase='racing';r.elapsed=179.98;r.kills=2;r.deaths=2;r.bots[0].kills=2;r.bots[0].deaths=1;r.bots[1].kills=3;
  tickBattle(r,new Set(),.05);assert.equal(r.finishRank,3);assert.equal(r.finishTime,180);
});
test('both battle maps produce opponent-on-opponent kills during normal simulation',()=>{
  for(const arena of [0,1]){const r=createBattle(0,arena,()=>.5);r.phase='racing';for(let i=0;i<2400&&r.phase!=='finished';i++){tickBattle(r,new Set(),.05);r.events=[];r.voices=[];}assert.ok(r.bots.some(bot=>bot.kills>=10));assert.ok(r.bots.filter(bot=>bot.kills>0).length>=2);assert.equal(r.phase,'finished');}
});
test('arena drift makes a tight sliding U-turn in either direction within two thirds of a second',()=>{
  for(const [key,sign] of [['arrowleft',1],['arrowright',-1]]){
    const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:400,bots:[],supplies:[]});
    for(let frame=0;frame<40;frame++)tickBattle(r,new Set(['arrowup','shift',key]),1/60);
    assert.ok(r.heading*sign>3.05&&r.heading*sign<3.3,'The kart faces back toward its pursuer');
    assert.ok(Math.hypot(r.wx+65,r.wz)<20,'The U-turn fits within a combat lane');
    assert.ok(Math.abs(r.heading-r.motionHeading)>.75,'The tires slide across the direction the kart faces');
    assert.equal(r.speed,400);assert.ok(r.skids.length>0);assert.ok(r.driftParticles.length>0);
  }
});
test('releasing a charged arena drift launches forward without spending an inventory turbo',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:400,bots:[],supplies:[],turbos:1});
  for(let frame=0;frame<40;frame++)tickBattle(r,new Set(['arrowup','shift','arrowleft']),1/60);
  const z=r.wz;tickBattle(r,new Set(['arrowup']),1/60);
  assert.equal(r.boost,.8);assert.equal(r.turbos,1);assert.ok(r.wz<z,'Releasing launches in the new facing direction');assert.ok(r.speed>400);
  for(let frame=0;frame<15;frame++)tickBattle(r,new Set(['arrowup']),1/60);
  assert.ok(r.speed>600);assert.equal(r.events.filter(event=>event==='boost').length,1);
});
test('a longer arena slide earns the stronger boost and two charge cues',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:400,bots:[],supplies:[]});
  for(let frame=0;frame<55;frame++)tickBattle(r,new Set(['arrowup','shift','arrowleft']),1/60);
  tickBattle(r,new Set(['arrowup']),1/60);
  assert.equal(r.boost,1.35);assert.equal(r.events.filter(event=>event==='driftCharge').length,1);assert.equal(r.events.filter(event=>event==='driftChargeMax').length,1);
});
test('weapons fire in the facing direction during a sideways arena drift',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:400,bots:[],supplies:[],fireCooldown:0,item:'hedgehog'});
  for(let frame=0;frame<40;frame++)tickBattle(r,new Set(['arrowup','shift','arrowleft']),1/60);
  fireBattle(r);const shot=r.projectiles[0];
  assert.ok(Math.cos(shot.heading)<-.99,'The shot aims behind the original direction of travel');assert.ok(shot.wz<r.wz);assert.equal(r.ammo,4);assert.equal(r.wasDrifting,true);
});
test('stationary turns, straight driving, and brief drift taps cannot earn a boost',()=>{
  for(const [speed,keys,frames] of [[0,['shift','arrowleft'],40],[400,['shift','arrowup'],20],[400,['shift','arrowleft','arrowup'],6]]){
    const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed,bots:[],supplies:[]});
    for(let frame=0;frame<frames;frame++)tickBattle(r,new Set(keys),1/60);
    tickBattle(r,new Set(),1/60);assert.equal(r.boost,0);assert.equal(r.turbos,1);
  }
});
test('arena cover stops a drifting kart and cancels its stored boost',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-91,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:400,bots:[],supplies:[]});
  for(let frame=0;frame<60&&!r.events.includes('crash');frame++)tickBattle(r,new Set(['arrowup','shift','arrowright']),1/60);
  assert.ok(r.events.includes('crash'));assert.equal(blocked(arenas[0],r.wx,r.wz),false);
  tickBattle(r,new Set(),1/60);assert.equal(r.boost,0);assert.equal(r.wasDrifting,false);
});
test('pausing freezes an arena drift and destruction cancels it',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:400,bots:[],supplies:[],shield:0});
  for(let frame=0;frame<40;frame++)tickBattle(r,new Set(['arrowup','shift','arrowleft']),1/60);
  r.phase='paused';const heading=r.heading,charge=r.drift;tickBattle(r,new Set(),.05);assert.equal(r.heading,heading);assert.equal(r.drift,charge);
  r.phase='racing';damageBattle(r,r,99,3);tickBattle(r,new Set(),.05);assert.equal(r.wasDrifting,false);assert.equal(r.drift,0);assert.equal(r.boost,0);
});
test('two kills without dying automatically equip a fifteen-second Hedgehog Vulcan',()=>{
  const r=createBattle(0,0,()=>.5);r.phase='racing';r.item='missile';r.bots[0].shield=0;r.bots[1].shield=0;
  damageBattle(r,r.bots[0],0,3);assert.equal(r.vulcan,0);
  damageBattle(r,r.bots[1],0,3);assert.equal(r.killStreak,2);assert.equal(r.vulcan,15);assert.equal(r.item,'hedgehog');assert.equal(r.kills,2);
  damageBattle(r,r.bots[1],0,3);assert.equal(r.killStreak,2);assert.equal(r.events.filter(e=>e==='vulcanReady').length,1);
});
test('Vulcan fires twelve free shots per second while carried hedgehogs regenerate',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',vulcan:15,ammo:2,fireCooldown:0,bots:[],supplies:[]});
  for(let frame=0;frame<60;frame++)tickBattle(r,new Set([' ']),1/60);
  assert.equal(r.events.filter(e=>e==='vulcanFire').length,12);assert.equal(r.ammo,3);assert.ok(r.vulcan>13.99&&r.vulcan<14.01);
});
test('Vulcan expires after fifteen seconds and ordinary shots spend ammo again',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',vulcan:15,ammo:5,bots:[],supplies:[]});
  for(let frame=0;frame<299;frame++)tickBattle(r,new Set(),.05);
  assert.ok(r.vulcan>0);tickBattle(r,new Set(),.05);tickBattle(r,new Set(),.05);assert.equal(r.vulcan,0);
  fireBattle(r);assert.equal(r.ammo,5);assert.equal(r.projectiles[0].vulcan,false);assert.equal(r.fireCooldown,.45);
});
test('dying breaks the kill streak and removes the Vulcan before respawning',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',killStreak:2,vulcan:6,shield:0});r.bots[0].shield=0;
  damageBattle(r,r,1,3);assert.equal(r.killStreak,0);assert.equal(r.vulcan,0);
  r.bots=[];for(let frame=0;frame<61;frame++)tickBattle(r,new Set(),.05);
  assert.equal(r.destroyed,0);assert.equal(r.killStreak,0);assert.equal(r.vulcan,0);
  const rival=createBattle().bots[0];rival.shield=0;r.bots=[rival];damageBattle(r,rival,0,3);assert.equal(r.killStreak,1);assert.equal(r.vulcan,0);
});
test('the fourth consecutive kill refreshes Vulcan to fifteen seconds without stacking time',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',killStreak:2,kills:2,vulcan:3});r.bots[0].shield=0;r.bots[1].shield=0;
  damageBattle(r,r.bots[0],0,3);assert.equal(r.vulcan,3);
  damageBattle(r,r.bots[1],0,3);assert.equal(r.killStreak,4);assert.equal(r.vulcan,15);
});
test('an empty reserve still allows selecting Vulcan and pausing freezes its timer',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',vulcan:15,ammo:0,item:'boost'});
  cycleItem(r);assert.equal(r.item,'hedgehog');selectItem(r,'missile');selectItem(r,'hedgehog');assert.equal(r.item,'hedgehog');
  r.phase='paused';tickBattle(r,new Set([' ']),.05);assert.equal(r.vulcan,15);assert.equal(r.projectiles.length,0);
});
test('opponents earn their own Vulcan from consecutive kills',()=>{
  const r=createBattle(0,0,()=>.5);r.phase='racing';const attacker=r.bots[0];r.bots[1].shield=0;r.bots[2].shield=0;
  damageBattle(r,r.bots[1],attacker.id,3);damageBattle(r,r.bots[2],attacker.id,3);
  assert.equal(attacker.vulcan,15);assert.equal(attacker.killStreak,2);assert.equal(r.vulcan,0);
});
test('earning Vulcan heals to four hearts and preserves health already above four',()=>{
  for(const [health,expected] of [[1,4],[2,4],[3,4],[4,4],[5,5],[6,6]]){
    const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',health,killStreak:1,kills:1});r.bots[0].shield=0;
    damageBattle(r,r.bots[0],0,3);assert.equal(r.health,expected);assert.equal(r.vulcan,15);
  }
});
test('refreshing Vulcan heals again but an intervening kill does not heal',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',health:2,killStreak:2,kills:2,vulcan:5});r.bots[0].shield=0;r.bots[1].shield=0;
  damageBattle(r,r.bots[0],0,3);assert.equal(r.health,2);
  damageBattle(r,r.bots[1],0,3);assert.equal(r.health,4);assert.equal(r.vulcan,15);
});
test('collecting health adds extra hearts one at a time up to six',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-70,wz:0,bots:[]});
  const health=r.supplies.find(s=>s.kind==='health');
  tickBattle(r,new Set(),.05);assert.equal(r.health,4);
  health.cooldown=0;tickBattle(r,new Set(),.05);assert.equal(r.health,5);
  health.cooldown=0;tickBattle(r,new Set(),.05);assert.equal(r.health,6);
  health.cooldown=0;tickBattle(r,new Set(),.05);assert.equal(r.health,6);assert.equal(health.cooldown,0);
});
test('a health pickup heals one heart when injured and opponents can collect extra hearts',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-70,wz:0,health:1});
  const rival=r.bots[0];rival.wx=70;rival.wz=0;rival.health=5;rival.speed=0;
  tickBattle(r,new Set(),.05);assert.equal(r.health,2);assert.equal(rival.health,6);
});
test('extra health absorbs missile damage and respawning returns to three hearts',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',health:6,shield:0,bots:[]});
  damageBattle(r,r,99,3);assert.equal(r.health,3);assert.equal(r.destroyed,0);
  damageBattle(r,r,99,3);assert.equal(r.health,0);assert.equal(r.destroyed,3);
  for(let frame=0;frame<61;frame++)tickBattle(r,new Set(),.05);
  assert.equal(r.health,3);assert.equal(r.destroyed,0);
});
test('chaff draws a locked missile away and prevents an otherwise lethal hit',()=>{
  for(const [deploy,expectedHealth] of [[false,0],[true,3]]){
    const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,shield:0,speed:0,supplies:[]});
    const shooter=r.bots[0];r.bots=[shooter];Object.assign(shooter,{wx:-65,wz:-35,heading:0,fireCooldown:0,item:'missile',missiles:1});
    fireBattle(r,shooter);assert.equal(r.projectiles[0].target,0);shooter.destroyed=100;
    if(deploy)assert.equal(releaseChaff(r),true);
    for(let frame=0;frame<40;frame++)tickBattle(r,new Set(),.05);
    assert.equal(r.health,expectedHealth);assert.equal(r.chaff,deploy?3:4);
  }
});
test('chaff spends one charge per deployment and cannot deploy after four uses',()=>{
  const r=createBattle(0,0,()=>.5);r.phase='racing';r.bots=[];
  assert.equal(r.chaff,4);assert.equal(releaseChaff(r),true);assert.equal(r.chaff,3);
  assert.equal(releaseChaff(r),false);assert.equal(r.chaff,3);
  for(const expected of [2,1,0]){for(let frame=0;frame<14;frame++)tickBattle(r,new Set(),.05);assert.equal(releaseChaff(r),true);assert.equal(r.chaff,expected);}
  for(let frame=0;frame<14;frame++)tickBattle(r,new Set(),.05);
  assert.equal(releaseChaff(r),false);assert.equal(r.chaff,0);
});
test('respawning restores four chaff charges after they have been spent',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',chaff:0,shield:0,bots:[]});
  damageBattle(r,r,99,3);for(let frame=0;frame<61;frame++)tickBattle(r,new Set(),.05);
  assert.equal(r.destroyed,0);assert.equal(r.chaff,4);assert.equal(r.chaffCooldown,0);
});
test('menus, pause, death, and the final leaderboard prevent chaff spending',()=>{
  for(const [phase,destroyed,finishCountdown] of [['ready',0,null],['countdown',0,null],['paused',0,null],['finished',0,0],['racing',2,null]]){
    const r=createBattle(0,0,()=>.5);Object.assign(r,{phase,destroyed,finishCountdown});
    assert.equal(releaseChaff(r),false);assert.equal(r.chaff,4);
  }
});
test('chaff affects only nearby missiles locked onto the deploying kart',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0});
  r.projectiles=[{kind:'missile',target:0,wx:-65,wz:-20},{kind:'missile',target:1,wx:-65,wz:-20},{kind:'missile',target:0,wx:65,wz:70},{kind:'hedgehog',target:0,wx:-65,wz:-20}];
  releaseChaff(r);assert.equal(r.projectiles[0].target,null);assert.equal(r.projectiles[1].target,1);assert.equal(r.projectiles[2].target,0);assert.equal(r.projectiles[3].target,0);
});
test('a chaff cloud keeps distracting incoming missiles and pauses with the match',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0,bots:[],supplies:[]});releaseChaff(r);
  r.projectiles=[{kind:'missile',owner:99,target:0,wx:-65,wz:-30,heading:0,speed:70,height:1.3,life:3,trail:[]}];
  tickBattle(r,new Set(),.05);assert.equal(r.projectiles[0].target,null);
  r.phase='paused';tickBattle(r,new Set(),.05);assert.equal(r.chaffClouds[0].age,.05);
  r.phase='racing';for(let frame=0;frame<160;frame++)tickBattle(r,new Set(),.05);
  assert.equal(r.chaffClouds.length,0);assert.equal(r.health,3);
});
test('chaff creates a visible decoy ahead and detonates missiles arriving from either direction',()=>{
  for(const [missileZ,heading,exitDirection] of [[-35,0,1],[35,Math.PI,-1]]){
    const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,bots:[],supplies:[],shield:0});
    r.projectiles=[{kind:'missile',target:0,owner:99,wx:-65,wz:missileZ,heading,speed:70,height:1.3,life:3,trail:[]}];
    releaseChaff(r);assert.equal(r.chaffClouds[0].wz,18);
    let explosion;for(let frame=0;frame<80;frame++){tickBattle(r,new Set(),.05);explosion??=r.effects.find(effect=>effect.type==='explosion');}
    assert.ok(explosion,'The intercepted missile produces an explosion');assert.ok((explosion.wz-18)*exitDirection>0,'The falling missile continues through the cloud in its incoming direction');assert.equal(r.projectiles.length,0);assert.equal(r.health,3);assert.equal(r.notice,'CHAFF INTERCEPT · MISSILE DESTROYED');
  }
});
test('chaff remains airborne for eight seconds and attracts missiles arriving six seconds after release',()=>{
  const r=createBattle(0,0,()=>.5);Object.assign(r,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,bots:[],supplies:[],shield:0});releaseChaff(r);
  for(let frame=0;frame<120;frame++)tickBattle(r,new Set(),.05);
  assert.equal(r.chaffClouds.length,1);
  r.projectiles=[{kind:'missile',target:0,owner:99,wx:-65,wz:45,heading:Math.PI,speed:70,height:1.3,life:3,trail:[]}];
  tickBattle(r,new Set(),.05);assert.equal(r.projectiles[0].target,null);
  for(let frame=0;frame<20;frame++)tickBattle(r,new Set(),.05);
  assert.equal(r.projectiles.length,1);assert.ok(r.projectiles[0].orbitAge>0);assert.equal(r.health,3);assert.equal(r.chaffClouds.length,1);
  for(let frame=0;frame<55;frame++)tickBattle(r,new Set(),.05);
  assert.equal(r.projectiles.length,0);assert.equal(r.health,3);assert.equal(r.notice,'CHAFF INTERCEPT · MISSILE DESTROYED');
  assert.equal(r.chaffClouds.length,0);
});
