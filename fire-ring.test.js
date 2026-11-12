import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle} from './combat.js';
import {ArenaCore} from './arena-core.js';
import {tickFireRings,fireRingBlocks,fireRingRadius} from './fire-ring.js';

test('Yuda ignites at the existing full drift charge in solo and Rust arenas',()=>{
  const world=createBattle(10);Object.assign(world,{driver:10,phase:'racing',wx:0,wz:70,speed:200,heading:0,motionHeading:0,shield:0,supplies:[]});for(const a of world.bots){a.inactive=true;a.destroyed=1e9;}
  const native=new ArenaCore(structuredClone(world)),keys=new Set(['w','shift','arrowright']);
  for(let step=0;step<40;step++){tickBattle(world,keys,1/60);native.step(1/60,[{actor:0,keys}]);}
  assert.equal(world.effects.some(f=>f.type==='fireRing'),false);assert.equal(native.snapshot().effects.some(f=>f.type==='fireRing'),false);
  for(let step=0;step<65;step++){tickBattle(world,keys,1/60);native.step(1/60,[{actor:0,keys}]);}
  assert.equal(world.effects.some(f=>f.type==='fireRing'),true);assert.equal(native.snapshot().effects.some(f=>f.type==='fireRing'),true);
  for(let i=0;i<12;i++){tickBattle(world,new Set(['w']),1/60);native.step(1/60,[{actor:0,keys:['w']}]);}
  assert.equal(world.effects.some(f=>f.type==='fireRing'),false);assert.equal(native.snapshot().effects.some(f=>f.type==='fireRing'),false);
});

test('fire burns the perimeter immediately and every 0.3 seconds; owner and interior stay safe',()=>{
  const world=createBattle();Object.assign(world,{driver:10,phase:'racing',wx:0,wz:0,speed:100,heading:0,ringHeading:-.1,ringRemaining:20,ringSpent:true,shield:0});world.bots=world.bots.slice(0,2);Object.assign(world.bots[0],{wx:10,wz:0,health:6,shield:0});Object.assign(world.bots[1],{wx:0,wz:5,health:6,shield:0});
  const step=()=>{world.heading+=.1;tickFireRings(world,1/60);};step();assert.equal(world.bots[0].health,4);assert.equal(world.health,3);assert.equal(world.bots[1].health,6);
  for(let i=0;i<17;i++)step();assert.equal(world.bots[0].health,4);step();assert.equal(world.bots[0].health,2);
});

test('the ring blocks crossing projectiles in both directions, including fast shots',()=>{
  const world={specialAbilities:true,effects:[{type:'fireRing',radius:10,wx:0,wz:0}]};
  assert.equal(fireRingBlocks(world,-20,0,20,0),true);assert.equal(fireRingBlocks(world,0,0,12,0),true);assert.equal(fireRingBlocks(world,12,0,0,0),true);assert.equal(fireRingBlocks(world,0,0,5,0),false);assert.equal(fireRingBlocks(world,20,20,30,20),false);
});

test('fire ends at 20 seconds and cannot reignite until Yuda stops turning; room toggle disables it',()=>{
  const world=createBattle();Object.assign(world,{driver:10,phase:'racing',wx:0,wz:0,speed:100,ringRemaining:20,ringSpent:true,ringHeading:0,heading:0,wasDrifting:true,drift:1.2});world.bots=[];
  for(let i=0;i<1201;i++){world.heading+=.1;tickFireRings(world,1/60);}assert.equal(world.effects.some(f=>f.type==='fireRing'),false);
  world.ringRemaining=10;world.specialAbilities=false;world.heading+=.1;tickFireRings(world,1/60);assert.equal(world.effects.some(f=>f.type==='fireRing'),false);
});

test('native and solo fire absorb missiles without blast damage and burn enemies on the perimeter',()=>{
  const seed=createBattle();Object.assign(seed,{driver:10,phase:'racing',wx:0,wz:70,speed:20,heading:0,motionHeading:0,ringHeading:.1,ringRemaining:20,ringSpent:true,health:6,shield:0,supplies:[]});
  for(const a of seed.bots){a.inactive=true;a.destroyed=1e9;}
  Object.assign(seed.bots[0],{human:true,inactive:false,destroyed:0,wx:10,wz:70,speed:0,health:6,shield:0});
  seed.projectiles=[{id:1,owner:1,kind:'missile',wx:14,wz:70,heading:-Math.PI/2,speed:240,height:3,vy:0,life:5,age:0,trail:[],target:null}];
  const solo=structuredClone(seed),native=new ArenaCore(seed),keys=new Set(['w','arrowright']);
  tickBattle(solo,keys,1/60,new Map([[1,{keys:new Set()}]]));native.step(1/60,[{actor:0,keys},{actor:1,keys:[]}]);
  assert.equal(solo.projectiles.length,0);assert.equal(native.snapshot().projectiles.length,0);
  assert.equal(solo.health,6);assert.equal(native.snapshot().health,6);
  assert.equal(solo.bots[0].health,4);assert.equal(native.snapshot().bots[0].health,4);
});

test('the existing maximum boost charge ignites without a full revolution and survives network command gaps',()=>{
  const seed=createBattle();Object.assign(seed,{driver:10,phase:'racing',wx:70,wz:0,speed:200,heading:0,motionHeading:0,ringHeading:0,drift:.84,wasDrifting:true,supplies:[]});for(const a of seed.bots){a.inactive=true;a.destroyed=1e9;}
  const core=new ArenaCore(seed),keys=['w','shift','arrowright'];
  core.step(1/60,[{actor:0,keys,moves:[{sequence:0,keys}]}]);assert.equal(core.snapshot().effects.some(f=>f.type==='fireRing'),true);
  core.step(1/60,[{actor:0,keys,moves:[]}]);assert.equal(core.snapshot().effects.some(f=>f.type==='fireRing'),true);
});

test('Ring of Fire announces your ignition once, then expires while the flames keep burning',async()=>{
  const {RingOfFireNotice}=await import('./combat-notices.js');const notice=new RingOfFireNotice();
  const world={mode:'combat',phase:'racing',soundEpoch:1,arena:0,id:0,destroyed:0,effects:[]};
  assert.equal(notice.sample(world,0),null);world.effects=[{type:'fireRing',owner:0}];const first=notice.sample(world,.1);assert.ok(first);
  assert.equal(notice.sample(world,1).key,first.key);assert.equal(notice.sample(world,2.5),null);assert.equal(notice.sample(world,3),null);
  world.effects=[];notice.sample(world,4);world.effects=[{type:'fireRing',owner:0}];assert.notEqual(notice.sample(world,5).key,first.key);
});

test('joining a burning ring or seeing another player’s ring does not announce your ability',async()=>{
  const {RingOfFireNotice}=await import('./combat-notices.js');const notice=new RingOfFireNotice();
  const world={mode:'combat',phase:'racing',soundEpoch:1,arena:0,id:0,destroyed:0,effects:[{type:'fireRing',owner:0}]};
  assert.equal(notice.sample(world,0),null);assert.equal(notice.sample(world,1),null);
  world.effects=[{type:'fireRing',owner:1}];assert.equal(notice.sample(world,2),null);
});

test('right drifts produce blue fire and left drifts produce orange fire in solo and native arenas',()=>{
  for(const [steering,color]of [['arrowright','#4abaff'],['arrowleft','#ff631c']]){
    const seed=createBattle();Object.assign(seed,{driver:10,phase:'racing',wx:70,wz:0,speed:200,heading:0,motionHeading:0,ringHeading:0,drift:.84,wasDrifting:true,supplies:[]});for(const a of seed.bots){a.inactive=true;a.destroyed=1e9;}
    const solo=structuredClone(seed),native=new ArenaCore(seed),keys=new Set(['w','shift',steering]);tickBattle(solo,keys,1/60);native.step(1/60,[{actor:0,keys}]);
    assert.equal(solo.effects.find(f=>f.type==='fireRing').color,color);assert.equal(native.snapshot().effects.find(f=>f.type==='fireRing').color,color);
  }
});

test('fire radius grows uniformly from 10 toward 40 over twenty seconds',()=>{
  for(const [seconds,remaining,expected]of [[0,20,10],[5,15,17.5],[10,10,25],[15,5,32.5],[19,1,38.5]]){
    const seed=createBattle();Object.assign(seed,{driver:10,phase:'racing',wx:70,wz:0,speed:100,heading:0,motionHeading:0,ringHeading:.1,ringRemaining:remaining,ringSpent:true,supplies:[]});for(const a of seed.bots){a.inactive=true;a.destroyed=1e9;}
    const solo=structuredClone(seed),native=new ArenaCore(seed);tickFireRings(solo,0);native.step(0,[{actor:0,keys:[]}]);
    assert.equal(solo.effects.find(f=>f.type==='fireRing').radius,expected,`Solo at ${seconds}s`);
    assert.equal(native.snapshot().effects.find(f=>f.type==='fireRing').radius,expected,`Native at ${seconds}s`);
    assert.equal(native.present().effects.find(f=>f.type==='fireRing').radius,expected,'The renderer receives the authoritative radius');
  }
});

test('growing fire blocks at its current edge rather than its old radius',()=>{
  const world={specialAbilities:true,effects:[{type:'fireRing',radius:25,wx:0,wz:0}]};
  assert.equal(fireRingBlocks(world,24,0,26,0),true);assert.equal(fireRingBlocks(world,9,0,11,0),false);
});

test('the expanding ring reaches radius 40 at twenty seconds without overshooting',()=>{assert.equal(fireRingRadius(0),40);assert.equal(fireRingRadius(-1),40);});

test('manual release and timeout each leave one colored extinguishing ring in solo and Rust arenas',()=>{
  for(const [reason,remaining,speed,previousHeading,oldRadius,expectedRadius]of [['release',10,0,0,25,25],['timeout',.01,100,.1,39.985,40]]){
    const seed=createBattle();Object.assign(seed,{driver:10,phase:'racing',wx:70,wz:0,speed,heading:0,motionHeading:0,ringHeading:previousHeading,ringRemaining:remaining,ringSpent:true,supplies:[],effects:[{type:'fireRing',owner:0,wx:70,wz:0,radius:oldRadius,color:'#4abaff',age:0,life:.1}]});for(const a of seed.bots){a.inactive=true;a.destroyed=1e9;}
    const solo=structuredClone(seed),native=new ArenaCore(seed),keys=new Set(reason==='timeout'?['w','arrowright']:[]);
    tickBattle(solo,keys,1/60);native.step(1/60,[{actor:0,keys}]);
    for(const world of [solo,native.snapshot()]){const out=world.effects.filter(f=>f.type==='fireRingOut');assert.equal(out.length,1,reason);assert.equal(out[0].radius,expectedRadius);assert.equal(out[0].color,'#4abaff');assert.equal(world.effects.some(f=>f.type==='fireRing'),false);assert.equal(fireRingBlocks(world,30,0,110,0),false,'The dying flames no longer block projectiles');}
    tickBattle(solo,new Set(),1/60);native.step(1/60);assert.equal(solo.effects.filter(f=>f.type==='fireRingOut').length,1);assert.equal(native.snapshot().effects.filter(f=>f.type==='fireRingOut').length,1);
    assert.equal(native.present().effects.find(f=>f.type==='fireRingOut').radius,expectedRadius);
    for(let i=0;i<150;i++){tickBattle(solo,new Set(),1/60);native.step(1/60);}
    assert.equal(solo.effects.some(f=>f.type==='fireRingOut'),false);assert.equal(native.snapshot().effects.some(f=>f.type==='fireRingOut'),false);
  }
});
