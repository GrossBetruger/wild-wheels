import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle} from './combat.js';
import {ArenaCore} from './arena-core.js';

for(const engine of ['JavaScript','Rust'])for(const scenario of [
  {name:'clear sight',caster:0,active:0,bot:1,botActive:0,enabled:true,impaired:false},
  {name:'enemy Dark Humor',caster:14,active:5,bot:1,botActive:0,enabled:true,impaired:true},
  {name:'another owl without active X-ray eyes',caster:14,active:5,bot:14,botActive:0,enabled:true,impaired:true},
  {name:'enemy Xylophone-Attack',caster:13,active:4,bot:1,botActive:0,enabled:true,impaired:true},
  {name:'own X-ray eyes',caster:0,active:0,bot:14,botActive:5,enabled:true,impaired:false},
  {name:'own Xylophone-Attack',caster:0,active:0,bot:13,botActive:4,enabled:true,impaired:false},
  {name:'Xylophone-Attack despite own X-ray eyes',caster:13,active:4,bot:14,botActive:5,enabled:true,impaired:true},
  {name:'disabled abilities',caster:14,active:5,bot:1,botActive:0,enabled:false,impaired:false},
  {name:'expired fog',caster:14,active:0,bot:1,botActive:0,enabled:true,impaired:false},
])test(`${engine}: bot aim and orientation with ${scenario.name}`,()=>{
  const world=createBattle(scenario.caster);Object.assign(world,{phase:'racing',human:true,wx:65,wz:25,health:6,heading:Math.PI,specialAbilities:scenario.enabled,specialActive:scenario.active,specialCooldown:20,supplies:[]});
  for(const a of world.bots)Object.assign(a,{inactive:true,destroyed:999});
  Object.assign(world.bots[0],{driver:scenario.bot,human:false,inactive:false,destroyed:0,wx:65,wz:0,heading:0,motionHeading:0,cameraHeading:0,speed:100,skill:1,brain:0,ammo:10,missiles:0,fireCooldown:0,specialActive:scenario.botActive,specialCooldown:20});
  const core=engine==='Rust'?new ArenaCore(world):null;if(core)core.step(1/60);if(!core)tickBattle(world,new Set(),1/60);
  const after=core?core.snapshot():world,bot=after.bots[0];
  assert.equal(bot.human,false);assert.equal(after.projectiles.filter(s=>s.owner===1).length,scenario.impaired?0:1);
  if(scenario.impaired){assert.ok(Math.abs(bot.heading)>.005);return;}
  assert.equal(bot.heading,0);
});
