import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle} from './combat.js';
import {ArenaCore} from './arena-core.js';
import {tickFireRings,fireRingBlocks} from './fire-ring.js';

test('Yuda ignites only after completing a full charged drifting circle in solo and Rust arenas',()=>{
  const world=createBattle(10);Object.assign(world,{driver:10,phase:'racing',wx:70,wz:0,speed:200,heading:0,motionHeading:0,shield:0,supplies:[]});for(const a of world.bots){a.inactive=true;a.destroyed=1e9;}
  const native=new ArenaCore(structuredClone(world)),keys=new Set(['w','shift','arrowright']);
  for(let step=0;step<40;step++){tickBattle(world,keys,1/60);native.step(1/60,[{actor:0,keys}]);}
  assert.equal(world.effects.some(f=>f.type==='fireRing'),false);assert.equal(native.snapshot().effects.some(f=>f.type==='fireRing'),false);
  for(let step=0;step<65;step++){tickBattle(world,keys,1/60);native.step(1/60,[{actor:0,keys}]);}
  assert.equal(world.effects.some(f=>f.type==='fireRing'),true);assert.equal(native.snapshot().effects.some(f=>f.type==='fireRing'),true);
  tickBattle(world,new Set(['w']),1/60);native.step(1/60,[{actor:0,keys:['w']}]);
  assert.equal(world.effects.some(f=>f.type==='fireRing'),false);assert.equal(native.snapshot().effects.some(f=>f.type==='fireRing'),false);
});

test('fire burns the perimeter immediately and every 0.3 seconds; owner and interior stay safe',()=>{
  const world=createBattle();Object.assign(world,{driver:10,phase:'racing',wx:0,wz:0,speed:100,heading:0,ringHeading:-.1,ringRemaining:20,ringSpent:true,shield:0});world.bots=world.bots.slice(0,2);Object.assign(world.bots[0],{wx:10,wz:0,health:6,shield:0});Object.assign(world.bots[1],{wx:0,wz:5,health:6,shield:0});
  const step=()=>{world.heading+=.1;tickFireRings(world,1/60);};step();assert.equal(world.bots[0].health,4);assert.equal(world.health,3);assert.equal(world.bots[1].health,6);
  for(let i=0;i<17;i++)step();assert.equal(world.bots[0].health,4);step();assert.equal(world.bots[0].health,2);
});

test('the ring blocks crossing projectiles in both directions, including fast shots',()=>{
  const world={specialAbilities:true,effects:[{type:'fireRing',wx:0,wz:0}]};
  assert.equal(fireRingBlocks(world,-20,0,20,0),true);assert.equal(fireRingBlocks(world,0,0,12,0),true);assert.equal(fireRingBlocks(world,12,0,0,0),true);assert.equal(fireRingBlocks(world,0,0,5,0),false);assert.equal(fireRingBlocks(world,20,20,30,20),false);
});

test('fire ends at 20 seconds and cannot reignite until Yuda stops turning; room toggle disables it',()=>{
  const world=createBattle();Object.assign(world,{driver:10,phase:'racing',wx:0,wz:0,speed:100,ringRemaining:20,ringSpent:true,ringHeading:0,heading:0,wasDrifting:true,drift:1.2});world.bots=[];
  for(let i=0;i<1201;i++){world.heading+=.1;tickFireRings(world,1/60);}assert.equal(world.effects.some(f=>f.type==='fireRing'),false);
  world.ringRemaining=10;world.specialAbilities=false;world.heading+=.1;tickFireRings(world,1/60);assert.equal(world.effects.some(f=>f.type==='fireRing'),false);
});

test('native and solo fire absorb missiles without blast damage and burn enemies on the perimeter',()=>{
  const seed=createBattle();Object.assign(seed,{driver:10,phase:'racing',wx:70,wz:0,speed:20,heading:0,motionHeading:0,ringHeading:.1,ringRemaining:20,ringSpent:true,health:6,shield:0,supplies:[]});
  for(const a of seed.bots){a.inactive=true;a.destroyed=1e9;}
  Object.assign(seed.bots[0],{human:true,inactive:false,destroyed:0,wx:80,wz:0,speed:0,health:6,shield:0});
  seed.projectiles=[{id:1,owner:1,kind:'missile',wx:84,wz:0,heading:-Math.PI/2,speed:240,height:3,vy:0,life:5,age:0,trail:[],target:null}];
  const solo=structuredClone(seed),native=new ArenaCore(seed),keys=new Set(['w','arrowright']);
  tickBattle(solo,keys,1/60,new Map([[1,{keys:new Set()}]]));native.step(1/60,[{actor:0,keys},{actor:1,keys:[]}]);
  assert.equal(solo.projectiles.length,0);assert.equal(native.snapshot().projectiles.length,0);
  assert.equal(solo.health,6);assert.equal(native.snapshot().health,6);
  assert.equal(solo.bots[0].health,4);assert.equal(native.snapshot().bots[0].health,4);
});
