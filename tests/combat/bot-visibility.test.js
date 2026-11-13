import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle} from '../../gameplay/combat.js';
import {ArenaCore} from '../../gameplay/arena-core.js';

for(const engine of ['JavaScript','Rust'])for(const scenario of [
  {name:'Dark Humor at 19.9 units',caster:14,active:5,bot:1,botActive:0,enabled:true,distance:19.9,seen:true},
  {name:'Dark Humor at 20 units',caster:14,active:5,bot:1,botActive:0,enabled:true,distance:20,seen:true},
  {name:'Dark Humor at 20.1 units',caster:14,active:5,bot:1,botActive:0,enabled:true,distance:20.1,seen:false},
  {name:'Xylophone-Attack at 34.9 units',caster:13,active:4,bot:1,botActive:0,enabled:true,distance:34.9,seen:true},
  {name:'Xylophone-Attack at 35 units',caster:13,active:4,bot:1,botActive:0,enabled:true,distance:35,seen:true},
  {name:'Xylophone-Attack at 35.1 units',caster:13,active:4,bot:1,botActive:0,enabled:true,distance:35.1,seen:false},
  {name:'own X-ray eyes at 100 units',caster:0,active:0,bot:14,botActive:5,enabled:true,distance:100,seen:true},
  {name:'own xylophone at 100 units',caster:0,active:0,bot:13,botActive:4,enabled:true,distance:100,seen:true},
  {name:'inactive X-ray eyes at 60 units',caster:14,active:5,bot:14,botActive:0,enabled:true,distance:60,seen:false},
  {name:'enemy xylophone despite own X-ray eyes at 35.1 units',caster:13,active:4,bot:14,botActive:5,enabled:true,distance:35.1,seen:false},
  {name:'enemy fog despite own xylophone at 60 units',caster:14,active:5,bot:13,botActive:4,enabled:true,distance:60,seen:false},
  {name:'disabled abilities at 100 units',caster:14,active:5,bot:1,botActive:0,enabled:false,distance:100,seen:true},
  {name:'fog expiring before this frame at 100 units',caster:14,active:.01,bot:1,botActive:0,enabled:true,distance:100,seen:true},
  {name:'xylophone expiring before this frame at 100 units',caster:13,active:.01,bot:1,botActive:0,enabled:true,distance:100,seen:true},
])test(`${engine}: bot sight with ${scenario.name}`,()=>{
  const world=createBattle(scenario.caster);Object.assign(world,{phase:'racing',human:true,wx:65,wz:-70+scenario.distance,health:6,specialAbilities:scenario.enabled,specialActive:scenario.active,specialCooldown:20,supplies:[]});
  for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});
  Object.assign(world.bots[0],{driver:scenario.bot,human:false,inactive:false,destroyed:0,wx:65,wz:-70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:100,skill:1,brain:0,ammo:10,missiles:0,fireCooldown:0,specialActive:scenario.botActive,specialCooldown:20});
  const core=engine==='Rust'?new ArenaCore(world):null;if(core)core.step(1/60);if(!core)tickBattle(world,new Set(),1/60);
  const after=core?core.snapshot():world,bot=after.bots[0];assert.equal(bot.human,false);assert.ok(bot.wx>65);
  if(scenario.seen){assert.ok(bot.heading<Math.PI/2-.005);return;}
  assert.equal(bot.heading,Math.PI/2);assert.equal(after.projectiles.filter(s=>s.owner===1).length,0);
});

for(const engine of ['JavaScript','Rust'])for(const caster of [0,13,14])test(`${engine}: nearby bot aim stays accurate with active caster ${caster}`,()=>{
  const world=createBattle(caster);Object.assign(world,{phase:'racing',human:true,wx:65,wz:15,health:6,specialActive:caster===0?0:4,specialCooldown:20,supplies:[]});for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});
  Object.assign(world.bots[0],{driver:1,human:false,inactive:false,destroyed:0,wx:65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:100,skill:1,brain:0,ammo:10,missiles:0,fireCooldown:0,specialCooldown:20});
  const core=engine==='Rust'?new ArenaCore(world):null;if(core)core.step(1/60);if(!core)tickBattle(world,new Set(),1/60);
  const after=core?core.snapshot():world;assert.equal(after.bots[0].heading,0);assert.equal(after.projectiles.filter(s=>s.owner===1).length,1);
});

for(const engine of ['JavaScript','Rust'])test(`${engine}: overlapping enemy fog and xylophone use the shorter 20-unit radius`,()=>{
  const world=createBattle(14);Object.assign(world,{phase:'racing',human:true,wx:65,wz:-40,health:6,specialActive:5,specialCooldown:20,supplies:[]});for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});
  Object.assign(world.bots[0],{driver:1,human:false,inactive:false,destroyed:0,wx:65,wz:-70,heading:Math.PI/2,motionHeading:Math.PI/2,cameraHeading:Math.PI/2,speed:100,skill:1,brain:0,specialCooldown:20});
  Object.assign(world.bots[1],{driver:13,human:true,inactive:false,destroyed:0,wx:-65,wz:70,specialActive:4,specialCooldown:20});
  const core=engine==='Rust'?new ArenaCore(world):null;if(core)core.step(1/60);if(!core)tickBattle(world,new Set(),1/60);
  const after=core?core.snapshot():world;assert.equal(after.bots[0].heading,Math.PI/2);assert.ok(after.bots[0].wx>65);assert.equal(after.projectiles.filter(s=>s.owner===1).length,0);
});
