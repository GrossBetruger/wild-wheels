import test from 'node:test';
import assert from 'node:assert/strict';
import {createBattle,tickBattle,useBattleTurbo} from '../../gameplay/combat.js';
import {ArenaCore,ArenaClient} from '../../gameplay/arena-core.js';
import {activateNightmare} from './nightmare-fuel.js';
import {useSpecial} from '../../gameplay/special-abilities.js';

for(const engine of ['JavaScript','Rust']){
  test(`${engine}: two Houstons caught in each other's flames trade kills and their flames stop on death`,()=>{
    const world=createBattle(7);Object.assign(world,{phase:'racing',human:true,wx:65,wz:70,heading:0,supplies:[],nightmareActive:12,nightmareCooldown:30,boost:12});
    for(const bot of world.bots)Object.assign(bot,{inactive:true,destroyed:999});
    Object.assign(world.bots[0],{driver:7,inactive:false,destroyed:0,human:true,wx:65,wz:50,heading:Math.PI,health:3,nightmareActive:12,nightmareCooldown:30,boost:12});
    const core=engine==='Rust'?new ArenaCore(world):null;
    if(core)core.step(0);if(!core)tickBattle(world,new Set(),0);
    const after=core?core.snapshot():world;
    assert.equal(after.destroyed,3);assert.equal(after.bots[0].destroyed,3);
    assert.equal(after.kills,1);assert.equal(after.bots[0].kills,1);
    assert.equal(after.nightmareActive,0);assert.equal(after.bots[0].nightmareActive,0);
  });
  test(`${engine}: Nightmare Fuel instantly destroys a shielded racer twenty units behind Houston, but not beside, ahead, beyond its reach or its owner`,()=>{
    const world=createBattle(7);Object.assign(world,{phase:'racing',human:true,wx:65,wz:70,heading:0,supplies:[]});
    for(const bot of world.bots)Object.assign(bot,{inactive:true,destroyed:999});
    for(const [i,x,z] of [[0,65,50],[1,70,50],[2,65,80],[3,65,35]])Object.assign(world.bots[i],{inactive:false,destroyed:0,human:true,wx:x,wz:z,health:6,shield:25,hedgeShield:25});
    const core=engine==='Rust'?new ArenaCore(world):null;
    if(core)core.step(0,[{actor:0,actions:[{type:'nightmare'}]}]);
    if(!core){assert.equal(activateNightmare(world),true);tickBattle(world,new Set(),0);}
    const after=core?core.snapshot():world;
    assert.equal(after.bots[0].destroyed,3);assert.equal(after.bots[0].health,0);
    assert.deepEqual(after.bots.slice(1,4).map(a=>a.health),[6,6,6]);
    assert.equal(after.health,3);assert.equal(after.kills,1);assert.equal(after.killFeed[0].kind,'nightmare');
    assert.equal(after.nightmareActive,12);assert.equal(after.boost,12);assert.equal(after.nightmareCooldown,30);
  });
  test(`${engine}: Nightmare Fuel ends after twelve seconds and recharges thirty seconds from activation independently of the gravity well`,()=>{
    const world=createBattle(7);Object.assign(world,{phase:'racing',human:true,wx:65,wz:70,heading:0,supplies:[]});
    for(const bot of world.bots)Object.assign(bot,{inactive:true,destroyed:999});
    const core=engine==='Rust'?new ArenaCore(world):null;
    const act=type=>core?core.step(0,[{actor:0,actions:[{type}]}]):type==='special'?useSpecial(world):activateNightmare(world);
    const read=()=>core?core.snapshot():world;
    const step=()=>core?core.step(.05):tickBattle(world,new Set(),.05);
    act('special');act('nightmare');
    assert.equal(read().specialActive,14);assert.equal(read().specialCooldown,25);
    assert.equal(read().nightmareActive,12);assert.equal(read().nightmareCooldown,30);
    for(let i=0;i<239;i++)step();assert.ok(read().nightmareActive>0);
    for(let i=0;i<2;i++)step();assert.equal(read().nightmareActive,0);assert.equal(read().boost,0);
    act('nightmare');assert.equal(read().nightmareActive,0);
    for(let i=0;i<360;i++)step();assert.equal(read().nightmareCooldown,0);
    act('nightmare');assert.equal(read().nightmareActive,12);assert.equal(read().nightmareCooldown,30);
  });
  test(`${engine}: arena walls block Nightmare Fuel`,()=>{
    const world=createBattle(7);Object.assign(world,{phase:'racing',human:true,wx:-20,wz:35,heading:Math.PI/2,supplies:[]});
    for(const bot of world.bots)Object.assign(bot,{inactive:true,destroyed:999});
    Object.assign(world.bots[0],{inactive:false,destroyed:0,human:true,wx:-45,wz:35,health:6});
    const core=engine==='Rust'?new ArenaCore(world):null;
    if(core)core.step(0,[{actor:0,actions:[{type:'nightmare'}]}]);
    if(!core){activateNightmare(world);tickBattle(world,new Set(),0);}
    assert.equal((core?core.snapshot():world).bots[0].health,6);
  });
  test(`${engine}: Nightmare Fuel obeys the room ability switch and is exclusive to Houston`,()=>{
    for(const [driver,enabled] of [[7,false],[0,true]]){
      const world=createBattle(driver);Object.assign(world,{phase:'racing',human:true,specialAbilities:enabled,supplies:[]});
      for(const bot of world.bots)Object.assign(bot,{inactive:true,destroyed:999});
      const core=engine==='Rust'?new ArenaCore(world):null;
      if(core)core.step(0,[{actor:0,actions:[{type:'nightmare'}]}]);
      if(!core)assert.equal(activateNightmare(world),false);
      const after=core?core.snapshot():world;assert.equal(after.nightmareActive??0,0);assert.equal(after.boost,0);
    }
  });
}
test('double-tapping X predicts Nightmare Fuel immediately and sends an authoritative action after a normal turbo',()=>{
  const world=createBattle(7);Object.assign(world,{phase:'racing',human:true,wx:65,wz:70,heading:0,supplies:[]});
  for(const bot of world.bots)Object.assign(bot,{inactive:true,destroyed:999});
  const core=new ArenaCore(world),client=new ArenaClient();client.accept(core.packet(0),0);client.frame(1/60,[],.02);
  assert.equal(client.action('turbo',null,.05),true);assert.equal(client.action('turbo',null,.2),true);
  assert.equal(client.snapshot().nightmareActive,12);assert.equal(client.snapshot().nightmareCooldown,30);assert.equal(client.snapshot().boost,12);
  const input=client.outbound([]);assert.deepEqual(input.actions.map(a=>a.type),['turbo','nightmare']);
  core.step(0,[{...input,actor:0}]);assert.equal(core.snapshot().nightmareActive,12);assert.equal(core.snapshot().nightmareCooldown,30);
});
test('offline double-tap starts Nightmare Fuel, while two presses a second apart remain ordinary boosts',()=>{
  const world=createBattle(7);Object.assign(world,{phase:'racing',elapsed:1,human:true,supplies:[]});
  assert.equal(useBattleTurbo(world),true);world.elapsed=1.2;assert.equal(useBattleTurbo(world),true);assert.equal(world.nightmareActive,12);
  const other=createBattle(7);Object.assign(other,{phase:'racing',elapsed:1,human:true,supplies:[]});
  useBattleTurbo(other);other.elapsed=2;assert.equal(useBattleTurbo(other),false);assert.equal(other.nightmareActive??0,0);
});
