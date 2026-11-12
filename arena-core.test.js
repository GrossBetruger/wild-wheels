import test from 'node:test';
import assert from 'node:assert/strict';
import {ArenaCore} from './arena-core.js';
import {createBattle,tickBattle} from './combat.js';
import {decodeBinarySnapshot} from './binary-wire.js';

test('a Rust-owned arena advances driving, AI, collisions and pickups through frame commands',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',supplies:[]});
  const core=new ArenaCore(seed);const reference=seed;
  for(let tick=0;tick<600;tick++){
    const keys=new Set(tick<180?['arrowup']:tick<300?['arrowup','arrowright','shift']:tick<450?['arrowup']:['arrowdown','arrowleft']);
    core.step(1/60,[{actor:0,keys}]);tickBattle(reference,keys,1/60);
    const world=core.snapshot();
    for(const [index,actor]of[world,...world.bots].entries()){
      const expected=[reference,...reference.bots][index];
      for(const field of ['wx','wz','speed','heading','health','kills','deaths'])assert.ok(Math.abs(actor[field]-expected[field])<1e-7,`tick ${tick}, actor ${index}, ${field}: ${actor[field]} vs ${expected[field]}`);
    }
  }
});

test('the Rust-owned bomber starts with two of each bomb and refills stink every five seconds and A-bombs every ten',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',bomber:true,bombAmmo:2,stinkAmmo:2,bombReload:0,supplies:[]});
  for(const bot of seed.bots){bot.inactive=true;bot.destroyed=1e9;}
  const core=new ArenaCore(seed);
  for(let i=0;i<300;i++)core.step(1/60);
  assert.equal(core.snapshot().bombAmmo,2);assert.equal(core.snapshot().stinkAmmo,3);
  for(let i=0;i<300;i++)core.step(1/60);
  assert.equal(core.snapshot().bombAmmo,3);assert.equal(core.snapshot().stinkAmmo,4);
});

test('Rust-owned weapons consume ammo once and a missile hit awards its killer a point',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,shield:0,fireCooldown:0,item:'missile',supplies:[]});
  for(const [i,bot]of seed.bots.entries())Object.assign(bot,{human:true,wx:i===0?-65:70,wz:i===0?20:70,health:3,shield:0,destroyed:i===0?0:1e9,speed:0});
  const core=new ArenaCore(seed);core.step(1/60,[{actor:0,keys:[],actions:[{type:'fire',id:0,afterMove:-1}]}]);
  assert.equal(core.snapshot().missiles,0);
  for(let i=0;i<40;i++)core.step(1/60,[{actor:0,keys:[],actions:[{type:'fire',id:0,afterMove:-1}]}]);
  assert.equal(core.snapshot().kills,1);assert.equal(core.snapshot().bots[0].deaths,1);assert.equal(core.snapshot().ammo,10);
});

test('invalid Rust frame commands do not advance or mutate the arena',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing'});const core=new ArenaCore(seed);const before=core.snapshot();
  for(const input of [{actor:6},{actor:0,steer:2},{actor:0,moves:[{sequence:3,keys:[]}]}])assert.throws(()=>core.step(1/60,[input]),/Invalid Rust frame/);
  assert.deepEqual(core.snapshot(),before);
});

test('Rust-owned stink assists award a half point to each bomber and a full point to the killer',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,shield:0,fireCooldown:0,item:'missile',supplies:[]});
  const [victim,bomberA,bomberB,unusedA,unusedB]=seed.bots;
  Object.assign(victim,{human:true,wx:-65,wz:20,health:3,shield:0,destroyed:0,speed:0});
  for(const bomber of [bomberA,bomberB])Object.assign(bomber,{bomber:true,bombAmmo:2,stinkAmmo:2});
  for(const bot of [unusedA,unusedB])Object.assign(bot,{inactive:true,destroyed:1e9});
  seed.stinkClouds=[{id:0,owner:2,wx:-65,wz:20,age:0,life:5,hits:[]},{id:1,owner:3,wx:-65,wz:20,age:0,life:5,hits:[]}];
  const core=new ArenaCore(seed);core.step(1/60);assert.equal(core.snapshot().bots[0].dizzy,8);
  core.step(1/60,[{actor:0,keys:[],actions:[{type:'fire',id:0,afterMove:-1}]}]);for(let i=0;i<40;i++)core.step(1/60);
  const world=core.snapshot();assert.equal(world.kills,1);assert.equal(world.bots[0].deaths,1);assert.equal(world.bots[1].kills,.5);assert.equal(world.bots[2].kills,.5);
  assert.equal(world.killFeed.filter(event=>event.assist).length,2);
});

test('a Rust-owned A-bomb retains its original damage and radius and consumes only A-bomb ammo',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',bomber:true,bombAmmo:2,stinkAmmo:2,supplies:[]});
  for(const [i,bot]of seed.bots.entries())Object.assign(bot,{human:true,wx:-65,wz:i===0?0:i===1?22:29,health:3,shield:0,destroyed:i>2?1e9:0,speed:0});
  const core=new ArenaCore(seed);core.step(1/60,[{actor:0,keys:[],actions:[{type:'bomb',kind:'abomb',wx:-65,wz:0,id:0,afterMove:-1}]}]);
  for(let i=0;i<53;i++)core.step(1/60);
  const world=core.snapshot();assert.equal(world.bombAmmo,1);assert.equal(world.stinkAmmo,2);assert.equal(world.kills,2);assert.deepEqual(world.bots.slice(0,3).map(bot=>bot.health),[0,0,3]);
});

test('Rust chaff breaks missile lock and its orbit ends in a harmless explosion',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',supplies:[],wx:-65,wz:0,shield:0});
  for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  seed.projectiles=[{id:1,owner:1,target:0,kind:'missile',wx:-65,wz:-15,heading:0,speed:70,height:1.3,vy:3,life:3,trail:[]}];
  const core=new ArenaCore(seed);core.step(1/60,[{actor:0,keys:[],actions:[{type:'chaff',id:0,afterMove:-1}]}]);
  let world=core.snapshot();assert.equal(world.chaff,3);assert.equal(world.projectiles[0].target,null);assert.equal(world.chaffClouds[0].color,seed.color);assert.equal(world.chaffClouds[0].diversions,1);
  for(let i=0;i<300;i++)core.step(1/60);
  world=core.snapshot();assert.equal(world.projectiles.length,0);assert.equal(world.health,3);assert.equal(world.deaths,0);
});

test('the Rust engine builds independently owned production packets without copying actor state into JavaScript',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',multiplayer:true,supplies:[],human:true});
  Object.assign(seed.bots[0],{human:true,name:'Fox 🦊',kills:.5});for(const bot of seed.bots.slice(1))Object.assign(bot,{inactive:true,destroyed:1e9});
  const core=new ArenaCore(seed);core.step(1/60,[{actor:0,keys:['arrowup'],moves:[{sequence:0,keys:['arrowup']}]}]);
  const packet=core.packet(0),first=decodeBinarySnapshot(packet);core.step(1/60,[{actor:0,keys:['arrowup'],moves:[{sequence:1,keys:['arrowup']}]}]);
  const guest=decodeBinarySnapshot(core.packet(1));
  assert.equal(first.movementSequence,0);assert.equal(decodeBinarySnapshot(packet).world.wx,first.world.wx);
  assert.equal(guest.you,1);assert.equal(guest.world.id,1);assert.equal(guest.world.name,'Fox 🦊');assert.equal(guest.world.kills,.5);assert.equal(guest.world.bots.length,1);
});

test('rendering reads live Rust-owned positions through a read-only memory view',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,supplies:[]});
  for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  const core=new ArenaCore(seed);core.snapshot=()=>{throw new Error('Full JS world reconstruction must not be used for rendering');};
  const view=core.present();assert.equal(view.wx,-65);assert.equal(view.speed,0);assert.equal(view.bots.length,0);
  core.step(1/60,[{actor:0,keys:['arrowup']}]);core.present();
  assert.equal(view.speed,5);assert.equal(view.wx,-65);assert.ok(view.wz>0);assert.throws(()=>{view.wx=99;},TypeError);
});

test('Rust render buffers retain bomb targets, types and timer values without a copied world object',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',bomber:true,bombAmmo:2,stinkAmmo:2,supplies:[]});
  const core=new ArenaCore(seed);core.step(1/60,[{actor:0,keys:[],actions:[{type:'bomb',kind:'stink',wx:30,wz:40,id:0,afterMove:-1}]}]);
  const view=core.present();assert.equal(view.stinkAmmo,1);assert.equal(view.bombs.length,1);assert.equal(view.bombs[0].kind,'stink');assert.equal(view.bombs[0].wx,30);assert.equal(view.bombs[0].wz,40);
  for(let i=0;i<54;i++)core.step(1/60);core.present();
  assert.equal(view.bombs.length,0);assert.equal(view.stinkClouds.length,1);assert.equal(view.stinkClouds[0].life,5);
});

test('kills against each new character show its actual name in the kill announcement',()=>{
  for(const [driver,name]of[[4,'Ellie the Elephant'],[5,'Tammy the Cricket'],[6,'Elon Musk']]){
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,heading:0,motionHeading:0,cameraHeading:0,shield:0,fireCooldown:0,supplies:[]});
    Object.assign(seed.bots[0],{human:true,driver,name:undefined,wx:-65,wz:12,health:1,shield:0,speed:0});for(const bot of seed.bots.slice(1))Object.assign(bot,{inactive:true,destroyed:1e9});
    const core=new ArenaCore(seed);core.step(1/60,[{actor:0,keys:[],actions:[{type:'fire'}]}]);for(let i=0;i<20;i++)core.step(1/60);
    assert.equal(core.snapshot().kills,1);assert.equal(core.snapshot().killFeed[0].victimName,name);
  }
});

test('a Rust-owned chaffed missile completes one circle then crashes without more turns or damage',()=>{
  const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,shield:0,supplies:[],chaffClouds:[{id:0,owner:0,wx:-65,wz:20,age:0,life:.1}],projectiles:[{id:1,kind:'missile',owner:1,target:null,decoy:0,decoyOwner:0,decoyCenter:{wx:-65,wz:20},wx:-60,wz:20,heading:Math.PI,speed:70,height:1.3,life:4,trail:[],orbitAge:0,orbitAngle:Math.PI/2,orbitRadius:5,orbitHeight:1.3,chaffed:true}]});
  for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
  const core=new ArenaCore(seed);let rotation=0,previous=Math.PI,sawFall=false,sankWhileCircling=false,movedWhileFalling=false,last=null;
  for(let frame=0;frame<120;frame++){
    core.step(1/60);const shot=core.snapshot().projectiles[0];if(!shot)continue;
    rotation+=Math.atan2(Math.sin(shot.heading-previous),Math.cos(shot.heading-previous));previous=shot.heading;
    if(shot.orbitAge>0&&shot.orbitAge<.6&&shot.height<1.3)sankWhileCircling=true;
    if(shot.orbitAge>.6&&shot.height<.8)sawFall=true;
    if(last&&shot.orbitAge>.6&&Math.hypot(shot.wx-last.wx,shot.wz-last.wz)>.5)movedWhileFalling=true;
    last=shot;
  }
  const world=core.snapshot();assert.ok(Math.abs(rotation-Math.PI*2)<1e-6);assert.equal(sawFall,true);assert.equal(sankWhileCircling,true);assert.equal(movedWhileFalling,true);assert.ok(last.wz<10);assert.equal(world.projectiles.length,0);assert.equal(world.health,3);assert.ok(world.effects.some(effect=>effect.type==='explosion'));
});

test('Rust chaff keeps clockwise and counterclockwise approaches continuous through the falling exit',()=>{
  for(const [heading,direction]of[[.35,-1],[-.35,1]]){
    const seed=createBattle();Object.assign(seed,{phase:'racing',human:true,wx:-65,wz:0,shield:0,supplies:[],chaffClouds:[{id:0,owner:0,wx:-65,wz:20,age:0,life:8}],projectiles:[{id:1,kind:'missile',owner:1,target:null,decoy:0,decoyOwner:0,decoyCenter:{wx:-65,wz:20},wx:-65,wz:10,heading,speed:70,height:1.3,life:4,trail:[]}]});
    for(const bot of seed.bots)Object.assign(bot,{inactive:true,destroyed:1e9});
    const core=new ArenaCore(seed);let entered=false,previous={heading,wx:-65,wz:10},rotation=0,movedAfterCircle=false;
    for(let frame=0;frame<120;frame++){
      core.step(1/60);const shot=core.snapshot().projectiles[0];if(!shot)continue;
      const turn=Math.atan2(Math.sin(shot.heading-previous.heading),Math.cos(shot.heading-previous.heading));
      if(shot.orbitAge!==undefined){
        if(!entered){assert.ok(Math.abs(turn)<=.08,'the missile enters without a heading jump');entered=true;assert.equal(decodeBinarySnapshot(core.packet()).world.projectiles[0].orbitDirection,direction);assert.equal(core.present().projectiles[0].orbitDirection,direction);}
        if(shot.orbitAge>0)rotation+=turn;
        assert.equal(shot.orbitDirection,direction);
        if(shot.orbitAge>.6){assert.ok(Math.hypot(shot.wx-previous.wx,shot.wz-previous.wz)>1,'falling preserves forward motion');movedAfterCircle=true;}
      }
      previous=shot;
    }
    assert.equal(entered,true);assert.ok(Math.abs(rotation-direction*Math.PI*2)<1e-6);assert.equal(movedAfterCircle,true);assert.equal(core.snapshot().projectiles.length,0);assert.equal(core.snapshot().health,3);
  }
});
